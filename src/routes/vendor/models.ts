import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, ne, and, sql } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorModels,
  vendorOfferings,
  vendorLocations,
  vendorInstallations,
} from "../../db/schema.ts";
import {
  vendorModelCreateSchema,
  vendorModelUpdateSchema,
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

const models = new Hono<AppEnv>();

/** GET / - List all models for the entity */
models.get("/", async c => {
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
    .select({
      model: vendorModels,
      offeringCount: sql<number>`count(${vendorOfferings.id})::int`,
    })
    .from(vendorModels)
    .leftJoin(
      vendorOfferings,
      and(
        eq(vendorOfferings.vendorModelId, vendorModels.id),
        ne(vendorOfferings.status, "Deleted")
      )
    )
    .where(and(eq(vendorModels.entityId, result.entity.id), ne(vendorModels.status, "Deleted")))
    .groupBy(vendorModels.id);
  return c.json(successResponse(results.map(r => ({ ...r.model, offeringCount: r.offeringCount }))));
});

/** GET /:id - Get a single model */
models.get("/:id", async c => {
  const id = c.req.param("id");
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid model ID"), 400);
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
  const [model] = await db
    .select()
    .from(vendorModels)
    .where(eq(vendorModels.id, id))
    .limit(1);

  if (!model || model.entityId !== result.entity.id) {
    return c.json(errorResponse("Model not found"), 404);
  }

  return c.json(successResponse(model));
});

/** POST / - Create a new model */
models.post(
  "/",
  zValidator("json", vendorModelCreateSchema),
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
    const [model] = await db
      .insert(vendorModels)
      .values({ ...data, entityId: result.entity.id })
      .returning();

    return c.json(successResponse(model), 201);
  }
);

/** PUT /:id - Update a model */
models.put(
  "/:id",
  zValidator("json", vendorModelUpdateSchema),
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
    const [model] = await db
      .select()
      .from(vendorModels)
      .where(eq(vendorModels.id, id))
      .limit(1);

    if (!model || model.entityId !== result.entity.id) {
      return c.json(errorResponse("Model not found"), 404);
    }

    const [updated] = await db
      .update(vendorModels)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorModels.id, id))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete a model (409 if has offerings) */
models.delete("/:id", async c => {
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
  const [model] = await db
    .select()
    .from(vendorModels)
    .where(eq(vendorModels.id, id))
    .limit(1);

  if (!model || model.entityId !== result.entity.id) {
    return c.json(errorResponse("Model not found"), 404);
  }

  await db
    .update(vendorModels)
    .set({ status: "Deleted" as const, updatedAt: new Date() })
    .where(eq(vendorModels.id, id));
  return c.json(successResponse({ deleted: true }));
});

/** GET /:id/offerings - Get offerings for a model */
models.get("/:id/offerings", async c => {
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
  const [model] = await db
    .select()
    .from(vendorModels)
    .where(eq(vendorModels.id, id))
    .limit(1);

  if (!model || model.entityId !== result.entity.id) {
    return c.json(errorResponse("Model not found"), 404);
  }

  const results = await db
    .select({
      offering: vendorOfferings,
      locationName: vendorLocations.name,
      installationCount: sql<number>`count(${vendorInstallations.walletAddress})::int`,
    })
    .from(vendorOfferings)
    .innerJoin(
      vendorLocations,
      eq(vendorOfferings.vendorLocationId, vendorLocations.id)
    )
    .leftJoin(
      vendorInstallations,
      and(
        eq(vendorInstallations.vendorOfferingId, vendorOfferings.id),
        ne(vendorInstallations.status, "Deleted")
      )
    )
    .where(and(eq(vendorOfferings.vendorModelId, id), ne(vendorOfferings.status, "Deleted")))
    .groupBy(vendorOfferings.id, vendorLocations.name);

  return c.json(
    successResponse(
      results.map(r => ({ ...r.offering, locationName: r.locationName, installationCount: r.installationCount }))
    )
  );
});

export default models;
