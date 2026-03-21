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
  offeringId: uuidSchema,
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

export const offeringCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(["TRIGGER", "FIXED", "VARIABLE"]),
  priceCents: z.number().int().positive(),
  fixedMinutes: z.number().int().positive().optional(),
  minutesPer25c: z.number().int().positive().optional(),
});

export const offeringUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  type: z.enum(["TRIGGER", "FIXED", "VARIABLE"]).optional(),
  priceCents: z.number().int().positive().optional(),
  fixedMinutes: z.number().int().positive().nullable().optional(),
  minutesPer25c: z.number().int().positive().nullable().optional(),
  active: z.boolean().optional(),
});

export const deviceOfferingAssignSchema = z.object({
  offeringIds: z.array(uuidSchema).min(1),
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

const dailyScheduleSchema = z.object({
  dayOfWeek: z.enum(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
});

export const vendorModelCreateSchema = z.object({
  name: z.string().min(1).max(255),
  type: z.enum(["Washer", "Dryer", "Parking", "Locker", "Vending"]).optional(),
  pricing: z.enum(["fixed", "variable"]).optional(),
  slot: z.enum(["single", "multi1D", "multi2D"]).optional(),
  slotPricing: z.enum(["Tiered", "Unique"]).optional(),
  action: z.enum(["timed", "sequence"]).optional(),
  interruption: z.enum(["stop", "continue"]).optional(),
  payment: z.enum(["atStart", "atEnd"]).optional(),
  schedule: z.array(dailyScheduleSchema).optional(),
});

export const vendorModelUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(["Washer", "Dryer", "Parking", "Locker", "Vending"]).optional(),
  pricing: z.enum(["fixed", "variable"]).optional(),
  slot: z.enum(["single", "multi1D", "multi2D"]).optional(),
  slotPricing: z.enum(["Tiered", "Unique"]).optional(),
  action: z.enum(["timed", "sequence"]).optional(),
  interruption: z.enum(["stop", "continue"]).optional(),
  payment: z.enum(["atStart", "atEnd"]).optional(),
  schedule: z.array(dailyScheduleSchema).nullable().optional(),
});

const offeringSignalSchema = z.object({
  pinNumber: z.number().int().min(0).max(25),
  duration: z.number().int().positive(),
});

const variablePricingTierSchema = z.object({
  type: z.literal("variable"),
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  currencyCode: z.string().length(3),
  startPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  startDuration: z.number().int().positive(),
  startDurationUnit: z.enum(["minutes", "hours"]),
  marginalPrice: z.string().regex(/^\d+(\.\d{1,2})?$/),
  marginalDuration: z.number().int().positive(),
  marginalDurationUnit: z.enum(["minutes", "hours"]),
  pinNumber: z.number().int().min(0).max(25),
});

const fixedPricingTierSchema = z.object({
  type: z.literal("fixed"),
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  currencyCode: z.string().length(3),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/),
  signals: z.array(offeringSignalSchema),
});

const pricingTierSchema = z.discriminatedUnion("type", [
  variablePricingTierSchema,
  fixedPricingTierSchema,
]);

export const vendorOfferingCreateSchema = z.object({
  vendorLocationId: uuidSchema,
  vendorModelId: uuidSchema,
  name: z.string().min(1).max(255),
  pricingTiers: z.array(pricingTierSchema),
});

export const vendorOfferingUpdateSchema = z.object({
  vendorLocationId: uuidSchema.optional(),
  vendorModelId: uuidSchema.optional(),
  name: z.string().min(1).max(255).optional(),
  pricingTiers: z.array(pricingTierSchema).optional(),
});

export const vendorInstallationCreateSchema = z.object({
  walletAddress: ethAddressSchema,
  vendorOfferingId: uuidSchema,
  label: z.string().min(1).max(255),
  pricingTierId: z.string().min(1).optional(),
  pricingTier: pricingTierSchema.optional(),
});

export const vendorInstallationUpdateSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  vendorOfferingId: uuidSchema.optional(),
  pricingTierId: z.string().min(1).nullable().optional(),
  pricingTier: pricingTierSchema.nullable().optional(),
});

// Entity schemas
export const entitySlugParamSchema = z.object({
  entitySlug: z.string().min(1),
});

export const entityCreateSchema = z.object({
  displayName: z.string().optional(),
  acceptTos: z.literal(true),
});
