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

// Vendor management schemas
export const vendorLocationCreateSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().min(1).max(255),
  city: z.string().min(1).max(255),
  stateProvince: z.string().min(1).max(255),
  zipcode: z.string().min(1).max(20),
  country: z.string().min(1).max(100),
});

export const vendorLocationUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  address: z.string().min(1).max(255).optional(),
  city: z.string().min(1).max(255).optional(),
  stateProvince: z.string().min(1).max(255).optional(),
  zipcode: z.string().min(1).max(20).optional(),
  country: z.string().min(1).max(100).optional(),
});

export const vendorEquipmentCategoryCreateSchema = z.object({
  name: z.string().min(1).max(255),
});

export const vendorEquipmentCategoryUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

export const vendorServiceCreateSchema = z.object({
  vendorLocationId: uuidSchema,
  vendorEquipmentCategoryId: uuidSchema,
  name: z.string().min(1).max(255),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, "Invalid price format"),
  currencyCode: z.string().length(3).optional(),
});

export const vendorServiceUpdateSchema = z.object({
  vendorLocationId: uuidSchema.optional(),
  vendorEquipmentCategoryId: uuidSchema.optional(),
  name: z.string().min(1).max(255).optional(),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Invalid price format")
    .optional(),
  currencyCode: z.string().length(3).optional(),
});

export const vendorServiceControlCreateSchema = z.object({
  vendorServiceId: uuidSchema,
  pinNumber: z.number().int().min(1).max(5),
  duration: z.number().int().positive(),
});

export const vendorServiceControlUpdateSchema = z.object({
  pinNumber: z.number().int().min(1).max(5).optional(),
  duration: z.number().int().positive().optional(),
});

export const vendorEquipmentCreateSchema = z.object({
  walletAddress: ethAddressSchema,
  vendorServiceId: uuidSchema,
  name: z.string().min(1).max(255),
});

export const vendorEquipmentUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  vendorServiceId: uuidSchema.optional(),
});
