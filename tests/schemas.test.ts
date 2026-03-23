import { describe, it, expect } from 'vitest';
import {
  ethAddressSchema,
  uuidSchema,
  deviceVerifySchema,
  createOrderSchema,
  processPaymentSchema,
  createAuthorizationSchema,
  telemetryEventSchema,
} from '../src/schemas/index';

describe('ethAddressSchema', () => {
  it('accepts valid Ethereum address', () => {
    expect(ethAddressSchema.parse('0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08')).toBeDefined();
  });

  it('rejects address without 0x prefix', () => {
    expect(() => ethAddressSchema.parse('742d35Cc6634C0532925a3b844Bc9e7595f2bD08')).toThrow();
  });

  it('rejects short address', () => {
    expect(() => ethAddressSchema.parse('0x742d35Cc')).toThrow();
  });

  it('rejects non-hex characters', () => {
    expect(() => ethAddressSchema.parse('0xZZZZ35Cc6634C0532925a3b844Bc9e7595f2bD08')).toThrow();
  });
});

describe('uuidSchema', () => {
  it('accepts valid UUID', () => {
    expect(uuidSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBeDefined();
  });

  it('rejects invalid UUID', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
  });
});

describe('deviceVerifySchema', () => {
  it('accepts valid verify request', () => {
    const result = deviceVerifySchema.parse({
      deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
      signedPayload: '{"walletAddress":"0x...","timestamp":123}',
      signature: '0xabc123',
    });
    expect(result.deviceWalletAddress).toBeDefined();
  });

  it('rejects empty signedPayload', () => {
    expect(() =>
      deviceVerifySchema.parse({
        deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        signedPayload: '',
        signature: '0xabc',
      })
    ).toThrow();
  });
});

describe('createOrderSchema', () => {
  it('accepts valid order', () => {
    const result = createOrderSchema.parse({
      deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
      pricingTierId: 'tier-123',
      amountCents: 100,
    });
    expect(result.amountCents).toBe(100);
  });

  it('rejects zero amount', () => {
    expect(() =>
      createOrderSchema.parse({
        deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        pricingTierId: 'tier-123',
        amountCents: 0,
      })
    ).toThrow();
  });

  it('rejects negative amount', () => {
    expect(() =>
      createOrderSchema.parse({
        deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        pricingTierId: 'tier-123',
        amountCents: -50,
      })
    ).toThrow();
  });
});

describe('processPaymentSchema', () => {
  it('accepts valid payment', () => {
    const result = processPaymentSchema.parse({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      paymentMethodId: 'pm_test_123',
    });
    expect(result.paymentMethodId).toBe('pm_test_123');
  });
});

describe('telemetryEventSchema', () => {
  it('accepts valid telemetry event', () => {
    const result = telemetryEventSchema.parse({
      deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
      direction: 'PI_TO_SRV',
      ok: true,
      details: 'relay activated',
    });
    expect(result.direction).toBe('PI_TO_SRV');
  });

  it('accepts event without optional details', () => {
    const result = telemetryEventSchema.parse({
      deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
      direction: 'SRV_TO_PI',
      ok: false,
    });
    expect(result.details).toBeUndefined();
  });

  it('rejects invalid direction', () => {
    expect(() =>
      telemetryEventSchema.parse({
        deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        direction: 'INVALID',
        ok: true,
      })
    ).toThrow();
  });
});
