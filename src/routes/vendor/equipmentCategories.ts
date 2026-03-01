import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorEquipmentCategories,
  vendorServices,
  vendorLocations,
} from "../../db/schema.ts";
import {
  vendorEquipmentCategoryCreateSchema,
  vendorEquipmentCategoryUpdateSchema,
  uuidSchema,
} from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";
import type { AppEnv } from "../../lib/hono-types.ts";

const equipmentCategories = new Hono<AppEnv>();

/**
 * GET / - List all equipment categories for the authenticated vendor
 */
equipmentCategories.get("/", async c => {
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();
  const results = await db
    .select()
    .from(vendorEquipmentCategories)
    .where(eq(vendorEquipmentCategories.firebaseUserId, firebaseUid));
  return c.json(successResponse(results));
});

/**
 * GET /:id - Get a single equipment category
 */
equipmentCategories.get("/:id", async c => {
  const id = c.req.param("id");
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid category ID"), 400);
  }

  const firebaseUid = c.get("firebaseUid");
  const db = getDb();
  const [category] = await db
    .select()
    .from(vendorEquipmentCategories)
    .where(
      and(
        eq(vendorEquipmentCategories.id, id),
        eq(vendorEquipmentCategories.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!category) {
    return c.json(errorResponse("Category not found"), 404);
  }

  return c.json(successResponse(category));
});

/**
 * POST / - Create a new equipment category
 */
equipmentCategories.post(
  "/",
  zValidator("json", vendorEquipmentCategoryCreateSchema),
  async c => {
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    const [category] = await db
      .insert(vendorEquipmentCategories)
      .values({ ...data, firebaseUserId: firebaseUid })
      .returning();

    return c.json(successResponse(category), 201);
  }
);

/**
 * PUT /:id - Update an equipment category
 */
equipmentCategories.put(
  "/:id",
  zValidator("json", vendorEquipmentCategoryUpdateSchema),
  async c => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    const [updated] = await db
      .update(vendorEquipmentCategories)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(vendorEquipmentCategories.id, id),
          eq(vendorEquipmentCategories.firebaseUserId, firebaseUid)
        )
      )
      .returning();

    if (!updated) {
      return c.json(errorResponse("Category not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/**
 * DELETE /:id - Delete a category (409 if has services)
 */
equipmentCategories.delete("/:id", async c => {
  const id = c.req.param("id");
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  // Check ownership
  const [category] = await db
    .select()
    .from(vendorEquipmentCategories)
    .where(
      and(
        eq(vendorEquipmentCategories.id, id),
        eq(vendorEquipmentCategories.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!category) {
    return c.json(errorResponse("Category not found"), 404);
  }

  // Check for associated services
  const [hasServices] = await db
    .select()
    .from(vendorServices)
    .where(eq(vendorServices.vendorEquipmentCategoryId, id))
    .limit(1);

  if (hasServices) {
    return c.json(
      errorResponse(
        "Cannot delete category with associated services. Remove services first."
      ),
      409
    );
  }

  await db
    .delete(vendorEquipmentCategories)
    .where(eq(vendorEquipmentCategories.id, id));
  return c.json(successResponse({ deleted: true }));
});

/**
 * GET /:id/services - Get services for a category
 */
equipmentCategories.get("/:id/services", async c => {
  const id = c.req.param("id");
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  // Verify ownership
  const [category] = await db
    .select()
    .from(vendorEquipmentCategories)
    .where(
      and(
        eq(vendorEquipmentCategories.id, id),
        eq(vendorEquipmentCategories.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!category) {
    return c.json(errorResponse("Category not found"), 404);
  }

  const results = await db
    .select({
      service: vendorServices,
      locationName: vendorLocations.name,
    })
    .from(vendorServices)
    .innerJoin(
      vendorLocations,
      eq(vendorServices.vendorLocationId, vendorLocations.id)
    )
    .where(eq(vendorServices.vendorEquipmentCategoryId, id));

  return c.json(
    successResponse(
      results.map(r => ({ ...r.service, locationName: r.locationName }))
    )
  );
});

export default equipmentCategories;
