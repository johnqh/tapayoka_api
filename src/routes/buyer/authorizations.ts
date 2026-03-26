import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { authorizations, orders, offerings, vendorInstallations, vendorOfferings } from "../../db/schema.ts";
import { createAuthorizationSchema, uuidSchema } from "../../schemas/index.ts";
import { signPayload, getServerAddress } from "../../services/crypto.ts";
import {
  piSuccessResponse,
  errorResponse,
  type AuthorizationPayload,
  type OfferingType,
  type PricingTier,
  type PiCommand,
} from "@sudobility/tapayoka_types";
import { randomUUID } from "crypto";

const buyerAuthorizations = new Hono();

/** Resolve offering type for the authorization payload */
async function resolveOfferingType(
  db: ReturnType<typeof getDb>,
  order: { offeringId: string | null; pricingTierId: string | null; deviceWalletAddress: string },
): Promise<OfferingType> {
  // New flow: resolve from pricing tier
  if (order.pricingTierId) {
    const [installation] = await db
      .select()
      .from(vendorInstallations)
      .where(eq(vendorInstallations.walletAddress, order.deviceWalletAddress))
      .limit(1);

    if (installation) {
      const [offering] = await db
        .select()
        .from(vendorOfferings)
        .where(eq(vendorOfferings.id, installation.vendorOfferingId))
        .limit(1);

      if (offering) {
        const tiers = offering.pricingTiers as PricingTier[];
        const tier = tiers.find(t => t.id === order.pricingTierId);
        if (tier) {
          return tier.type === "fixed" ? "FIXED" : "TIMED";
        }
      }
    }
  }

  // Legacy fallback: resolve from offerings table
  if (order.offeringId) {
    const [offering] = await db
      .select()
      .from(offerings)
      .where(eq(offerings.id, order.offeringId))
      .limit(1);

    if (offering) {
      return offering.type as OfferingType;
    }
  }

  return "TRIGGER";
}

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
        400,
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

    const offeringType = await resolveOfferingType(db, order);

    // Build authorization payload
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const payload: AuthorizationPayload = {
      orderId: order.id,
      offeringType,
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

    return c.json(
      piSuccessResponse(
        { id: authorization.id, orderId: authorization.orderId, expiresAt: authorization.expiresAt },
        pi,
      ),
      201,
    );
  },
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

  return c.json(
    piSuccessResponse(
      { id: authorization.id, orderId: authorization.orderId, expiresAt: authorization.expiresAt },
      pi,
    ),
  );
});

export default buyerAuthorizations;
