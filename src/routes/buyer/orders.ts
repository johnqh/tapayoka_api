import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, desc, and, inArray } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  orders,
  vendorInstallations,
  vendorOfferings,
  vendorInstallationSlots,
} from "../../db/schema.ts";
import {
  createOrderSchema,
  processPaymentSchema,
  uuidSchema,
} from "../../schemas/index.ts";
import { createPaymentIntent, confirmPayment } from "../../services/stripe.ts";
import { successResponse, errorResponse, type PricingTier } from "@sudobility/tapayoka_types";
import type { AppEnv } from "../../lib/hono-types.ts";

const buyerOrders = new Hono<AppEnv>();

/** Calculate authorized seconds from a PricingTier */
function calculateAuthorizedSeconds(
  tier: PricingTier,
  amountCents: number,
): number {
  if (tier.type === "fixed") {
    return tier.signals.reduce((sum, s) => sum + s.duration, 0);
  }
  // timed
  const startPriceCents = Math.round(parseFloat(tier.startPrice) * 100);
  const startDurationSeconds =
    tier.startDurationUnit === "hours"
      ? tier.startDuration * 3600
      : tier.startDuration * 60;

  if (amountCents <= startPriceCents) {
    return startDurationSeconds;
  }

  const marginalPriceCents = Math.round(parseFloat(tier.marginalPrice) * 100);
  const marginalDurationSeconds =
    tier.marginalDurationUnit === "hours"
      ? tier.marginalDuration * 3600
      : tier.marginalDuration * 60;

  if (marginalPriceCents <= 0) return startDurationSeconds;

  const extraCents = amountCents - startPriceCents;
  const extraUnits = Math.floor(extraCents / marginalPriceCents);
  return startDurationSeconds + extraUnits * marginalDurationSeconds;
}

/**
 * GET / - List orders for the authenticated buyer
 */
buyerOrders.get("/", async c => {
  const buyerUid = c.get("firebaseUid") as string;
  const db = getDb();

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.buyerUid, buyerUid))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return c.json(successResponse(rows));
});

/**
 * POST / - Create a new order
 */
buyerOrders.post("/", zValidator("json", createOrderSchema), async c => {
  const { deviceWalletAddress, pricingTierId, amountCents, slotId } =
    c.req.valid("json");
  const buyerUid = c.get("firebaseUid") as string;

  const db = getDb();

  // Validate installation exists and is active
  const [installation] = await db
    .select()
    .from(vendorInstallations)
    .where(eq(vendorInstallations.walletAddress, deviceWalletAddress))
    .limit(1);

  if (!installation || installation.status !== "Active") {
    return c.json(errorResponse("Device not found or inactive"), 404);
  }

  // Get the offering's pricing tiers
  const [offering] = await db
    .select()
    .from(vendorOfferings)
    .where(eq(vendorOfferings.id, installation.vendorOfferingId))
    .limit(1);

  if (!offering) {
    return c.json(errorResponse("Offering not found"), 404);
  }

  // Find the matching pricing tier
  const tiers = offering.pricingTiers as PricingTier[];
  const tier = tiers.find(t => t.id === pricingTierId);
  if (!tier) {
    return c.json(errorResponse("Pricing tier not found"), 404);
  }

  // Validate amount
  const minCents =
    tier.type === "fixed"
      ? Math.round(parseFloat(tier.price) * 100)
      : Math.round(parseFloat(tier.startPrice) * 100);

  if (amountCents < minCents) {
    return c.json(
      errorResponse(
        `Amount ${amountCents} is less than minimum price ${minCents}`,
      ),
      400,
    );
  }

  // Validate slot if provided
  if (slotId) {
    const [slot] = await db
      .select()
      .from(vendorInstallationSlots)
      .where(
        and(
          eq(vendorInstallationSlots.id, slotId),
          eq(
            vendorInstallationSlots.installationWalletAddress,
            deviceWalletAddress,
          ),
        ),
      )
      .limit(1);

    if (!slot) {
      return c.json(errorResponse("Slot not found"), 404);
    }

    // Check slot availability
    const [activeOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.slotId, slotId),
          inArray(orders.status, [
            "CREATED",
            "PAID",
            "AUTHORIZED",
            "RUNNING",
          ] as const),
        ),
      )
      .limit(1);

    if (activeOrder) {
      return c.json(errorResponse("Slot is currently in use"), 409);
    }
  }

  const authorizedSeconds = calculateAuthorizedSeconds(tier, amountCents);

  // Create order
  const [order] = await db
    .insert(orders)
    .values({
      deviceWalletAddress,
      pricingTierId,
      buyerUid,
      amountCents,
      authorizedSeconds,
      ...(slotId ? { slotId } : {}),
    })
    .returning();

  return c.json(successResponse(order), 201);
});

/**
 * GET /:id - Get order by ID
 */
buyerOrders.get("/:id", async c => {
  const orderId = c.req.param("id");
  const parsed = uuidSchema.safeParse(orderId);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid order ID"), 400);
  }

  const db = getDb();
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) {
    return c.json(errorResponse("Order not found"), 404);
  }

  return c.json(successResponse(order));
});

/**
 * POST /:id/pay - Process payment for an order
 */
buyerOrders.post(
  "/:id/pay",
  zValidator("json", processPaymentSchema),
  async c => {
    const { orderId, paymentMethodId } = c.req.valid("json");

    const db = getDb();
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return c.json(errorResponse("Order not found"), 404);
    }

    if (order.status !== "CREATED") {
      return c.json(errorResponse("Order is not in CREATED status"), 400);
    }

    try {
      const paymentIntent = await createPaymentIntent(order.amountCents, {
        orderId: order.id,
        deviceWalletAddress: order.deviceWalletAddress,
      });

      const confirmed = await confirmPayment(paymentIntent.id, paymentMethodId);

      if (confirmed.status === "succeeded") {
        const [updated] = await db
          .update(orders)
          .set({
            status: "PAID",
            stripePaymentIntentId: paymentIntent.id,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, orderId))
          .returning();

        return c.json(successResponse(updated));
      } else {
        return c.json(
          errorResponse(`Payment status: ${confirmed.status}`),
          400,
        );
      }
    } catch (error: any) {
      await db
        .update(orders)
        .set({ status: "FAILED", updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      return c.json(
        errorResponse(error.message ?? "Payment processing failed"),
        400,
      );
    }
  },
);

export default buyerOrders;
