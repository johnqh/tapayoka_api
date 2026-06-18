import type {
  OfferingType,
  OfferingSignal,
  PricingTier,
} from "@sudobility/tapayoka_types";
import { tierAuthorizationFields as deriveTierAuthorizationFields } from "@sudobility/tapayoka_lib/derived";

export interface TierAuthorizationFields {
  offeringType: OfferingType;
  signals?: OfferingSignal[];
}

/** Pure: derive the payload's offeringType (+ signals for fixed tiers) from a tier. */
export function tierAuthorizationFields(
  tier: PricingTier | null | undefined
): TierAuthorizationFields {
  return deriveTierAuthorizationFields(tier);
}
