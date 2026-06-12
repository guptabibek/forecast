import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { BillingValidationError, PaymentProviderError } from './billing.errors';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
/** Reject webhook events whose timestamp is older than this (replay window). */
const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface StripeCheckoutSession {
  id: string;
  url: string;
  payment_intent?: string | null;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, any> };
}

/**
 * Minimal Stripe REST client over native fetch — same no-SDK convention the
 * codebase uses for OpenAI. Only the backend ever talks to Stripe; the
 * frontend receives a hosted checkout URL.
 */
@Injectable()
export class StripeClient {
  private readonly logger = new Logger(StripeClient.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.secretKey());
  }

  async createCheckoutSession(input: {
    amountCents: number;
    currency: string;
    customerEmail?: string | null;
    successUrl: string;
    cancelUrl: string;
    purchaseId: string;
    tenantId: string;
    idempotencyKey: string;
  }): Promise<StripeCheckoutSession> {
    const body = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(input.amountCents),
      'line_items[0][price_data][product_data][name]': 'AI Credits',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      'metadata[purchaseId]': input.purchaseId,
      'metadata[tenantId]': input.tenantId,
      'payment_intent_data[metadata][purchaseId]': input.purchaseId,
      ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
    });
    return this.post<StripeCheckoutSession>('/checkout/sessions', body, input.idempotencyKey);
  }

  async createRefund(input: { paymentIntentId: string; amountCents?: number; idempotencyKey: string }) {
    const body = new URLSearchParams({
      payment_intent: input.paymentIntentId,
      ...(input.amountCents ? { amount: String(input.amountCents) } : {}),
    });
    return this.post<{ id: string; status: string }>('/refunds', body, input.idempotencyKey);
  }

  /**
   * Stripe webhook signature verification (Stripe-Signature header):
   * HMAC-SHA256 over `${timestamp}.${rawPayload}` with the endpoint secret,
   * constant-time comparison, bounded replay window. Failures throw 400
   * (caller error) — 5xx would make Stripe treat the endpoint as down and
   * retry aggressively.
   */
  verifyWebhookSignature(rawPayload: Buffer | string, signatureHeader: string | undefined, now: number = Math.floor(Date.now() / 1000)): StripeWebhookEvent {
    const secret = this.webhookSecret();
    if (!secret) throw new PaymentProviderError('Stripe webhook secret is not configured');
    if (!signatureHeader) throw new BillingValidationError('Missing Stripe-Signature header');

    const parts = new Map<string, string[]>();
    for (const piece of signatureHeader.split(',')) {
      const [key, value] = piece.split('=', 2);
      if (!key || value === undefined) continue;
      const list = parts.get(key.trim()) ?? [];
      list.push(value.trim());
      parts.set(key.trim(), list);
    }
    const timestamp = Number(parts.get('t')?.[0]);
    const signatures = parts.get('v1') ?? [];
    if (!Number.isFinite(timestamp) || !signatures.length) {
      throw new BillingValidationError('Malformed Stripe-Signature header');
    }
    if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      throw new BillingValidationError('Stripe webhook timestamp outside tolerance (possible replay)');
    }

    const payload = typeof rawPayload === 'string' ? rawPayload : rawPayload.toString('utf8');
    const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const valid = signatures.some((candidate) => {
      const candidateBuf = Buffer.from(candidate, 'utf8');
      return candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf);
    });
    if (!valid) throw new BillingValidationError('Stripe webhook signature verification failed');

    try {
      return JSON.parse(payload) as StripeWebhookEvent;
    } catch {
      throw new BillingValidationError('Stripe webhook payload is not valid JSON');
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async post<T>(path: string, body: URLSearchParams, idempotencyKey: string): Promise<T> {
    const key = this.secretKey();
    if (!key) throw new PaymentProviderError('Stripe is not configured (STRIPE_SECRET_KEY missing)');
    const response = await fetch(`${STRIPE_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': idempotencyKey,
      },
      body: body.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = (payload as any)?.error?.message ?? `Stripe request failed (${response.status})`;
      this.logger.warn(`Stripe ${path} failed: ${message}`);
      throw new PaymentProviderError(message);
    }
    return payload as T;
  }

  private secretKey(): string | undefined {
    return this.config.get<string>('STRIPE_SECRET_KEY') || undefined;
  }

  private webhookSecret(): string | undefined {
    return this.config.get<string>('STRIPE_WEBHOOK_SECRET') || undefined;
  }
}
