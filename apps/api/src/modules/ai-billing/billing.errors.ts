import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Billing errors carry stable machine codes so the frontend and financial
 * tooling can branch on them without parsing prose.
 */
export class AiBillingError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus) {
    super({ code, message }, status);
  }
}

export class InsufficientCreditsError extends AiBillingError {
  constructor(message = 'Insufficient AI credits — purchase credits to continue') {
    super('INSUFFICIENT_CREDITS', message, HttpStatus.PAYMENT_REQUIRED);
  }
}

export class WalletSuspendedError extends AiBillingError {
  constructor(message = 'AI wallet is suspended — contact support or recharge') {
    super('WALLET_SUSPENDED', message, HttpStatus.PAYMENT_REQUIRED);
  }
}

export class AiAccessDeniedError extends AiBillingError {
  constructor(code: string, message: string) {
    super(code, message, HttpStatus.FORBIDDEN);
  }
}

export class SpendLimitExceededError extends AiBillingError {
  constructor(message: string) {
    super('AI_SPEND_LIMIT_EXCEEDED', message, HttpStatus.PAYMENT_REQUIRED);
  }
}

export class BillingValidationError extends AiBillingError {
  constructor(message: string) {
    super('AI_BILLING_VALIDATION', message, HttpStatus.BAD_REQUEST);
  }
}

export class BillingNotFoundError extends AiBillingError {
  constructor(message: string) {
    super('AI_BILLING_NOT_FOUND', message, HttpStatus.NOT_FOUND);
  }
}

export class PricingMissingError extends AiBillingError {
  constructor(message = 'No active pricing is configured for this model') {
    super('AI_PRICING_MISSING', message, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

export class PaymentProviderError extends AiBillingError {
  constructor(message: string) {
    super('PAYMENT_PROVIDER_ERROR', message, HttpStatus.BAD_GATEWAY);
  }
}
