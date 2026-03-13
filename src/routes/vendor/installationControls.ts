import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorInstallationControls,
  vendorInstallations,
  vendorLocations,
} from "../../db/schema.ts";
import {
  vendorInstallationControlCreateSchema,
  vendorInstallationControlUpdateSchema,
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

const installationControls = new Hono<AppEnv>();

/** Helper: verify installation belongs to entity via location */
async function verifyInstallationOwnership(
  db: ReturnType<typeof getDb>,
  installationId: string,
  entityId: string
) {
  const [result] = await db
    .select({ installation: vendorInstallations })
    .from(vendorInstallations)
    .innerJoin(
      vendorLocations,
      eq(vendorInstallations.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorInstallations.id, installationId),
        eq(vendorLocations.entityId, entityId)
      )
    )
    .limit(1);
  return !!result;
}

/** GET /installation/:installationId - Get all controls for an installation */
installationControls.get("/installation/:installationId", async c => {
  const installationId = c.req.param("installationId");
  const parsed = uuidSchema.safeParse(installationId);
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
  const owned = await verifyInstallationOwnership(db, installationId, result.entity.id);
  if (!owned) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  const results = await db
    .select()
    .from(vendorInstallationControls)
    .where(eq(vendorInstallationControls.vendorInstallationId, installationId));

  return c.json(successResponse(results));
});

/** POST / - Create a new installation control */
installationControls.post(
  "/",
  zValidator("json", vendorInstallationControlCreateSchema),
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
    const owned = await verifyInstallationOwnership(
      db,
      data.vendorInstallationId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    const [control] = await db
      .insert(vendorInstallationControls)
      .values(data)
      .returning();

    return c.json(successResponse(control), 201);
  }
);

/** PUT /:id - Update an installation control */
installationControls.put(
  "/:id",
  zValidator("json", vendorInstallationControlUpdateSchema),
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
    const [control] = await db
      .select()
      .from(vendorInstallationControls)
      .where(eq(vendorInstallationControls.id, id))
      .limit(1);

    if (!control) {
      return c.json(errorResponse("Installation control not found"), 404);
    }

    const owned = await verifyInstallationOwnership(
      db,
      control.vendorInstallationId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Installation control not found"), 404);
    }

    const [updated] = await db
      .update(vendorInstallationControls)
      .set(data)
      .where(eq(vendorInstallationControls.id, id))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete an installation control */
installationControls.delete("/:id", async c => {
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
  const [control] = await db
    .select()
    .from(vendorInstallationControls)
    .where(eq(vendorInstallationControls.id, id))
    .limit(1);

  if (!control) {
    return c.json(errorResponse("Installation control not found"), 404);
  }

  const owned = await verifyInstallationOwnership(
    db,
    control.vendorInstallationId,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Installation control not found"), 404);
  }

  await db
    .delete(vendorInstallationControls)
    .where(eq(vendorInstallationControls.id, id));
  return c.json(successResponse({ deleted: true }));
});

export default installationControls;
