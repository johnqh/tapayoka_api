import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { authorizations, orders } from "../../db/schema.ts";
import { createAuthorizationSchema, uuidSchema } from "../../schemas/index.ts";
import { signPayload, getServerAddress } from "../../services/crypto.ts";
import { resolveTierForOrder } from "../../services/resolveTier.ts";
import {
  piSuccessResponse,
  errorResponse,
  type AuthorizationPayload,
  type PiCommand,
  type Order,
} from "@sudobility/tapayoka_types";
import { randomUUID } from "crypto";

const buyerAuthorizations = new Hono();

/**
 * POST / - Create authorization for a paid order.
 * Signs the authorization payload with the server's ETH key.
 */
buyerAuthorizations.post(
  "/",
  zValidator("json", createAuthorizationSchema),
  async c => {
    const { orderId } = c.req.valid("json");

    const db = getDb();

    // Verify order exists and is PAID
    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      return c.json(errorResponse("Order not found"), 404);
    }

    if (order.status !== "PAID") {
      return c.json(
        errorResponse("Order must be in PAID status to authorize"),
        400
      );
    }

    // Check if authorization already exists
    const [existing] = await db
      .select()
      .from(authorizations)
      .where(eq(authorizations.orderId, orderId))
      .limit(1);

    if (existing) {
      return c.json(errorResponse("Authorization already exists"), 409);
    }

    const { offeringType, signals, end } = await resolveTierForOrder(db, order);

    // Build authorization payload
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const payload: AuthorizationPayload = {
      orderId: order.id,
      offeringType,
      seconds: order.authorizedSeconds,
      ...(signals ? { signals } : {}),
      ...(end ? { end } : {}),
      nonce: randomUUID(),
      exp: Math.floor(expiresAt.getTime() / 1000),
    };

    const payloadJson = JSON.stringify(payload);
    const serverSignature = await signPayload(payloadJson);

    // Store authorization
    await db.insert(authorizations).values({
      orderId,
      payloadJson,
      serverSignature,
      expiresAt,
    });

    // Update order status to AUTHORIZED
    const [updatedRow] = await db
      .update(orders)
      .set({ status: "AUTHORIZED", updatedAt: new Date() })
      .where(eq(orders.id, orderId))
      .returning();

    const updatedOrder: Order = updatedRow;

    // Build PiCommand for the device
    const pi: PiCommand = {
      command: "EXECUTE",
      data: payload as unknown as Record<string, unknown>,
      signing: {
        walletAddress: getServerAddress(),
        message: payloadJson,
        signature: serverSignature,
      },
    };

    return c.json(piSuccessResponse(updatedOrder, pi), 201);
  }
);

/**
 * GET /:orderId - Get authorization for an order
 */
buyerAuthorizations.get("/:orderId", async c => {
  const orderId = c.req.param("orderId");
  const parsed = uuidSchema.safeParse(orderId);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid order ID"), 400);
  }

  const db = getDb();
  const [authorization] = await db
    .select()
    .from(authorizations)
    .where(eq(authorizations.orderId, orderId))
    .limit(1);

  if (!authorization) {
    return c.json(errorResponse("Authorization not found"), 404);
  }

  const [orderRow] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) {
    return c.json(errorResponse("Order not found"), 404);
  }

  const order: Order = orderRow;

  // Build PiCommand for the device
  const pi: PiCommand = {
    command: "EXECUTE",
    data: JSON.parse(authorization.payloadJson),
    signing: {
      walletAddress: getServerAddress(),
      message: authorization.payloadJson,
      signature: authorization.serverSignature,
    },
  };

  return c.json(piSuccessResponse(order, pi));
});

export default buyerAuthorizations;
