import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { services } from "../../db/schema.ts";
import {
  serviceCreateSchema,
  serviceUpdateSchema,
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

const vendorServices = new Hono<AppEnv>();

/** GET / - List all services for the entity */
vendorServices.get("/", async c => {
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
  const allServices = await db
    .select()
    .from(services)
    .where(eq(services.entityId, result.entity.id));
  return c.json(successResponse(allServices));
});

/** GET /:id - Get service by ID */
vendorServices.get("/:id", async c => {
  const serviceId = c.req.param("id");
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
  const [service] = await db
    .select()
    .from(services)
    .where(
      and(eq(services.id, serviceId), eq(services.entityId, result.entity.id))
    )
    .limit(1);

  if (!service) {
    return c.json(errorResponse("Service not found"), 404);
  }

  return c.json(successResponse(service));
});

/** POST / - Create a new service */
vendorServices.post("/", zValidator("json", serviceCreateSchema), async c => {
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
      errorResponse("TRIGGER services must not have fixedMinutes or minutesPer25c"),
      400
    );
  }
  if (data.type === "FIXED" && !data.fixedMinutes) {
    return c.json(
      errorResponse("FIXED services require fixedMinutes"),
      400
    );
  }
  if (data.type === "VARIABLE" && !data.minutesPer25c) {
    return c.json(
      errorResponse("VARIABLE services require minutesPer25c"),
      400
    );
  }

  const db = getDb();
  const [service] = await db
    .insert(services)
    .values({ ...data, entityId: result.entity.id })
    .returning();

  return c.json(successResponse(service), 201);
});

/** PUT /:id - Update a service */
vendorServices.put(
  "/:id",
  zValidator("json", serviceUpdateSchema),
  async c => {
    const serviceId = c.req.param("id");
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
      .update(services)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(services.id, serviceId),
          eq(services.entityId, result.entity.id)
        )
      )
      .returning();

    if (!updated) {
      return c.json(errorResponse("Service not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete a service */
vendorServices.delete("/:id", async c => {
  const serviceId = c.req.param("id");
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
    .delete(services)
    .where(
      and(
        eq(services.id, serviceId),
        eq(services.entityId, result.entity.id)
      )
    )
    .returning();

  if (!deleted) {
    return c.json(errorResponse("Service not found"), 404);
  }

  return c.json(successResponse({ deleted: true }));
});

export default vendorServices;
