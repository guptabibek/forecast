import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private fromAddress: string | null = null;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<string>('SMTP_PORT') || 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    const from = this.configService.get<string>('SMTP_FROM');

    this.fromAddress = from || null;

    if (!host || !from) {
      this.logger.warn('SMTP is not fully configured; email delivery is disabled.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user && pass ? { user, pass } : undefined,
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
}
