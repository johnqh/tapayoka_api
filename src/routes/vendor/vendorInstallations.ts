import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorInstallations,
  vendorLocations,
  vendorModels,
  vendorEquipments,
} from "../../db/schema.ts";
import {
  vendorInstallationCreateSchema,
  vendorInstallationUpdateSchema,
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

const vendorInstallationsRoute = new Hono<AppEnv>();

/** GET /:id - Get a single vendor installation */
vendorInstallationsRoute.get("/:id", async c => {
  const id = c.req.param("id");
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid installation ID"), 400);
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

  // Verify installation belongs to entity via location
  const [instResult] = await db
    .select({ installation: vendorInstallations })
    .from(vendorInstallations)
    .innerJoin(
      vendorLocations,
      eq(vendorInstallations.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorInstallations.id, id),
        eq(vendorLocations.entityId, result.entity.id)
      )
    )
    .limit(1);

  if (!instResult) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  return c.json(successResponse(instResult.installation));
});

/** POST / - Create a new vendor installation */
vendorInstallationsRoute.post(
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
      .from(vendorInstallations)
      .where(
        and(
          eq(vendorInstallations.vendorLocationId, data.vendorLocationId),
          eq(
            vendorInstallations.vendorModelId,
            data.vendorModelId
          )
        )
      )
      .limit(1);

    if (existing) {
      return c.json(
        errorResponse(
          "An installation already exists for this location and model combination"
        ),
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

/** PUT /:id - Update a vendor installation */
vendorInstallationsRoute.put(
  "/:id",
  zValidator("json", vendorInstallationUpdateSchema),
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
      .select({ installation: vendorInstallations })
      .from(vendorInstallations)
      .innerJoin(
        vendorLocations,
        eq(vendorInstallations.vendorLocationId, vendorLocations.id)
      )
      .where(
        and(
          eq(vendorInstallations.id, id),
          eq(vendorLocations.entityId, result.entity.id)
        )
      )
      .limit(1);

    if (!existing) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    const [updated] = await db
      .update(vendorInstallations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorInstallations.id, id))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete a vendor installation (409 if has equipments; controls cascade) */
vendorInstallationsRoute.delete("/:id", async c => {
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
    .select({ installation: vendorInstallations })
    .from(vendorInstallations)
    .innerJoin(
      vendorLocations,
      eq(vendorInstallations.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorInstallations.id, id),
        eq(vendorLocations.entityId, result.entity.id)
      )
    )
    .limit(1);

  if (!existing) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  // Check for associated equipments
  const [hasEquipments] = await db
    .select()
    .from(vendorEquipments)
    .where(eq(vendorEquipments.vendorInstallationId, id))
    .limit(1);

  if (hasEquipments) {
    return c.json(
      errorResponse(
        "Cannot delete installation with associated equipment. Remove equipment first."
      ),
      409
    );
  }

  // Controls cascade-delete via FK
  await db.delete(vendorInstallations).where(eq(vendorInstallations.id, id));
  return c.json(successResponse({ deleted: true }));
});

export default vendorInstallationsRoute;
