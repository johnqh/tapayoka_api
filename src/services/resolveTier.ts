import { eq } from "drizzle-orm";
import type { OfferingType, PricingTier } from "@sudobility/tapayoka_types";
import { getDb } from "../db/index.ts";
import {
  offerings,
  vendorInstallations,
  vendorOfferings,
} from "../db/schema.ts";
import {
  tierAuthorizationFields,
  type TierAuthorizationFields,
} from "./authorizationPayload.ts";

/** Resolve the authorization fields for an order (new tier flow + legacy offerings fallback). */
export async function resolveTierForOrder(
  db: ReturnType<typeof getDb>,
  order: {
    offeringId?: string | null;
    pricingTierId: string | null;
    deviceWalletAddress: string;
  }
): Promise<TierAuthorizationFields> {
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
        const tier = tiers.find(t => t.id === order.pricingTierId) ?? null;
        if (tier) return tierAuthorizationFields(tier);
      }
    }
  }

  // Legacy fallback: resolve type from the offerings table (no signals available).
  if (order.offeringId) {
    const [offering] = await db
      .select()
      .from(offerings)
      .where(eq(offerings.id, order.offeringId))
      .limit(1);
    if (offering) {
      return { offeringType: offering.type as OfferingType };
    }
  }

  return { offeringType: "TRIGGER" };
}
