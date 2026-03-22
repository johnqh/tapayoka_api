import { Hono } from "hono";
import { eq, and, inArray } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { vendorInstallationSlots, orders } from "../../db/schema.ts";
import { successResponse, type PricingTier } from "@sudobility/tapayoka_types";

const activeStatuses = [
  "CREATED",
  "PAID",
  "AUTHORIZED",
  "RUNNING",
] as const;

const buyerSlots = new Hono();

/**
 * GET /:walletAddress - List slots for a device/installation with availability
 */
buyerSlots.get("/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
  const db = getDb();

  // Get all slots for this installation
  const slots = await db
    .select()
    .from(vendorInstallationSlots)
    .where(
      eq(
        vendorInstallationSlots.installationWalletAddress,
        walletAddress
      )
    )
    .orderBy(vendorInstallationSlots.sortOrder);

  if (slots.length === 0) {
    return c.json(successResponse([]));
  }

  // Find slots with active orders
  const slotIds = slots.map(s => s.id);

  const activeOrders = await db
    .select({ slotId: orders.slotId })
    .from(orders)
    .where(
      and(
        inArray(orders.slotId, slotIds),
        inArray(orders.status, [...activeStatuses])
      )
    );

  const unavailableSlotIds = new Set(
    activeOrders.map(o => o.slotId).filter(Boolean)
  );

  const result = slots.map(slot => ({
    ...slot,
    pricingTier: slot.pricingTier as PricingTier | null,
    available: !unavailableSlotIds.has(slot.id),
  }));

  return c.json(successResponse(result));
});

/**
 * GET /detail/:slotId - Get single slot detail for buyer
 */
buyerSlots.get("/detail/:slotId", async c => {
  const slotId = c.req.param("slotId");
  const db = getDb();

  const [slot] = await db
    .select()
    .from(vendorInstallationSlots)
    .where(eq(vendorInstallationSlots.id, slotId))
    .limit(1);

  if (!slot) {
    return c.json(successResponse(null));
  }

  // Check availability
  const activeOrders = await db
    .select({ slotId: orders.slotId })
    .from(orders)
    .where(
      and(
        eq(orders.slotId, slotId),
        inArray(orders.status, [...activeStatuses])
      )
    )
    .limit(1);

  return c.json(
    successResponse({
      label: slot.label,
      pricingTier: slot.pricingTier as PricingTier | null,
      available: activeOrders.length === 0,
    })
  );
});

export default buyerSlots;
