import { createHmac } from 'crypto';
import { StripeClient } from './stripe.client';
import { BillingValidationError } from './billing.errors';

const WEBHOOK_SECRET = 'whsec_test_secret_for_unit_tests';

function buildClient() {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'STRIPE_WEBHOOK_SECRET') return WEBHOOK_SECRET;
      if (key === 'STRIPE_SECRET_KEY') return 'sk_test_x';
      return undefined;
    }),
  } as any;
  return new StripeClient(config);
}

function sign(payload: string, timestamp: number, secret = WEBHOOK_SECRET): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

describe('StripeClient webhook verification', () => {
  const event = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
  const now = 1_700_000_000;

  it('accepts a correctly signed payload within tolerance', () => {
    const client = buildClient();
    const parsed = client.verifyWebhookSignature(Buffer.from(event), sign(event, now), now);
    expect(parsed.id).toBe('evt_1');
    expect(parsed.type).toBe('checkout.session.completed');
  });

  it('rejects a tampered payload', () => {
    const client = buildClient();
    const tampered = event.replace('cs_1', 'cs_EVIL');
    expect(() => client.verifyWebhookSignature(Buffer.from(tampered), sign(event, now), now)).toThrow(BillingValidationError);
  });

  it('rejects a signature from the wrong secret', () => {
    const client = buildClient();
    expect(() => client.verifyWebhookSignature(Buffer.from(event), sign(event, now, 'whsec_other'), now)).toThrow(
      /signature verification failed/,
    );
  });

  it('rejects replays outside the tolerance window', () => {
    const client = buildClient();
    const stale = now - 301;
    expect(() => client.verifyWebhookSignature(Buffer.from(event), sign(event, stale), now)).toThrow(/replay/);
  });

  it('rejects missing or malformed signature headers', () => {
    const client = buildClient();
    expect(() => client.verifyWebhookSignature(Buffer.from(event), undefined, now)).toThrow(/Missing Stripe-Signature/);
    expect(() => client.verifyWebhookSignature(Buffer.from(event), 'garbage', now)).toThrow(/Malformed/);
  });

  it('accepts when one of several v1 signatures matches (key rotation)', () => {
    const client = buildClient();
    const good = createHmac('sha256', WEBHOOK_SECRET).update(`${now}.${event}`).digest('hex');
    const header = `t=${now},v1=${'0'.repeat(64)},v1=${good}`;
    expect(client.verifyWebhookSignature(Buffer.from(event), header, now).id).toBe('evt_1');
  });
});
