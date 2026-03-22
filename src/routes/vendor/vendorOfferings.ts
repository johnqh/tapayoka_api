import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorOfferings,
  vendorLocations,
  vendorModels,
} from "../../db/schema.ts";
import {
  vendorOfferingCreateSchema,
  vendorOfferingUpdateSchema,
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

const vendorOfferingsRoute = new Hono<AppEnv>();

/** GET /:id - Get a single vendor offering */
vendorOfferingsRoute.get("/:id", async c => {
  const id = c.req.param("id");
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid offering ID"), 400);
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

  // Verify offering belongs to entity via location
  const [instResult] = await db
    .select({ offering: vendorOfferings })
    .from(vendorOfferings)
    .innerJoin(
      vendorLocations,
      eq(vendorOfferings.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorOfferings.id, id),
        eq(vendorLocations.entityId, result.entity.id)
      )
    )
    .limit(1);

  if (!instResult) {
    return c.json(errorResponse("Offering not found"), 404);
  }

  return c.json(successResponse(instResult.offering));
});

/** POST / - Create a new vendor offering */
vendorOfferingsRoute.post(
  "/",
  zValidator("json", vendorOfferingCreateSchema),
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

    // Verify location belongs to entity
    const [location] = await db
      .select()
      .from(vendorLocations)
      .where(
        and(
          eq(vendorLocations.id, data.vendorLocationId),
          eq(vendorLocations.entityId, result.entity.id)
        )
      )
      .limit(1);

    if (!location) {
      return c.json(errorResponse("Location not found"), 404);
    }

    // Verify model belongs to entity
    const [model] = await db
      .select()
      .from(vendorModels)
      .where(
        and(
          eq(vendorModels.id, data.vendorModelId),
          eq(vendorModels.entityId, result.entity.id)
        )
      )
      .limit(1);

    if (!model) {
      return c.json(errorResponse("Model not found"), 404);
    }

    // Check unique constraint before insert
    const [existing] = await db
      .select()
      .from(vendorOfferings)
      .where(
        and(
          eq(vendorOfferings.vendorLocationId, data.vendorLocationId),
          eq(
            vendorOfferings.vendorModelId,
            data.vendorModelId
          )
        )
      )
      .limit(1);

    if (existing) {
      return c.json(
        errorResponse(
          "An offering already exists for this location and model combination"
        ),
        409
      );
    }

    const [offering] = await db
      .insert(vendorOfferings)
      .values(data)
      .returning();

    return c.json(successResponse(offering), 201);
  }
);

/** PUT /:id - Update a vendor offering */
vendorOfferingsRoute.put(
  "/:id",
  zValidator("json", vendorOfferingUpdateSchema),
  async c => {
    const id = c.req.param("id");
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

    // Verify ownership via location join
    const [existing] = await db
      .select({ offering: vendorOfferings })
      .from(vendorOfferings)
      .innerJoin(
        vendorLocations,
        eq(vendorOfferings.vendorLocationId, vendorLocations.id)
      )
      .where(
        and(
          eq(vendorOfferings.id, id),
          eq(vendorLocations.entityId, result.entity.id)
        )
      )
      .limit(1);

    if (!existing) {
      return c.json(errorResponse("Offering not found"), 404);
    }

    const [updated] = await db
      .update(vendorOfferings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorOfferings.id, id))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete a vendor offering (409 if has installations; controls cascade) */
vendorOfferingsRoute.delete("/:id", async c => {
  const id = c.req.param("id");
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

  // Verify ownership via location join
  const [existing] = await db
    .select({ offering: vendorOfferings })
    .from(vendorOfferings)
    .innerJoin(
      vendorLocations,
      eq(vendorOfferings.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorOfferings.id, id),
        eq(vendorLocations.entityId, result.entity.id)
      )
    )
    .limit(1);

  if (!existing) {
    return c.json(errorResponse("Offering not found"), 404);
  }

  await db
    .update(vendorOfferings)
    .set({ status: "Deleted" as const, updatedAt: new Date() })
    .where(eq(vendorOfferings.id, id));
  return c.json(successResponse({ deleted: true }));
});

export default vendorOfferingsRoute;
