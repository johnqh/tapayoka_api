import type {
  OfferingType,
  OfferingSignal,
  PricingTier,
} from "@sudobility/tapayoka_types";

export interface TierAuthorizationFields {
  offeringType: OfferingType;
  signals?: OfferingSignal[];
}

/** Pure: derive the payload's offeringType (+ signals for fixed tiers) from a tier. */
export function tierAuthorizationFields(
  tier: PricingTier | null | undefined
): TierAuthorizationFields {
  if (!tier) return { offeringType: "TRIGGER" };
  if (tier.type === "fixed") {
    return { offeringType: "FIXED", signals: tier.signals };
  }
  return { offeringType: "TIMED" };
}
