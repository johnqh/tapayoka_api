import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  devices,
  deviceOfferings,
  offerings,
  vendorInstallations,
  vendorOfferings,
  vendorModels,
} from "../../db/schema.ts";
import { verifySignature } from "../../services/crypto.ts";
import { deviceVerifySchema } from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
  type VendorModelSlot,
} from "@sudobility/tapayoka_types";

const buyerDevices = new Hono();

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

    // Verify the device's signature
    const isValid = verifySignature(
      signedPayload,
      signature,
      deviceWalletAddress
    );
    if (!isValid) {
      return c.json(errorResponse("Invalid device signature"), 400);
    }

    const db = getDb();

    // Find the device
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.walletAddress, deviceWalletAddress))
      .limit(1);

    if (!device) {
      return c.json(errorResponse("Device not registered"), 404);
    }

    if (device.status !== "ACTIVE") {
      return c.json(errorResponse("Device is not active"), 400);
    }

    // Get assigned offerings
    const assignedOfferings = await db
      .select({ offering: offerings })
      .from(deviceOfferings)
      .innerJoin(offerings, eq(deviceOfferings.offeringId, offerings.id))
      .where(
        and(
          eq(deviceOfferings.deviceWalletAddress, deviceWalletAddress),
          eq(offerings.active, true)
        )
      );

    // Look up slot type from vendor management tables
    let slotType: VendorModelSlot | null = null;
    const installationResult = await db
      .select({ slot: vendorModels.slot })
      .from(vendorInstallations)
      .innerJoin(
        vendorOfferings,
        eq(
          vendorInstallations.vendorOfferingId,
          vendorOfferings.id
        )
      )
      .innerJoin(
        vendorModels,
        eq(vendorOfferings.vendorModelId, vendorModels.id)
      )
      .where(
        eq(
          vendorInstallations.walletAddress,
          deviceWalletAddress
        )
      )
      .limit(1);

    if (installationResult.length > 0 && installationResult[0].slot) {
      slotType = installationResult[0].slot as VendorModelSlot;
    }

    return c.json(
      successResponse({
        device,
        offerings: assignedOfferings.map(r => r.offering),
        slotType,
      })
    );
  }
);

export default buyerDevices;
