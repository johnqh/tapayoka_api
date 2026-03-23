import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorInstallations,
  vendorOfferings,
  vendorModels,
} from "../../db/schema.ts";
import { verifySignature } from "../../services/crypto.ts";
import { deviceVerifySchema } from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
  type Offering,
  type PricingTier,
  type VendorModelSlot,
} from "@sudobility/tapayoka_types";

const buyerDevices = new Hono();

/** Convert vendor PricingTier[] into legacy Offering[] for the buyer app. */
function pricingTiersToOfferings(
  tiers: PricingTier[],
  vendorOfferingId: string,
  entityId: string,
): Offering[] {
  return tiers.map(tier => {
    if (tier.type === "fixed") {
      return {
        id: tier.id,
        entityId,
        name: tier.name,
        description: null,
        type: "FIXED" as const,
        priceCents: Math.round(parseFloat(tier.price) * 100),
        fixedMinutes: tier.signals.reduce((sum, s) => sum + s.duration, 0) / 60,
        minutesPer25c: null,
        active: true,
        createdAt: null,
        updatedAt: null,
      };
    }
    // timed
    return {
      id: tier.id,
      entityId,
      name: tier.name,
      description: null,
      type: "TIMED" as const,
      priceCents: Math.round(parseFloat(tier.startPrice) * 100),
      fixedMinutes: null,
      minutesPer25c: null,
      active: true,
      createdAt: null,
      updatedAt: null,
    };
  });
}

/**
 * POST /verify - Verify device signature and get available offerings
 * Buyer sends device's signed challenge; server verifies and returns offerings.
 */
buyerDevices.post(
  "/verify",
  zValidator("json", deviceVerifySchema),
  async c => {
    const { deviceWalletAddress, signedPayload, signature } =
      c.req.valid("json");

    console.log("[verify] Step 1 — input received", { deviceWalletAddress });

    // Verify the device's signature
    const isValid = verifySignature(
      signedPayload,
      signature,
      deviceWalletAddress
    );
    console.log("[verify] Step 2 — signature valid:", isValid);
    if (!isValid) {
      return c.json(errorResponse("Invalid device signature"), 400);
    }

    const db = getDb();

    // Find the installation + offering + model
    const [result] = await db
      .select({
        installation: vendorInstallations,
        offering: vendorOfferings,
        model: vendorModels,
      })
      .from(vendorInstallations)
      .innerJoin(
        vendorOfferings,
        eq(vendorInstallations.vendorOfferingId, vendorOfferings.id)
      )
      .innerJoin(
        vendorModels,
        eq(vendorOfferings.vendorModelId, vendorModels.id)
      )
      .where(eq(vendorInstallations.walletAddress, deviceWalletAddress))
      .limit(1);

    console.log("[verify] Step 3 — installation lookup:", result ? `found (status=${result.installation.status})` : "NOT FOUND");

    if (!result) {
      return c.json(errorResponse("Device not registered"), 404);
    }

    if (result.installation.status !== "Active") {
      return c.json(errorResponse("Device is not active"), 400);
    }

    const slotType = (result.model.slot as VendorModelSlot) ?? null;
    const tiers = result.offering.pricingTiers as PricingTier[];
    const offeringsList = pricingTiersToOfferings(
      tiers,
      result.offering.id,
      result.offering.vendorLocationId,
    );

    console.log("[verify] Step 4 — slotType:", slotType, "offerings:", offeringsList.length);

    return c.json(
      successResponse({
        device: {
          walletAddress: result.installation.walletAddress,
          label: result.installation.label,
          status: "ACTIVE",
          entityId: result.offering.vendorLocationId,
          model: result.model.name,
          location: null,
          gpioConfig: null,
          serverWalletAddress: null,
          createdAt: result.installation.createdAt,
          updatedAt: result.installation.updatedAt,
        },
        offerings: offeringsList,
        slotType,
      })
    );
  }
);

export default buyerDevices;
