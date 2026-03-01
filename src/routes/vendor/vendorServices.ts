import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorServices,
  vendorLocations,
  vendorEquipmentCategories,
  vendorEquipments,
} from "../../db/schema.ts";
import {
  vendorServiceCreateSchema,
  vendorServiceUpdateSchema,
  uuidSchema,
} from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";
import type { AppEnv } from "../../lib/hono-types.ts";

const vendorServicesRoute = new Hono<AppEnv>();

/**
 * GET /:id - Get a single vendor service
 */
vendorServicesRoute.get("/:id", async c => {
  const id = c.req.param("id");
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid service ID"), 400);
  }

  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  // Join to location to verify ownership
  const [result] = await db
    .select({ service: vendorServices })
    .from(vendorServices)
    .innerJoin(
      vendorLocations,
      eq(vendorServices.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorServices.id, id),
        eq(vendorLocations.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!result) {
    return c.json(errorResponse("Service not found"), 404);
  }

  return c.json(successResponse(result.service));
});

/**
 * POST / - Create a new vendor service
 */
vendorServicesRoute.post(
  "/",
  zValidator("json", vendorServiceCreateSchema),
  async c => {
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    // Verify location ownership
    const [location] = await db
      .select()
      .from(vendorLocations)
      .where(
        and(
          eq(vendorLocations.id, data.vendorLocationId),
          eq(vendorLocations.firebaseUserId, firebaseUid)
        )
      )
      .limit(1);

    if (!location) {
      return c.json(errorResponse("Location not found"), 404);
    }

    // Verify category ownership
    const [category] = await db
      .select()
      .from(vendorEquipmentCategories)
      .where(
        and(
          eq(vendorEquipmentCategories.id, data.vendorEquipmentCategoryId),
          eq(vendorEquipmentCategories.firebaseUserId, firebaseUid)
        )
      )
      .limit(1);

    if (!category) {
      return c.json(errorResponse("Category not found"), 404);
    }

    // Check unique constraint before insert
    const [existing] = await db
      .select()
      .from(vendorServices)
      .where(
        and(
          eq(vendorServices.vendorLocationId, data.vendorLocationId),
          eq(
            vendorServices.vendorEquipmentCategoryId,
            data.vendorEquipmentCategoryId
          )
        )
      )
      .limit(1);

    if (existing) {
      return c.json(
        errorResponse(
          "A service already exists for this location and category combination"
        ),
        409
      );
    }

    const [service] = await db
      .insert(vendorServices)
      .values(data)
      .returning();

    return c.json(successResponse(service), 201);
  }
);

/**
 * PUT /:id - Update a vendor service
 */
vendorServicesRoute.put(
  "/:id",
  zValidator("json", vendorServiceUpdateSchema),
  async c => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    // Verify ownership via location join
    const [existing] = await db
      .select({ service: vendorServices })
      .from(vendorServices)
      .innerJoin(
        vendorLocations,
        eq(vendorServices.vendorLocationId, vendorLocations.id)
      )
      .where(
        and(
          eq(vendorServices.id, id),
          eq(vendorLocations.firebaseUserId, firebaseUid)
        )
      )
      .limit(1);

    if (!existing) {
      return c.json(errorResponse("Service not found"), 404);
    }

    const [updated] = await db
      .update(vendorServices)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorServices.id, id))
      .returning();

    return c.json(successResponse(updated));
  }
);

/**
 * DELETE /:id - Delete a vendor service (409 if has equipments; controls cascade)
 */
vendorServicesRoute.delete("/:id", async c => {
  const id = c.req.param("id");
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  // Verify ownership via location join
  const [existing] = await db
    .select({ service: vendorServices })
    .from(vendorServices)
    .innerJoin(
      vendorLocations,
      eq(vendorServices.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorServices.id, id),
        eq(vendorLocations.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);

  if (!existing) {
    return c.json(errorResponse("Service not found"), 404);
  }

  // Check for associated equipments
  const [hasEquipments] = await db
    .select()
    .from(vendorEquipments)
    .where(eq(vendorEquipments.vendorServiceId, id))
    .limit(1);

  if (hasEquipments) {
    return c.json(
      errorResponse(
        "Cannot delete service with associated equipment. Remove equipment first."
      ),
      409
    );
  }

  // Controls cascade-delete via FK
  await db.delete(vendorServices).where(eq(vendorServices.id, id));
  return c.json(successResponse({ deleted: true }));
});

export default vendorServicesRoute;
