import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private fromAddress: string | null = null;

  private getBooleanConfig(key: string, fallback = false): boolean {
    const rawValue = this.configService.get<string>(key);
    if (rawValue == null) {
      return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(rawValue.trim().toLowerCase());
  }

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') || 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from = this.configService.get<string>('SMTP_FROM');
    const secure = this.getBooleanConfig('SMTP_SECURE', port === 465);
    const requireTLS = this.getBooleanConfig('SMTP_REQUIRE_TLS');
    const ignoreTLS = this.getBooleanConfig('SMTP_IGNORE_TLS');
    const rejectUnauthorized = this.getBooleanConfig('SMTP_TLS_REJECT_UNAUTHORIZED', true);

    this.fromAddress = from || null;

    if (!host || !from) {
      this.logger.warn('SMTP is not fully configured; email delivery is disabled.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS,
      ignoreTLS,
      auth: user && pass ? { user, pass } : undefined,
      tls: {
        rejectUnauthorized,
      },
    });
  }

  isConfigured(): boolean {
    return !!this.transporter && !!this.fromAddress;
  }

  async sendPasswordReset(params: {
    to: string;
    firstName?: string;
    resetLink: string;
    expiresInMinutes: number;
  }): Promise<void> {
    if (!this.transporter || !this.fromAddress) {
      this.logger.warn(`Skipping password-reset email for ${params.to}: SMTP not configured.`);
      return;
    }

    const name = params.firstName?.trim() || 'there';

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: 'Reset your ForecastHub password',
      text: `Hi ${name},\n\nWe received a request to reset your password.\n\nReset link: ${params.resetLink}\n\nThis link expires in ${params.expiresInMinutes} minutes.\nIf you did not request this, you can ignore this email.\n`,
      html: `<p>Hi ${name},</p><p>We received a request to reset your password.</p><p><a href="${params.resetLink}">Reset your password</a></p><p>This link expires in ${params.expiresInMinutes} minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
    });
  }

  async sendInvitation(params: {
    to: string;
    firstName?: string;
    workspaceName: string;
    workspaceUrl: string;
    temporaryPassword: string;
    invitedBy?: string;
  }): Promise<void> {
    if (!this.transporter || !this.fromAddress) {
      throw new Error('SMTP is not fully configured for invitation delivery.');
    }

    const name = params.firstName?.trim() || 'there';
    const inviterLine = params.invitedBy ? `Invited by: ${params.invitedBy}\n\n` : '';

    await this.transporter.sendMail({
      from: this.fromAddress,
      to: params.to,
      subject: `You have been invited to ${params.workspaceName}`,
      text:
        `Hi ${name},\n\n` +
        `You have been invited to join ${params.workspaceName} in ForecastHub.\n\n` +
        inviterLine +
        `Workspace URL: ${params.workspaceUrl}\n` +
        `Temporary password: ${params.temporaryPassword}\n\n` +
        `Sign in with this temporary password. Your account will activate on first sign-in. Change your password immediately after logging in.\n`,
      html:
        `<p>Hi ${name},</p>` +
        `<p>You have been invited to join <strong>${params.workspaceName}</strong> in ForecastHub.</p>` +
        (params.invitedBy ? `<p>Invited by: ${params.invitedBy}</p>` : '') +
        `<p><strong>Workspace URL:</strong> <a href="${params.workspaceUrl}">${params.workspaceUrl}</a></p>` +
        `<p><strong>Temporary password:</strong> <code>${params.temporaryPassword}</code></p>` +
        `<p>Sign in with this temporary password. Your account will activate on first sign-in. Change your password immediately after logging in.</p>`,
    });
  }
}
