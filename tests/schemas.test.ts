import { describe, it, expect } from 'vitest';
import {
  ethAddressSchema,
  uuidSchema,
  deviceVerifySchema,
  createOrderSchema,
  processPaymentSchema,
  createAuthorizationSchema,
  telemetryEventSchema,
  deviceCreateSchema,
  deviceUpdateSchema,
  offeringCreateSchema,
  offeringUpdateSchema,
  deviceOfferingAssignSchema,
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
      offeringId: '550e8400-e29b-41d4-a716-446655440000',
      amountCents: 100,
    });
    expect(result.amountCents).toBe(100);
  });

  it('rejects zero amount', () => {
    expect(() =>
      createOrderSchema.parse({
        deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        offeringId: '550e8400-e29b-41d4-a716-446655440000',
        amountCents: 0,
      })
    ).toThrow();
  });

  it('rejects negative amount', () => {
    expect(() =>
      createOrderSchema.parse({
        deviceWalletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        offeringId: '550e8400-e29b-41d4-a716-446655440000',
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

describe('deviceCreateSchema', () => {
  it('accepts valid device with all fields', () => {
    const result = deviceCreateSchema.parse({
      walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
      label: 'Laundry Machine 1',
      model: 'Pi 4',
      location: 'Floor 1',
      gpioConfig: { pin: 17, activeLow: false },
    });
    expect(result.label).toBe('Laundry Machine 1');
  });

  it('accepts device with only required fields', () => {
    const result = deviceCreateSchema.parse({
      walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
      label: 'Device',
    });
    expect(result.model).toBeUndefined();
  });

  it('rejects empty label', () => {
    expect(() =>
      deviceCreateSchema.parse({
        walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        label: '',
      })
    ).toThrow();
  });

  it('rejects GPIO pin > 40', () => {
    expect(() =>
      deviceCreateSchema.parse({
        walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD08',
        label: 'Device',
        gpioConfig: { pin: 50 },
      })
    ).toThrow();
  });
});

describe('deviceUpdateSchema', () => {
  it('accepts partial update', () => {
    const result = deviceUpdateSchema.parse({ label: 'New Name' });
    expect(result.label).toBe('New Name');
  });

  it('accepts status update', () => {
    const result = deviceUpdateSchema.parse({ status: 'MAINTENANCE' });
    expect(result.status).toBe('MAINTENANCE');
  });

  it('rejects invalid status', () => {
    expect(() => deviceUpdateSchema.parse({ status: 'INVALID' })).toThrow();
  });
});

describe('offeringCreateSchema', () => {
  it('accepts TRIGGER offering', () => {
    const result = offeringCreateSchema.parse({
      name: 'Quick Wash',
      type: 'TRIGGER',
      priceCents: 100,
    });
    expect(result.type).toBe('TRIGGER');
  });

  it('accepts FIXED offering with fixedMinutes', () => {
    const result = offeringCreateSchema.parse({
      name: 'Standard Wash',
      type: 'FIXED',
      priceCents: 200,
      fixedMinutes: 30,
    });
    expect(result.fixedMinutes).toBe(30);
  });

  it('accepts TIMED offering with minutesPer25c', () => {
    const result = offeringCreateSchema.parse({
      name: 'Air Compressor',
      type: 'TIMED',
      priceCents: 25,
      minutesPer25c: 5,
    });
    expect(result.minutesPer25c).toBe(5);
  });

  it('rejects invalid offering type', () => {
    expect(() =>
      offeringCreateSchema.parse({
        name: 'Bad',
        type: 'INVALID',
        priceCents: 100,
      })
    ).toThrow();
  });
});

describe('offeringUpdateSchema', () => {
  it('accepts partial update', () => {
    const result = offeringUpdateSchema.parse({ active: false });
    expect(result.active).toBe(false);
  });

  it('accepts nullable fields', () => {
    const result = offeringUpdateSchema.parse({ fixedMinutes: null });
    expect(result.fixedMinutes).toBeNull();
  });
});

describe('deviceOfferingAssignSchema', () => {
  it('accepts valid offering IDs', () => {
    const result = deviceOfferingAssignSchema.parse({
      offeringIds: ['550e8400-e29b-41d4-a716-446655440000'],
    });
    expect(result.offeringIds).toHaveLength(1);
  });

  it('rejects empty array', () => {
    expect(() => deviceOfferingAssignSchema.parse({ offeringIds: [] })).toThrow();
  });

  it('rejects invalid UUIDs', () => {
    expect(() => deviceOfferingAssignSchema.parse({ offeringIds: ['not-uuid'] })).toThrow();
  });
});
