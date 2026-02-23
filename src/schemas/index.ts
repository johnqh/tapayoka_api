import { z } from "zod";

// =============================================================================
// Validation Schemas (Zod)
// =============================================================================

export const ethAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address");

export const uuidSchema = z.string().uuid("Invalid UUID");

// Buyer schemas
export const deviceVerifySchema = z.object({
  deviceWalletAddress: ethAddressSchema,
  signedPayload: z.string().min(1),
  signature: z.string().min(1),
});

export const createOrderSchema = z.object({
  deviceWalletAddress: ethAddressSchema,
  serviceId: uuidSchema,
  amountCents: z.number().int().positive(),
});

export const processPaymentSchema = z.object({
  orderId: uuidSchema,
  paymentMethodId: z.string().min(1),
});

export const createAuthorizationSchema = z.object({
  orderId: uuidSchema,
});

export const telemetryEventSchema = z.object({
  deviceWalletAddress: ethAddressSchema,
  direction: z.enum(["PI_TO_SRV", "SRV_TO_PI"]),
  ok: z.boolean(),
  details: z.string().optional(),
});

// Vendor schemas
export const deviceCreateSchema = z.object({
  walletAddress: ethAddressSchema,
  label: z.string().min(1).max(255),
  model: z.string().max(255).optional(),
  location: z.string().max(255).optional(),
  gpioConfig: z
    .object({
      pin: z.number().int().min(0).max(40),
      activeLow: z.boolean().optional(),
    })
    .optional(),
});

export const deviceUpdateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  model: z.string().max(255).nullable().optional(),
  location: z.string().max(255).nullable().optional(),
  gpioConfig: z
    .object({
      pin: z.number().int().min(0).max(40),
      activeLow: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  status: z
    .enum(["ACTIVE", "OFFLINE", "MAINTENANCE", "DEACTIVATED"])
    .optional(),
});

export const serviceCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(["TRIGGER", "FIXED", "VARIABLE"]),
  priceCents: z.number().int().positive(),
  fixedMinutes: z.number().int().positive().optional(),
  minutesPer25c: z.number().int().positive().optional(),
});

export const serviceUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(["TRIGGER", "FIXED", "VARIABLE"]).optional(),
  priceCents: z.number().int().positive().optional(),
  fixedMinutes: z.number().int().positive().nullable().optional(),
  minutesPer25c: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export const deviceServiceAssignSchema = z.object({
  serviceIds: z.array(uuidSchema).min(1),
});
