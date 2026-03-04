import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorServiceControls,
  vendorServices,
  vendorLocations,
} from "../../db/schema.ts";
import {
  vendorServiceControlCreateSchema,
  vendorServiceControlUpdateSchema,
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

const serviceControls = new Hono<AppEnv>();

/** Helper: verify service belongs to entity via location */
async function verifyServiceOwnership(
  db: ReturnType<typeof getDb>,
  serviceId: string,
  entityId: string
) {
  const [result] = await db
    .select({ service: vendorServices })
    .from(vendorServices)
    .innerJoin(
      vendorLocations,
      eq(vendorServices.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorServices.id, serviceId),
        eq(vendorLocations.entityId, entityId)
      )
    )
    .limit(1);
  return !!result;
}

/** GET /service/:serviceId - Get all controls for a service */
serviceControls.get("/service/:serviceId", async c => {
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
  const owned = await verifyServiceOwnership(db, serviceId, result.entity.id);
  if (!owned) {
    return c.json(errorResponse("Service not found"), 404);
  }

  const results = await db
    .select()
    .from(vendorServiceControls)
    .where(eq(vendorServiceControls.vendorServiceId, serviceId));

  return c.json(successResponse(results));
});

/** POST / - Create a new service control */
serviceControls.post(
  "/",
  zValidator("json", vendorServiceControlCreateSchema),
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
    const owned = await verifyServiceOwnership(
      db,
      data.vendorServiceId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Service not found"), 404);
    }

    const [control] = await db
      .insert(vendorServiceControls)
      .values(data)
      .returning();

    return c.json(successResponse(control), 201);
  }
);

/** PUT /:id - Update a service control */
serviceControls.put(
  "/:id",
  zValidator("json", vendorServiceControlUpdateSchema),
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
      .from(vendorServiceControls)
      .where(eq(vendorServiceControls.id, id))
      .limit(1);

    if (!control) {
      return c.json(errorResponse("Service control not found"), 404);
    }

    const owned = await verifyServiceOwnership(
      db,
      control.vendorServiceId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Service control not found"), 404);
    }

    const [updated] = await db
      .update(vendorServiceControls)
      .set(data)
      .where(eq(vendorServiceControls.id, id))
      .returning();

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete a service control */
serviceControls.delete("/:id", async c => {
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
    .from(vendorServiceControls)
    .where(eq(vendorServiceControls.id, id))
    .limit(1);

  if (!control) {
    return c.json(errorResponse("Service control not found"), 404);
  }

  const owned = await verifyServiceOwnership(
    db,
    control.vendorServiceId,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Service control not found"), 404);
  }

  await db
    .delete(vendorServiceControls)
    .where(eq(vendorServiceControls.id, id));
  return c.json(successResponse({ deleted: true }));
});

export default serviceControls;
