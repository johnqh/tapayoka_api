import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { installations } from "../../db/schema.ts";
import {
  installationCreateSchema,
  installationUpdateSchema,
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

const vendorInstallationsLegacy = new Hono<AppEnv>();

/** GET / - List all installations for the entity */
vendorInstallationsLegacy.get("/", async c => {
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
  const allInstallations = await db
    .select()
    .from(installations)
    .where(eq(installations.entityId, result.entity.id));
  return c.json(successResponse(allInstallations));
});

/** GET /:id - Get installation by ID */
vendorInstallationsLegacy.get("/:id", async c => {
  const installationId = c.req.param("id");
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
  const [installation] = await db
    .select()
    .from(installations)
    .where(
      and(eq(installations.id, installationId), eq(installations.entityId, result.entity.id))
    )
    .limit(1);

  if (!installation) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  return c.json(successResponse(installation));
});

/** POST / - Create a new installation */
vendorInstallationsLegacy.post("/", zValidator("json", installationCreateSchema), async c => {
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

  // Validate type-specific fields
  if (data.type === "TRIGGER" && (data.fixedMinutes || data.minutesPer25c)) {
    return c.json(
      errorResponse("TRIGGER installations must not have fixedMinutes or minutesPer25c"),
      400
    );
  }
  if (data.type === "FIXED" && !data.fixedMinutes) {
    return c.json(
      errorResponse("FIXED installations require fixedMinutes"),
      400
    );
  }
  if (data.type === "VARIABLE" && !data.minutesPer25c) {
    return c.json(
      errorResponse("VARIABLE installations require minutesPer25c"),
      400
    );
  }

  const db = getDb();
  const [installation] = await db
    .insert(installations)
    .values({ ...data, entityId: result.entity.id })
    .returning();

  return c.json(successResponse(installation), 201);
});

/** PUT /:id - Update an installation */
vendorInstallationsLegacy.put(
  "/:id",
  zValidator("json", installationUpdateSchema),
  async c => {
    const installationId = c.req.param("id");
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
      .update(installations)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(installations.id, installationId),
          eq(installations.entityId, result.entity.id)
        )
      )
      .returning();

    if (!updated) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete an installation */
vendorInstallationsLegacy.delete("/:id", async c => {
  const installationId = c.req.param("id");
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
    .delete(installations)
    .where(
      and(
        eq(installations.id, installationId),
        eq(installations.entityId, result.entity.id)
      )
    )
    .returning();

  if (!deleted) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  return c.json(successResponse({ deleted: true }));
});

export default vendorInstallationsLegacy;
