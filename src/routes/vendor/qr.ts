import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { devices } from "../../db/schema.ts";
import { ethAddressSchema } from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";

const vendorQr = new Hono();

/**
 * GET /:walletAddress - Generate QR code data for a device.
 * The QR code contains the device's wallet address,
 * which the buyer app uses to discover the device via BLE.
 */
vendorQr.get("/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
  const parsed = ethAddressSchema.safeParse(walletAddress);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid wallet address"), 400);
  }

  const db = getDb();
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.walletAddress, walletAddress))
    .limit(1);

  if (!device) {
    return c.json(errorResponse("Device not found"), 404);
  }

  // QR data is just the wallet address — buyer app uses this
  // to find the device via BLE name prefix matching
  return c.json(
    successResponse({
      deviceWalletAddress: walletAddress,
      qrData: walletAddress,
      format: "svg" as const,
    })
  );
});

export default vendorQr;
