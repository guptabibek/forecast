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
    ForgotPasswordDto,
    LoginDto,
    PublicTokenResponse,
    RefreshTokenDto,
    RegisterDto,
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

    private isDemoTenantFallbackEnabled(): boolean {
        const raw = (process.env.ALLOW_DEMO_TENANT_FALLBACK || '').trim().toLowerCase();
        const enabled = raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
        return process.env.NODE_ENV !== 'production' && enabled;
    }

    private resolveTenantSlugFromFrontendUrl(): string | undefined {
        const frontendUrl = (process.env.FRONTEND_URL || '').trim();
        if (!frontendUrl) return undefined;

        try {
            const frontendHost = new URL(frontendUrl).hostname.toLowerCase();
            const parts = frontendHost.split('.').filter(Boolean);

            if (parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'api') {
                return parts[0];
            }

            if (parts.length === 2 && parts[1] === 'localhost' && parts[0] !== 'www' && parts[0] !== 'api') {
                return parts[0];
            }
        } catch {
            return undefined;
        }

        return undefined;
    }

    private resolveTenantSlug(req: Request, providedTenantSlug?: string): string {
        if (providedTenantSlug?.trim()) {
            return providedTenantSlug.trim().toLowerCase();
        }

        const headerTenant = req.headers['x-tenant-id'] as string;
        if (headerTenant?.trim()) {
            return headerTenant.trim().toLowerCase();
        }

        const host = req.headers['host'] || '';
        const hostWithoutPort = host.split(':')[0];
        const parts = hostWithoutPort.split('.');
        const isIpv4 = this.isIpv4Host(hostWithoutPort);

        if (!isIpv4 && parts.length >= 3 && parts[0] !== 'www' && parts[0] !== 'api') {
            return parts[0].toLowerCase();
        }

        // Support local subdomains like demo.localhost for UAT/dev use.
        if (parts.length === 2 && parts[1] === 'localhost' && parts[0] !== 'www' && parts[0] !== 'api') {
            return parts[0].toLowerCase();
        }

        if (hostWithoutPort === 'localhost' || hostWithoutPort === '127.0.0.1') {
            const configuredTenantSlug = this.resolveTenantSlugFromFrontendUrl();
            if (configuredTenantSlug) {
                return configuredTenantSlug;
            }
        }

        if (this.isDemoTenantFallbackEnabled()) {
            return 'demo';
        }

        throw new BadRequestException('Workspace context is missing. Sign in via your workspace URL (for example: https://acme.your-domain.com).');
    }

    private getRefreshCookieOptions() {
        const refreshDays = Number(process.env.REFRESH_TOKEN_DAYS || 7);
        const isProd = process.env.NODE_ENV === 'production';
        return {
            httpOnly: true,
            secure: isProd,
            sameSite: 'lax' as const,
            maxAge: refreshDays * 24 * 60 * 60 * 1000,
            // Use '/' so the browser sends the cookie regardless of proxy path-rewriting
            // (Vite dev proxy rewrites /api → /api/v1, so a path of /api/v1/auth would
            // never match the browser-visible request path /api/auth/...)
            path: '/',
        };
    }

    private setRefreshCookie(res: Response, refreshToken: string) {
        res.cookie(REFRESH_COOKIE_NAME, refreshToken, this.getRefreshCookieOptions());
    }

    private clearRefreshCookie(res: Response) {
        res.clearCookie(REFRESH_COOKIE_NAME, {
            ...this.getRefreshCookieOptions(),
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

    @Post('register')
    @Throttle({
        short: { limit: 2, ttl: 1000 },
        medium: { limit: 6, ttl: 10000 },
        long: { limit: 20, ttl: 60000 },
    })
    @ApiOperation({ summary: 'Register a new user' })
    @ApiResponse({ status: 201, description: 'User registered successfully' })
    @ApiResponse({ status: 400, description: 'Invalid input' })
    @ApiResponse({ status: 409, description: 'Email already exists' })
    @ApiResponse({ status: 429, description: 'Too many registration attempts' })
    async register(
        @Body() dto: RegisterDto,
        @Res({ passthrough: true }) res: Response,
    ): Promise<PublicTokenResponse> {
        const tokenResponse = await this.authService.register(dto);
        if (tokenResponse.refreshToken) {
            this.setRefreshCookie(res, tokenResponse.refreshToken);
        }
        return this.toPublicTokenResponse(tokenResponse);
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
            this.setRefreshCookie(res, tokenResponse.refreshToken);
        }
        return this.toPublicTokenResponse(tokenResponse);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Refresh access token' })
    @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
    @ApiResponse({ status: 401, description: 'Invalid refresh token' })
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
            this.setRefreshCookie(res, tokenResponse.refreshToken);
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
        this.clearRefreshCookie(res);
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
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Reset password using a valid token' })
    @ApiResponse({ status: 204, description: 'Password reset successfully' })
    async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
        await this.authService.resetPassword(dto);
    }
}

