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
    // Default to false — many internal mail servers use self-signed certificates
    const rejectUnauthorized = this.getBooleanConfig('SMTP_TLS_REJECT_UNAUTHORIZED', false);

    this.fromAddress = from || null;

    if (!host || !from) {
      this.logger.warn('SMTP is not fully configured; email delivery is disabled.');
      return;
    }

    this.logger.log(`Configuring SMTP transport: host=${host}, port=${port}, secure=${secure}, requireTLS=${requireTLS}, user=${user ? '***' : '(none)'}`);

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
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    // Verify SMTP connection on startup (non-blocking)
    this.transporter.verify()
      .then(() => this.logger.log('SMTP connection verified successfully'))
      .catch((err) => this.logger.error(`SMTP connection verification failed: ${err.message}`));
  }

  isConfigured(): boolean {
    return !!this.transporter && !!this.fromAddress;
  }

  private async safeSend(mailOptions: nodemailer.SendMailOptions): Promise<void> {
    if (!this.transporter || !this.fromAddress) {
      this.logger.warn(`Skipping email to ${mailOptions.to}: SMTP not configured.`);
      return;
    }

    try {
      const info = await this.transporter.sendMail({ from: this.fromAddress, ...mailOptions });
      this.logger.log(`Email sent to ${mailOptions.to}: messageId=${info.messageId}`);
    } catch (err: any) {
      this.logger.error(`Failed to send email to ${mailOptions.to}: ${err.message}`, err.stack);
      throw err;
    }
  }

  async sendPasswordResetOtp(params: {
    to: string;
    firstName?: string;
    otp: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const name = params.firstName?.trim() || 'there';

    await this.safeSend({
      to: params.to,
      subject: 'Your password reset code',
      text:
        `Hi ${name},\n\n` +
        `Your password reset code is: ${params.otp}\n\n` +
        `This code expires in ${params.expiresInMinutes} minutes.\n` +
        `If you did not request this, you can ignore this email.\n`,
      html:
        `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">` +
        `<p>Hi ${name},</p>` +
        `<p>Your password reset code is:</p>` +
        `<div style="text-align: center; margin: 24px 0;">` +
        `<span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; background: #f3f4f6; padding: 16px 32px; border-radius: 8px; display: inline-block;">${params.otp}</span>` +
        `</div>` +
        `<p>This code expires in <strong>${params.expiresInMinutes} minutes</strong>.</p>` +
        `<p style="color: #6b7280; font-size: 14px;">If you did not request this, you can safely ignore this email.</p>` +
        `</div>`,
    });
  }

  async sendPasswordReset(params: {
    to: string;
    firstName?: string;
    resetLink: string;
    expiresInMinutes: number;
  }): Promise<void> {
    const name = params.firstName?.trim() || 'there';

    await this.safeSend({
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

    await this.safeSend({
      to: params.to,
      subject: `You have been invited to ${params.workspaceName}`,
      text:
        `Hi ${name},\n\n` +
        `You have been invited to join ${params.workspaceName} in ForecastHub.\n\n` +
        inviterLine +
        `Workspace URL: ${params.workspaceUrl}\n` +
        `Temporary password: ${params.temporaryPassword}\n\n` +
        `Sign in with this temporary password. You will be asked to set a new password on first sign-in.\n`,
      html:
        `<p>Hi ${name},</p>` +
        `<p>You have been invited to join <strong>${params.workspaceName}</strong> in ForecastHub.</p>` +
        (params.invitedBy ? `<p>Invited by: ${params.invitedBy}</p>` : '') +
        `<p><strong>Workspace URL:</strong> <a href="${params.workspaceUrl}">${params.workspaceUrl}</a></p>` +
        `<p><strong>Temporary password:</strong> <code>${params.temporaryPassword}</code></p>` +
        `<p>Sign in with this temporary password. You will be asked to set a new password on first sign-in.</p>`,
    });
  }
}
