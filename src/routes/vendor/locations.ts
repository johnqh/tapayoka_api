import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, ne, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorLocations,
  vendorOfferings,
  vendorModels,
} from "../../db/schema.ts";
import {
  vendorLocationCreateSchema,
  vendorLocationUpdateSchema,
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

const locations = new Hono<AppEnv>();

/** GET / - List all locations for the entity */
locations.get("/", async c => {
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
  const results = await db
    .select()
    .from(vendorLocations)
    .where(and(eq(vendorLocations.entityId, result.entity.id), ne(vendorLocations.status, "Deleted")));
  return c.json(successResponse(results));
});

/** GET /:id - Get a single location */
locations.get("/:id", async c => {
  const id = c.req.param("id");
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid location ID"), 400);
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
  const [location] = await db
    .select()
    .from(vendorLocations)
    .where(eq(vendorLocations.id, id))
    .limit(1);

  if (!location || location.entityId !== result.entity.id) {
    return c.json(errorResponse("Location not found"), 404);
  }

  return c.json(successResponse(location));
});

/** POST / - Create a new location */
locations.post(
  "/",
  zValidator("json", vendorLocationCreateSchema),
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
    const [location] = await db
      .insert(vendorLocations)
      .values({ ...data, entityId: result.entity.id })
      .returning();

    return c.json(successResponse(location), 201);
  }
);

/** PUT /:id - Update a location */
locations.put(
  "/:id",
  zValidator("json", vendorLocationUpdateSchema),
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
    const [location] = await db
      .select()
      .from(vendorLocations)
      .where(eq(vendorLocations.id, id))
      .limit(1);

    if (!location || location.entityId !== result.entity.id) {
      return c.json(errorResponse("Location not found"), 404);
    }

    const [updated] = await db
      .update(vendorLocations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorLocations.id, id))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete a location (409 if has offerings) */
locations.delete("/:id", async c => {
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
  const [location] = await db
    .select()
    .from(vendorLocations)
    .where(eq(vendorLocations.id, id))
    .limit(1);

  if (!location || location.entityId !== result.entity.id) {
    return c.json(errorResponse("Location not found"), 404);
  }

  await db
    .update(vendorLocations)
    .set({ status: "Deleted" as const, updatedAt: new Date() })
    .where(eq(vendorLocations.id, id));
  return c.json(successResponse({ deleted: true }));
});

/** GET /:id/offerings - Get offerings for a location */
locations.get("/:id/offerings", async c => {
  const id = c.req.param("id");
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
  const [location] = await db
    .select()
    .from(vendorLocations)
    .where(eq(vendorLocations.id, id))
    .limit(1);

  if (!location || location.entityId !== result.entity.id) {
    return c.json(errorResponse("Location not found"), 404);
  }

  const results = await db
    .select({
      offering: vendorOfferings,
      modelName: vendorModels.name,
    })
    .from(vendorOfferings)
    .innerJoin(
      vendorModels,
      eq(vendorOfferings.vendorModelId, vendorModels.id)
    )
    .where(eq(vendorOfferings.vendorLocationId, id));

  return c.json(
    successResponse(
      results.map(r => ({ ...r.offering, modelName: r.modelName }))
    )
  );
});

export default locations;
