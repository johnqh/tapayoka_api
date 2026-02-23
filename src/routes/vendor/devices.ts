import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  devices,
  deviceServices,
  services,
} from "../../db/schema.ts";
import {
  deviceCreateSchema,
  deviceUpdateSchema,
  deviceServiceAssignSchema,
  ethAddressSchema,
} from "../../schemas/index.ts";
import { getServerAddress } from "../../services/crypto.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";

const vendorDevices = new Hono();

/**
 * GET / - List all devices for the vendor's entity
 */
vendorDevices.get("/", async c => {
  const db = getDb();
  // TODO: filter by entity from auth context
  const allDevices = await db.select().from(devices);
  return c.json(successResponse(allDevices));
});

/**
 * GET /:walletAddress - Get device details
 */
vendorDevices.get("/:walletAddress", async c => {
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

  return c.json(successResponse(device));
});

/**
 * POST / - Register a new device
 */
vendorDevices.post("/", zValidator("json", deviceCreateSchema), async c => {
  const data = c.req.valid("json");
  // TODO: get entityId from auth context
  const entityId = "default";

  const db = getDb();

  // Check if device already registered
  const [existing] = await db
    .select()
    .from(devices)
    .where(eq(devices.walletAddress, data.walletAddress))
    .limit(1);

  if (existing) {
    return c.json(errorResponse("Device already registered"), 409);
  }

  const [device] = await db
    .insert(devices)
    .values({
      ...data,
      entityId,
      serverWalletAddress: getServerAddress(),
    })
    .returning();

  return c.json(successResponse(device), 201);
});

/**
 * PUT /:walletAddress - Update device
 */
vendorDevices.put(
  "/:walletAddress",
  zValidator("json", deviceUpdateSchema),
  async c => {
    const walletAddress = c.req.param("walletAddress");
    const data = c.req.valid("json");

    const db = getDb();
    const [updated] = await db
      .update(devices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(devices.walletAddress, walletAddress))
      .returning();

    if (!updated) {
      return c.json(errorResponse("Device not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/**
 * DELETE /:walletAddress - Delete device
 */
vendorDevices.delete("/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");

  const db = getDb();
  const [deleted] = await db
    .delete(devices)
    .where(eq(devices.walletAddress, walletAddress))
    .returning();

  if (!deleted) {
    return c.json(errorResponse("Device not found"), 404);
  }

  return c.json(successResponse({ deleted: true }));
});

/**
 * GET /:walletAddress/services - Get services assigned to device
 */
vendorDevices.get("/:walletAddress/services", async c => {
  const walletAddress = c.req.param("walletAddress");

  const db = getDb();
  const assigned = await db
    .select({ service: services })
    .from(deviceServices)
    .innerJoin(services, eq(deviceServices.serviceId, services.id))
    .where(eq(deviceServices.deviceWalletAddress, walletAddress));

  return c.json(successResponse(assigned.map(r => r.service)));
});

/**
 * PUT /:walletAddress/services - Assign services to device (replace all)
 */
vendorDevices.put(
  "/:walletAddress/services",
  zValidator("json", deviceServiceAssignSchema),
  async c => {
    const walletAddress = c.req.param("walletAddress");
    const { serviceIds } = c.req.valid("json");

    const db = getDb();

    // Delete existing assignments
    await db
      .delete(deviceServices)
      .where(eq(deviceServices.deviceWalletAddress, walletAddress));

    // Insert new assignments
    if (serviceIds.length > 0) {
      await db.insert(deviceServices).values(
        serviceIds.map(serviceId => ({
          deviceWalletAddress: walletAddress,
          serviceId,
        }))
      );
    }

    return c.json(successResponse({ assigned: serviceIds.length }));
  }
);

export default vendorDevices;
