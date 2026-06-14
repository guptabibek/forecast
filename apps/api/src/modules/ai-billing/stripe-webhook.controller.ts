import { Controller, Headers, HttpCode, Logger, Post, Req, SetMetadata } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SKIP_TENANT_CHECK } from '../../core/guards/tenant.guard';
import { PurchaseService } from './purchase.service';
import { StripeClient } from './stripe.client';

/**
 * Stripe webhook receiver. Unauthenticated by necessity — security comes from
 * the HMAC signature over the RAW request body (captured in main.ts), the
 * replay-window check, and idempotent purchase completion. Always answers
 * 200 for verified events (Stripe retries non-2xx) and 400 for bad
 * signatures so misconfigured secrets surface in the Stripe dashboard.
 *
 * SKIP_TENANT_CHECK: this is a system endpoint with NO tenant context (no JWT,
 * no X-Tenant-ID, no subdomain). Without this, the global TenantGuard rejects
 * the request with 403 BEFORE the handler runs — the wallet is never credited
 * and nothing is logged. The handler operates as a system context and passes
 * the tenantId resolved from the purchase row explicitly to every write, like
 * the platform's other background/system flows.
 *
 * SkipThrottle: Stripe delivers from a shared pool of source IPs and retries
 * aggressively; the per-IP rate limiter must not drop verified webhooks under
 * load. Authenticity is already guaranteed by signature verification.
 */
@ApiTags('AI Billing Webhooks')
@Controller('ai-billing/webhooks')
@SetMetadata(SKIP_TENANT_CHECK, true)
@SkipThrottle()
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeClient,
    private readonly purchases: PurchaseService,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stripe event webhook (signature-verified)' })
  async handle(@Req() request: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string) {
    const raw = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    let event;
    try {
      event = this.stripe.verifyWebhookSignature(raw, signature);
    } catch (error: any) {
      // Surface misconfigured/missing webhook secret and bad signatures in the
      // server logs (visible at warn) — otherwise the only symptom is "credits
      // never arrive" with no trace. The error still propagates to the right
      // HTTP status for Stripe's dashboard.
      this.logger.warn(`Stripe webhook rejected (signaturePresent=${Boolean(signature)}): ${String(error?.message ?? error)}`);
      throw error;
    }
    const result = await this.purchases.handleStripeEvent(event);
    this.logger.log(`Stripe webhook ${event.type} (${event.id}): handled=${result.handled}`);
    return { received: true, handled: result.handled };
  }
}
