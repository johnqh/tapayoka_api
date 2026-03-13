import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { orders, installations, devices } from "../../db/schema.ts";
import {
  createOrderSchema,
  processPaymentSchema,
  uuidSchema,
} from "../../schemas/index.ts";
import { createPaymentIntent, confirmPayment } from "../../services/stripe.ts";
import { successResponse, errorResponse, type InstallationType } from "@sudobility/tapayoka_types";
import type { AppEnv } from "../../lib/hono-types.ts";

const buyerOrders = new Hono<AppEnv>();

/** Calculate authorized seconds based on installation type and amount */
function calculateAuthorizedSeconds(
  type: InstallationType,
  amountCents: number,
  fixedMinutes: number | null,
  minutesPer25c: number | null
): number {
  switch (type) {
    case "TRIGGER":
      return 0; // Instant activation, no duration
    case "FIXED":
      return (fixedMinutes ?? 0) * 60;
    case "VARIABLE":
      if (!minutesPer25c) return 0;
      return Math.floor(amountCents / 25) * minutesPer25c * 60;
  }
}

/**
 * POST / - Create a new order
 */
buyerOrders.post("/", zValidator("json", createOrderSchema), async c => {
  const { deviceWalletAddress, installationId, amountCents } = c.req.valid("json");
  const buyerUid = c.get("firebaseUid") as string;

  const db = getDb();

  // Validate device exists and is active
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.walletAddress, deviceWalletAddress))
    .limit(1);

  if (!device || device.status !== "ACTIVE") {
    return c.json(errorResponse("Device not found or inactive"), 404);
  }

  // Validate installation exists and is active
  const [installation] = await db
    .select()
    .from(installations)
    .where(eq(installations.id, installationId))
    .limit(1);

  if (!installation || !installation.active) {
    return c.json(errorResponse("Installation not found or inactive"), 404);
  }

  // Validate amount matches installation price
  if (amountCents < installation.priceCents) {
    return c.json(
      errorResponse(
        `Amount ${amountCents} is less than installation price ${installation.priceCents}`
      ),
      400
    );
  }

  const authorizedSeconds = calculateAuthorizedSeconds(
    installation.type as InstallationType,
    amountCents,
    installation.fixedMinutes,
    installation.minutesPer25c
  );

  // Create order
  const [order] = await db
    .insert(orders)
    .values({
      deviceWalletAddress,
      installationId,
      buyerUid,
      amountCents,
      authorizedSeconds,
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
      // Create and confirm Stripe payment
      const paymentIntent = await createPaymentIntent(order.amountCents, {
        orderId: order.id,
        deviceWalletAddress: order.deviceWalletAddress,
      });

      const confirmed = await confirmPayment(paymentIntent.id, paymentMethodId);

      if (confirmed.status === "succeeded") {
        // Update order status to PAID
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
          400
        );
      }
    } catch (error: any) {
      // Update order to FAILED
      await db
        .update(orders)
        .set({ status: "FAILED", updatedAt: new Date() })
        .where(eq(orders.id, orderId));

      return c.json(
        errorResponse(error.message ?? "Payment processing failed"),
        400
      );
    }
  }
);

export default buyerOrders;
