import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Req,
    Res,
    SetMetadata,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiResponse,
    ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { SKIP_TENANT_CHECK } from '../../core/guards/tenant.guard';
import { AuthService } from './auth.service';
import {
    ChangePasswordDto,
    ForceResetPasswordDto,
    ForgotPasswordDto,
    LoginDto,
    PublicTokenResponse,
    RefreshTokenDto,
    ResetPasswordDto,
    TokenResponse,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const REFRESH_COOKIE_NAME = 'fh_rt';

@ApiTags('Auth')
@Controller({ path: 'auth', version: '1' })
@SetMetadata(SKIP_TENANT_CHECK, true)
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    private isIpv4Host(host: string): boolean {
        return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
    }

    private isReservedWorkspaceLabel(label: string): boolean {
        return ['www', 'api', 'app'].includes(label);
    }

    private resolveTenantSlug(req: Request, providedTenantSlug?: string): string {
        if (providedTenantSlug?.trim()) {
            return providedTenantSlug.trim().toLowerCase();
        }

        const headerTenant = req.headers['x-tenant-id'] as string;
        if (headerTenant?.trim()) {
            return headerTenant.trim().toLowerCase();
        }

        const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)
            ?.split(',')[0]
            ?.trim();
        const rawHost = forwardedHost || req.headers['host'] || '';
        const hostWithoutPort = rawHost.split(':')[0].trim().toLowerCase();

        if (!hostWithoutPort) {
            throw new BadRequestException('Workspace context is missing. Sign in via your workspace URL.');
        }

        if (hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1') {
            return 'localhost';
        }

        if (hostWithoutPort.endsWith('.localhost')) {
            const localSubdomain = hostWithoutPort.replace(/\.localhost$/, '');
            if (localSubdomain && !this.isReservedWorkspaceLabel(localSubdomain)) {
                return localSubdomain;
            }
        }

        const parts = hostWithoutPort.split('.').filter(Boolean);
        if (!this.isIpv4Host(hostWithoutPort) && parts.length >= 3) {
            const candidate = parts[0].toLowerCase();
            if (!this.isReservedWorkspaceLabel(candidate)) {
                return candidate;
            }
        }

        return hostWithoutPort;
    }

    private getRefreshCookieOptions(req: Request) {
        const refreshDays = Number(process.env.REFRESH_TOKEN_DAYS || 7);
        const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)
            ?.split(',')[0]
            ?.trim()
            ?.toLowerCase();
        const isSecureRequest = forwardedProto
            ? forwardedProto === 'https'
            : req.secure || req.protocol === 'https';

        return {
            httpOnly: true,
            secure: isSecureRequest,
            sameSite: 'lax' as const,
            maxAge: refreshDays * 24 * 60 * 60 * 1000,
            // Use '/' so the browser sends the cookie regardless of proxy path-rewriting
            // (Vite dev proxy rewrites /api → /api/v1, so a path of /api/v1/auth would
            // never match the browser-visible request path /api/auth/...)
            path: '/',
        };
    }

    private setRefreshCookie(req: Request, res: Response, refreshToken: string) {
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, this.getRefreshCookieOptions(req));
    }

    private clearRefreshCookie(req: Request, res: Response) {
        res.clearCookie(REFRESH_COOKIE_NAME, {
            ...this.getRefreshCookieOptions(req),
            maxAge: 0,
        });
    }

    private extractRefreshTokenFromCookie(req: Request): string | undefined {
        const cookieHeader = req.headers.cookie;
        if (!cookieHeader) return undefined;

        const tokenPair = cookieHeader
            .split(';')
            .map((part) => part.trim())
            .find((part) => part.startsWith(`${REFRESH_COOKIE_NAME}=`));

        if (!tokenPair) return undefined;
        return decodeURIComponent(tokenPair.substring(`${REFRESH_COOKIE_NAME}=`.length));
    }

    private toPublicTokenResponse(payload: TokenResponse): PublicTokenResponse {
        const { refreshToken: _refreshToken, ...rest } = payload;
        return rest;
    }

    @Post('login')
    @Throttle({
        short: { limit: 3, ttl: 1000 },
        medium: { limit: 8, ttl: 10000 },
        long: { limit: 25, ttl: 60000 },
    })
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Login with email and password' })
    @ApiResponse({ status: 200, description: 'Login successful' })
    @ApiResponse({ status: 401, description: 'Invalid credentials' })
    @ApiResponse({ status: 429, description: 'Too many login attempts' })
    async login(
        @Body() dto: LoginDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<PublicTokenResponse> {
        // Add request metadata to DTO
        dto.ipAddress = req.ip || req.socket.remoteAddress;
        dto.userAgent = req.headers['user-agent'];
        dto.requestId = (req as any).requestId;

        dto.tenantSlug = this.resolveTenantSlug(req, dto.tenantSlug);

        const tokenResponse = await this.authService.login(dto);
        if (tokenResponse.refreshToken) {
            this.setRefreshCookie(req, res, tokenResponse.refreshToken);
        }
        return this.toPublicTokenResponse(tokenResponse);
    }

    @Post('refresh')
    @Throttle({
        short: { limit: 5, ttl: 1000 },
        medium: { limit: 15, ttl: 10000 },
        long: { limit: 30, ttl: 60000 },
    })
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Refresh access token' })
    @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
    @ApiResponse({ status: 401, description: 'Invalid refresh token' })
    @ApiResponse({ status: 429, description: 'Too many refresh attempts' })
    async refreshToken(
        @Req() req: Request,
        @Body() dto: Partial<RefreshTokenDto>,
        @Res({ passthrough: true }) res: Response,
    ): Promise<PublicTokenResponse> {
        const refreshToken = dto.refreshToken || this.extractRefreshTokenFromCookie(req);
        if (!refreshToken) {
            throw new BadRequestException('Refresh token is required');
        }

        const tokenResponse = await this.authService.refreshToken({
            refreshToken,
            ipAddress: req.ip || req.socket.remoteAddress,
            userAgent: req.headers['user-agent'],
        });
        if (tokenResponse.refreshToken) {
            this.setRefreshCookie(req, res, tokenResponse.refreshToken);
        }

        return this.toPublicTokenResponse(tokenResponse);
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Logout and revoke tokens' })
    @ApiResponse({ status: 204, description: 'Logged out successfully' })
    async logout(
        @Req() req: Request,
        @Body() body: { refreshToken?: string },
        @Res({ passthrough: true }) res: Response,
    ): Promise<void> {
        const userId = (req as any).user.sub;
        const refreshToken = body?.refreshToken || this.extractRefreshTokenFromCookie(req);
        await this.authService.logout(userId, refreshToken);
        this.clearRefreshCookie(req, res);
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get current user profile' })
    @ApiResponse({ status: 200, description: 'User profile retrieved' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    async getCurrentUser(@Req() req: Request) {
        const userId = (req as any).user.sub;
        return this.authService.getCurrentUser(userId);
    }

    @Get('sessions')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'List active sessions for current user' })
    @ApiResponse({ status: 200, description: 'Active sessions retrieved' })
    async getSessions(@Req() req: Request) {
        const userId = (req as any).user.sub;
        const refreshToken = this.extractRefreshTokenFromCookie(req);
        return this.authService.getUserSessions(userId, refreshToken);
    }

    @Delete('sessions/:sessionId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Revoke one session by id' })
    @ApiResponse({ status: 204, description: 'Session revoked' })
    async revokeSession(
        @Req() req: Request,
        @Param('sessionId') sessionId: string,
    ): Promise<void> {
        const userId = (req as any).user.sub;
        await this.authService.revokeSessionById(userId, sessionId);
    }

    @Post('sessions/revoke-all')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Revoke all other sessions' })
    @ApiResponse({ status: 204, description: 'All other sessions revoked' })
    async revokeAllSessions(
        @Req() req: Request,
    ): Promise<void> {
        const userId = (req as any).user.sub;
        const refreshToken = this.extractRefreshTokenFromCookie(req);
        await this.authService.revokeAllOtherSessions(userId, refreshToken);
    }

    @Post('change-password')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Change password' })
    @ApiResponse({ status: 204, description: 'Password changed successfully' })
    @ApiResponse({ status: 400, description: 'Invalid current password' })
    async changePassword(
        @Req() req: Request,
        @Body() dto: ChangePasswordDto,
    ): Promise<void> {
        const userId = (req as any).user.sub;
        await this.authService.changePassword(
            userId,
            dto.currentPassword,
            dto.newPassword,
        );
    }

    @Post('forgot-password')
    @Throttle({
        short: { limit: 2, ttl: 1000 },
        medium: { limit: 5, ttl: 10000 },
        long: { limit: 10, ttl: 60000 },
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Request a password reset email' })
    @ApiResponse({ status: 204, description: 'Reset request accepted' })
    @ApiResponse({ status: 429, description: 'Too many password reset attempts' })
    async forgotPassword(
        @Body() dto: ForgotPasswordDto,
        @Req() req: Request,
    ): Promise<void> {
        dto.tenantSlug = this.resolveTenantSlug(req, dto.tenantSlug);

        await this.authService.requestPasswordReset(dto);
    }

    @Post('reset-password')
    @Throttle({
        short: { limit: 3, ttl: 1000 },
        medium: { limit: 8, ttl: 10000 },
        long: { limit: 15, ttl: 60000 },
    })
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Reset password using OTP from email' })
    @ApiResponse({ status: 204, description: 'Password reset successfully' })
    @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
    async resetPassword(
        @Body() dto: ResetPasswordDto,
        @Req() req: Request,
    ): Promise<void> {
        dto.tenantSlug = this.resolveTenantSlug(req, dto.tenantSlug);
        await this.authService.resetPassword(dto);
    }

    @Post('force-reset-password')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Force reset password (for first-time login)' })
    @ApiResponse({ status: 204, description: 'Password reset successfully' })
    @ApiResponse({ status: 400, description: 'Invalid request' })
    async forceResetPassword(
        @Req() req: Request,
        @Body() dto: ForceResetPasswordDto,
    ): Promise<void> {
        const userId = (req as any).user.sub;
        await this.authService.forceResetPassword(userId, dto.newPassword);
    }
}

