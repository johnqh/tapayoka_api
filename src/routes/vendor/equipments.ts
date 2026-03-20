import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorEquipments,
  vendorOfferings,
  vendorLocations,
} from "../../db/schema.ts";
import {
  vendorEquipmentCreateSchema,
  vendorEquipmentUpdateSchema,
  ethAddressSchema,
  uuidSchema,
} from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";
import type { AppEnv } from "../../lib/hono-types.ts";
import {
  getEntityWithPermission,
  getPermissionErrorStatus,
} from "../../lib/entity-helpers.ts";

const equipments = new Hono<AppEnv>();

/** Helper: verify offering belongs to entity via location */
async function verifyOfferingOwnership(
  db: ReturnType<typeof getDb>,
  offeringId: string,
  entityId: string
) {
  const [result] = await db
    .select({ offering: vendorOfferings })
    .from(vendorOfferings)
    .innerJoin(
      vendorLocations,
      eq(vendorOfferings.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorOfferings.id, offeringId),
        eq(vendorLocations.entityId, entityId)
      )
    )
    .limit(1);
  return !!result;
}

/** GET /service/:serviceId - Get all equipments for an offering */
equipments.get("/service/:serviceId", async c => {
  const serviceId = c.req.param("serviceId");
  const parsed = uuidSchema.safeParse(serviceId);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid service ID"), 400);
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
  const owned = await verifyOfferingOwnership(db, serviceId, result.entity.id);
  if (!owned) {
    return c.json(errorResponse("Offering not found"), 404);
  }

  const results = await db
    .select()
    .from(vendorEquipments)
    .where(eq(vendorEquipments.vendorOfferingId, serviceId));

  return c.json(successResponse(results));
});

/** POST / - Create a new equipment */
equipments.post(
  "/",
  zValidator("json", vendorEquipmentCreateSchema),
  async c => {
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
    const owned = await verifyOfferingOwnership(
      db,
      data.vendorOfferingId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Offering not found"), 404);
    }

    // Check for duplicate wallet address
    const [existing] = await db
      .select()
      .from(vendorEquipments)
      .where(eq(vendorEquipments.walletAddress, data.walletAddress))
      .limit(1);

    if (existing) {
      return c.json(
        errorResponse("Equipment with this wallet address already exists"),
        409
      );
    }

    const [equipment] = await db
      .insert(vendorEquipments)
      .values(data)
      .returning();

    return c.json(successResponse(equipment), 201);
  }
);

/** PUT /:walletAddress - Update an equipment */
equipments.put(
  "/:walletAddress",
  zValidator("json", vendorEquipmentUpdateSchema),
  async c => {
    const walletAddress = c.req.param("walletAddress");
    const parsedAddr = ethAddressSchema.safeParse(walletAddress);
    if (!parsedAddr.success) {
      return c.json(errorResponse("Invalid wallet address"), 400);
    }

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

    // Get equipment and verify ownership through offering -> location
    const [equipment] = await db
      .select()
      .from(vendorEquipments)
      .where(eq(vendorEquipments.walletAddress, walletAddress))
      .limit(1);

    if (!equipment) {
      return c.json(errorResponse("Equipment not found"), 404);
    }

    const owned = await verifyOfferingOwnership(
      db,
      equipment.vendorOfferingId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Equipment not found"), 404);
    }

    // If changing vendorOfferingId, verify ownership of target offering too
    if (data.vendorOfferingId) {
      const targetOwned = await verifyOfferingOwnership(
        db,
        data.vendorOfferingId,
        result.entity.id
      );
      if (!targetOwned) {
        return c.json(errorResponse("Target offering not found"), 404);
      }
    }

    const [updated] = await db
      .update(vendorEquipments)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorEquipments.walletAddress, walletAddress))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:walletAddress - Delete an equipment */
equipments.delete("/:walletAddress", async c => {
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
  const [equipment] = await db
    .select()
    .from(vendorEquipments)
    .where(eq(vendorEquipments.walletAddress, walletAddress))
    .limit(1);

  if (!equipment) {
    return c.json(errorResponse("Equipment not found"), 404);
  }

  const owned = await verifyOfferingOwnership(
    db,
    equipment.vendorOfferingId,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Equipment not found"), 404);
  }

  await db
    .delete(vendorEquipments)
    .where(eq(vendorEquipments.walletAddress, walletAddress));
  return c.json(successResponse({ deleted: true }));
});

export default equipments;
