import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
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
import type { AppEnv } from "../../lib/hono-types.ts";
import {
  getEntityWithPermission,
  getPermissionErrorStatus,
} from "../../lib/entity-helpers.ts";

const vendorDevices = new Hono<AppEnv>();

/** GET / - List all devices for the entity */
vendorDevices.get("/", async c => {
  const entitySlug = c.req.param("entitySlug");
  const userId = c.get("firebaseUid");

  const result = await getEntityWithPermission(entitySlug, userId);
  if (result.error !== undefined) {
    return c.json(
      { ...errorResponse(result.error), errorCode: result.errorCode },
      getPermissionErrorStatus(result.errorCode)
    );
  }

  const db = getDb();
  const allDevices = await db
    .select()
    .from(devices)
    .where(eq(devices.entityId, result.entity.id));
  return c.json(successResponse(allDevices));
});

/** GET /:walletAddress - Get device details */
vendorDevices.get("/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
  const parsed = ethAddressSchema.safeParse(walletAddress);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid wallet address"), 400);
  }

  const entitySlug = c.req.param("entitySlug");
  const userId = c.get("firebaseUid");

  const result = await getEntityWithPermission(entitySlug, userId);
  if (result.error !== undefined) {
    return c.json(
      { ...errorResponse(result.error), errorCode: result.errorCode },
      getPermissionErrorStatus(result.errorCode)
    );
  }

  const db = getDb();
  const [device] = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.walletAddress, walletAddress),
        eq(devices.entityId, result.entity.id)
      )
    )
    .limit(1);

  if (!device) {
    return c.json(errorResponse("Device not found"), 404);
  }

  return c.json(successResponse(device));
});

/** POST / - Register a new device */
vendorDevices.post("/", zValidator("json", deviceCreateSchema), async c => {
  const data = c.req.valid("json");
  const entitySlug = c.req.param("entitySlug");
  const userId = c.get("firebaseUid");

  const result = await getEntityWithPermission(entitySlug, userId, true);
  if (result.error !== undefined) {
    return c.json(
      { ...errorResponse(result.error), errorCode: result.errorCode },
      getPermissionErrorStatus(result.errorCode)
    );
  }

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
      entityId: result.entity.id,
      serverWalletAddress: getServerAddress(),
    })
    .returning();

  return c.json(successResponse(device), 201);
});

/** PUT /:walletAddress - Update device */
vendorDevices.put(
  "/:walletAddress",
  zValidator("json", deviceUpdateSchema),
  async c => {
    const walletAddress = c.req.param("walletAddress");
    const data = c.req.valid("json");
    const entitySlug = c.req.param("entitySlug");
    const userId = c.get("firebaseUid");

    const result = await getEntityWithPermission(entitySlug, userId, true);
    if (result.error !== undefined) {
      return c.json(
        { ...errorResponse(result.error), errorCode: result.errorCode },
        getPermissionErrorStatus(result.errorCode)
      );
    }

    const db = getDb();
    const [updated] = await db
      .update(devices)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(devices.walletAddress, walletAddress),
          eq(devices.entityId, result.entity.id)
        )
      )
      .returning();

    if (!updated) {
      return c.json(errorResponse("Device not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/** DELETE /:walletAddress - Delete device */
vendorDevices.delete("/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
  const entitySlug = c.req.param("entitySlug");
  const userId = c.get("firebaseUid");

  const result = await getEntityWithPermission(entitySlug, userId, true);
  if (result.error !== undefined) {
    return c.json(
      { ...errorResponse(result.error), errorCode: result.errorCode },
      getPermissionErrorStatus(result.errorCode)
    );
  }

  const db = getDb();
  const [deleted] = await db
    .delete(devices)
    .where(
      and(
        eq(devices.walletAddress, walletAddress),
        eq(devices.entityId, result.entity.id)
      )
    )
    .returning();

  if (!deleted) {
    return c.json(errorResponse("Device not found"), 404);
  }

  return c.json(successResponse({ deleted: true }));
});

/** GET /:walletAddress/services - Get services assigned to device */
vendorDevices.get("/:walletAddress/services", async c => {
  const walletAddress = c.req.param("walletAddress");
  const entitySlug = c.req.param("entitySlug");
  const userId = c.get("firebaseUid");

  const result = await getEntityWithPermission(entitySlug, userId);
  if (result.error !== undefined) {
    return c.json(
      { ...errorResponse(result.error), errorCode: result.errorCode },
      getPermissionErrorStatus(result.errorCode)
    );
  }

  const db = getDb();

  // Verify device belongs to entity
  const [device] = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.walletAddress, walletAddress),
        eq(devices.entityId, result.entity.id)
      )
    )
    .limit(1);

  if (!device) {
    return c.json(errorResponse("Device not found"), 404);
  }

  const assigned = await db
    .select({ service: services })
    .from(deviceServices)
    .innerJoin(services, eq(deviceServices.serviceId, services.id))
    .where(eq(deviceServices.deviceWalletAddress, walletAddress));

  return c.json(successResponse(assigned.map(r => r.service)));
});

/** PUT /:walletAddress/services - Assign services to device (replace all) */
vendorDevices.put(
  "/:walletAddress/services",
  zValidator("json", deviceServiceAssignSchema),
  async c => {
    const walletAddress = c.req.param("walletAddress");
    const { serviceIds } = c.req.valid("json");
    const entitySlug = c.req.param("entitySlug");
    const userId = c.get("firebaseUid");

    const result = await getEntityWithPermission(entitySlug, userId, true);
    if (result.error !== undefined) {
      return c.json(
        { ...errorResponse(result.error), errorCode: result.errorCode },
        getPermissionErrorStatus(result.errorCode)
      );
    }

    const db = getDb();

    // Verify device belongs to entity
    const [device] = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.walletAddress, walletAddress),
          eq(devices.entityId, result.entity.id)
        )
      )
      .limit(1);

    if (!device) {
      return c.json(errorResponse("Device not found"), 404);
    }

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
