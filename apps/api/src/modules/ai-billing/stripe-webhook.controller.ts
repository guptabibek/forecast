import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PurchaseService } from './purchase.service';
import { StripeClient } from './stripe.client';

/**
 * Stripe webhook receiver. Unauthenticated by necessity — security comes from
 * the HMAC signature over the RAW request body (captured in main.ts), the
 * replay-window check, and idempotent purchase completion. Always answers
 * 200 for verified events (Stripe retries non-2xx) and 400 for bad
 * signatures so misconfigured secrets surface in the Stripe dashboard.
 */
@ApiTags('AI Billing Webhooks')
@Controller('ai-billing/webhooks')
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
    const event = this.stripe.verifyWebhookSignature(raw, signature);
    const result = await this.purchases.handleStripeEvent(event);
    this.logger.log(`Stripe webhook ${event.type} (${event.id}): handled=${result.handled}`);
    return { received: true, handled: result.handled };
  }
}
