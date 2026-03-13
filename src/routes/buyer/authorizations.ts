import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { authorizations, orders, installations } from "../../db/schema.ts";
import { createAuthorizationSchema, uuidSchema } from "../../schemas/index.ts";
import { signPayload } from "../../services/crypto.ts";
import {
  successResponse,
  errorResponse,
  type AuthorizationPayload,
  type InstallationType,
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

    // Get installation type
    const [installation] = await db
      .select()
      .from(installations)
      .where(eq(installations.id, order.installationId))
      .limit(1);

    // Build authorization payload
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const payload: AuthorizationPayload = {
      orderId: order.id,
      installationType: (installation?.type ?? "TRIGGER") as InstallationType,
      seconds: order.authorizedSeconds,
      nonce: randomUUID(),
      exp: Math.floor(expiresAt.getTime() / 1000),
    };

    const payloadJson = JSON.stringify(payload);
    const serverSignature = await signPayload(payloadJson);

    // Store authorization
    const [authorization] = await db
      .insert(authorizations)
      .values({
        orderId,
        payloadJson,
        serverSignature,
        expiresAt,
      })
      .returning();

    // Update order status to AUTHORIZED
    await db
      .update(orders)
      .set({ status: "AUTHORIZED", updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    return c.json(
      successResponse({
        authorization,
        payload,
        serverSignature,
      }),
      201
    );
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

  return c.json(
    successResponse({
      authorization,
      payload: JSON.parse(authorization.payloadJson),
      serverSignature: authorization.serverSignature,
    })
  );
});

export default buyerAuthorizations;
