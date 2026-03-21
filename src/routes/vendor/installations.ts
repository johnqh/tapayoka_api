import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorInstallations,
  vendorInstallationSlots,
  vendorOfferings,
  vendorLocations,
} from "../../db/schema.ts";
import {
  vendorInstallationCreateSchema,
  vendorInstallationUpdateSchema,
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

const installations = new Hono<AppEnv>();

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

/** GET /service/:serviceId - Get all installations for an offering */
installations.get("/service/:serviceId", async c => {
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
    .select({
      walletAddress: vendorInstallations.walletAddress,
      vendorOfferingId: vendorInstallations.vendorOfferingId,
      label: vendorInstallations.label,
      pricingTierId: vendorInstallations.pricingTierId,
      pricingTier: vendorInstallations.pricingTier,
      createdAt: vendorInstallations.createdAt,
      updatedAt: vendorInstallations.updatedAt,
      slotCount: count(vendorInstallationSlots.id),
    })
    .from(vendorInstallations)
    .leftJoin(
      vendorInstallationSlots,
      eq(vendorInstallations.walletAddress, vendorInstallationSlots.installationWalletAddress)
    )
    .where(eq(vendorInstallations.vendorOfferingId, serviceId))
    .groupBy(vendorInstallations.walletAddress);

  return c.json(successResponse(results));
});

/** POST / - Create a new installation */
installations.post(
  "/",
  zValidator("json", vendorInstallationCreateSchema),
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
      .from(vendorInstallations)
      .where(eq(vendorInstallations.walletAddress, data.walletAddress))
      .limit(1);

    if (existing) {
      return c.json(
        errorResponse("Installation with this wallet address already exists"),
        409
      );
    }

    const [installation] = await db
      .insert(vendorInstallations)
      .values(data)
      .returning();

    return c.json(successResponse(installation), 201);
  }
);

/** PUT /:walletAddress - Update an installation */
installations.put(
  "/:walletAddress",
  zValidator("json", vendorInstallationUpdateSchema),
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

    // Get installation and verify ownership through offering -> location
    const [installation] = await db
      .select()
      .from(vendorInstallations)
      .where(eq(vendorInstallations.walletAddress, walletAddress))
      .limit(1);

    if (!installation) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    const owned = await verifyOfferingOwnership(
      db,
      installation.vendorOfferingId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Installation not found"), 404);
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
      .update(vendorInstallations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorInstallations.walletAddress, walletAddress))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:walletAddress - Delete an installation */
installations.delete("/:walletAddress", async c => {
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
  const [installation] = await db
    .select()
    .from(vendorInstallations)
    .where(eq(vendorInstallations.walletAddress, walletAddress))
    .limit(1);

  if (!installation) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  const owned = await verifyOfferingOwnership(
    db,
    installation.vendorOfferingId,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  await db
    .delete(vendorInstallations)
    .where(eq(vendorInstallations.walletAddress, walletAddress));
  return c.json(successResponse({ deleted: true }));
});

export default installations;
