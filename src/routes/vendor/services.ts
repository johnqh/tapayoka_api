import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
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

const vendorServices = new Hono();

/**
 * GET / - List all services for the vendor's entity
 */
vendorServices.get("/", async c => {
  const db = getDb();
  // TODO: filter by entity from auth context
  const allServices = await db.select().from(services);
  return c.json(successResponse(allServices));
});

/**
 * GET /:id - Get service by ID
 */
vendorServices.get("/:id", async c => {
  const serviceId = c.req.param("id");
  const parsed = uuidSchema.safeParse(serviceId);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid service ID"), 400);
  }

  const db = getDb();
  const [service] = await db
    .select()
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);

  if (!service) {
    return c.json(errorResponse("Service not found"), 404);
  }

  return c.json(successResponse(service));
});

/**
 * POST / - Create a new service
 */
vendorServices.post("/", zValidator("json", serviceCreateSchema), async c => {
  const data = c.req.valid("json");
  // TODO: get entityId from auth context
  const entityId = "default";

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
    .values({ ...data, entityId })
    .returning();

  return c.json(successResponse(service), 201);
});

/**
 * PUT /:id - Update a service
 */
vendorServices.put(
  "/:id",
  zValidator("json", serviceUpdateSchema),
  async c => {
    const serviceId = c.req.param("id");
    const data = c.req.valid("json");

    const db = getDb();
    const [updated] = await db
      .update(services)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(services.id, serviceId))
      .returning();

    if (!updated) {
      return c.json(errorResponse("Service not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/**
 * DELETE /:id - Delete a service
 */
vendorServices.delete("/:id", async c => {
  const serviceId = c.req.param("id");

  const db = getDb();
  const [deleted] = await db
    .delete(services)
    .where(eq(services.id, serviceId))
    .returning();

  if (!deleted) {
    return c.json(errorResponse("Service not found"), 404);
  }

  return c.json(successResponse({ deleted: true }));
});

export default vendorServices;
