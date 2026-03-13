import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorModels,
  vendorInstallations,
  vendorLocations,
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
    .select()
    .from(vendorModels)
    .where(eq(vendorModels.entityId, result.entity.id));
  return c.json(successResponse(results));
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

/** DELETE /:id - Delete a model (409 if has installations) */
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

  // Check for associated installations
  const [hasInstallations] = await db
    .select()
    .from(vendorInstallations)
    .where(eq(vendorInstallations.vendorModelId, id))
    .limit(1);

  if (hasInstallations) {
    return c.json(
      errorResponse(
        "Cannot delete model with associated installations. Remove installations first."
      ),
      409
    );
  }

  await db
    .delete(vendorModels)
    .where(eq(vendorModels.id, id));
  return c.json(successResponse({ deleted: true }));
});

/** GET /:id/installations - Get installations for a model */
models.get("/:id/installations", async c => {
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
      installation: vendorInstallations,
      locationName: vendorLocations.name,
    })
    .from(vendorInstallations)
    .innerJoin(
      vendorLocations,
      eq(vendorInstallations.vendorLocationId, vendorLocations.id)
    )
    .where(eq(vendorInstallations.vendorModelId, id));

  return c.json(
    successResponse(
      results.map(r => ({ ...r.installation, locationName: r.locationName }))
    )
  );
});

export default models;
