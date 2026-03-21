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

export default buyerSlots;
