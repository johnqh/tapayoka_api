import {
  type OfferingType,
  type OfferingSignal,
  type PricingTier,
  type SlotAction,
  tierAuthorizationFields as deriveTierAuthorizationFields,
  resolveEffectiveAction,
  actionAuthorizationFields,
} from "@sudobility/tapayoka_types";

export interface TierAuthorizationFields {
  offeringType: OfferingType;
  /** Relay pulses to run at session start. */
  signals?: OfferingSignal[];
  /** Relay pulses to run at session end (two-phase `atEnd` models). */
  end?: OfferingSignal[];
}

/** Pure: derive the payload's offeringType (+ signals for fixed tiers) from a tier. */
export function tierAuthorizationFields(
  tier: PricingTier | null | undefined
): TierAuthorizationFields {
  return deriveTierAuthorizationFields(tier);
}

/**
 * Derive the payload fields from the effective relay action for a purchase:
 * a per-slot action (multi-slot models) wins over the tier's action
 * (single-slot models). `seconds` is the purchased duration — for a timed
 * action it becomes the hold time of the single start pin.
 */
export function slotAuthorizationFields(
  slot: { action?: SlotAction | null } | null | undefined,
  tier: PricingTier | null | undefined,
  seconds: number
): TierAuthorizationFields {
  return actionAuthorizationFields(resolveEffectiveAction(slot, tier), seconds);
}
