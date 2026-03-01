import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorLocations,
  vendorServices,
  vendorEquipmentCategories,
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

const locations = new Hono<AppEnv>();

/**
 * GET / - List all locations for the authenticated vendor
 */
locations.get("/", async c => {
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();
  const results = await db
    .select()
    .from(vendorLocations)
    .where(eq(vendorLocations.firebaseUserId, firebaseUid));
  return c.json(successResponse(results));
});

/**
 * GET /:id - Get a single location
 */
locations.get("/:id", async c => {
  const id = c.req.param("id");
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid location ID"), 400);
  }

  const firebaseUid = c.get("firebaseUid");
  const db = getDb();
  const [location] = await db
    .select()
    .from(vendorLocations)
    .where(
      and(
        eq(vendorLocations.id, id),
        eq(vendorLocations.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!location) {
    return c.json(errorResponse("Location not found"), 404);
  }

  return c.json(successResponse(location));
});

/**
 * POST / - Create a new location
 */
locations.post(
  "/",
  zValidator("json", vendorLocationCreateSchema),
  async c => {
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    const [location] = await db
      .insert(vendorLocations)
      .values({ ...data, firebaseUserId: firebaseUid })
      .returning();

    return c.json(successResponse(location), 201);
  }
);

/**
 * PUT /:id - Update a location
 */
locations.put(
  "/:id",
  zValidator("json", vendorLocationUpdateSchema),
  async c => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    const [updated] = await db
      .update(vendorLocations)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(vendorLocations.id, id),
          eq(vendorLocations.firebaseUserId, firebaseUid)
        )
      )
      .returning();

    if (!updated) {
      return c.json(errorResponse("Location not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/**
 * DELETE /:id - Delete a location (409 if has services)
 */
locations.delete("/:id", async c => {
  const id = c.req.param("id");
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  // Check ownership
  const [location] = await db
    .select()
    .from(vendorLocations)
    .where(
      and(
        eq(vendorLocations.id, id),
        eq(vendorLocations.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!location) {
    return c.json(errorResponse("Location not found"), 404);
  }

  // Check for associated services
  const [hasServices] = await db
    .select()
    .from(vendorServices)
    .where(eq(vendorServices.vendorLocationId, id))
    .limit(1);

  if (hasServices) {
    return c.json(
      errorResponse(
        "Cannot delete location with associated services. Remove services first."
      ),
      409
    );
  }

  await db.delete(vendorLocations).where(eq(vendorLocations.id, id));
  return c.json(successResponse({ deleted: true }));
});

/**
 * GET /:id/services - Get services for a location
 */
locations.get("/:id/services", async c => {
  const id = c.req.param("id");
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  // Verify ownership
  const [location] = await db
    .select()
    .from(vendorLocations)
    .where(
      and(
        eq(vendorLocations.id, id),
        eq(vendorLocations.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!location) {
    return c.json(errorResponse("Location not found"), 404);
  }

  const results = await db
    .select({
      service: vendorServices,
      categoryName: vendorEquipmentCategories.name,
    })
    .from(vendorServices)
    .innerJoin(
      vendorEquipmentCategories,
      eq(vendorServices.vendorEquipmentCategoryId, vendorEquipmentCategories.id)
    )
    .where(eq(vendorServices.vendorLocationId, id));

  return c.json(
    successResponse(
      results.map(r => ({ ...r.service, categoryName: r.categoryName }))
    )
  );
});

export default locations;
