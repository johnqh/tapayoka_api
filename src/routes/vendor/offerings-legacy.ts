import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { offerings } from "../../db/schema.ts";
import {
  offeringCreateSchema,
  offeringUpdateSchema,
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

const vendorOfferingsLegacy = new Hono<AppEnv>();

/** GET / - List all offerings for the entity */
vendorOfferingsLegacy.get("/", async c => {
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
  const allOfferings = await db
    .select()
    .from(offerings)
    .where(eq(offerings.entityId, result.entity.id));
  return c.json(successResponse(allOfferings));
});

/** GET /:id - Get offering by ID */
vendorOfferingsLegacy.get("/:id", async c => {
  const offeringId = c.req.param("id");
  const parsed = uuidSchema.safeParse(offeringId);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid offering ID"), 400);
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
  const [offering] = await db
    .select()
    .from(offerings)
    .where(
      and(eq(offerings.id, offeringId), eq(offerings.entityId, result.entity.id))
    )
    .limit(1);

  if (!offering) {
    return c.json(errorResponse("Offering not found"), 404);
  }

  return c.json(successResponse(offering));
});

/** POST / - Create a new offering */
vendorOfferingsLegacy.post("/", zValidator("json", offeringCreateSchema), async c => {
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
      errorResponse("TRIGGER offerings must not have fixedMinutes or minutesPer25c"),
      400
    );
  }
  if (data.type === "FIXED" && !data.fixedMinutes) {
    return c.json(
      errorResponse("FIXED offerings require fixedMinutes"),
      400
    );
  }
  if (data.type === "VARIABLE" && !data.minutesPer25c) {
    return c.json(
      errorResponse("VARIABLE offerings require minutesPer25c"),
      400
    );
  }

  const db = getDb();
  const [offering] = await db
    .insert(offerings)
    .values({ ...data, entityId: result.entity.id })
    .returning();

  return c.json(successResponse(offering), 201);
});

/** PUT /:id - Update an offering */
vendorOfferingsLegacy.put(
  "/:id",
  zValidator("json", offeringUpdateSchema),
  async c => {
    const offeringId = c.req.param("id");
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
      .update(offerings)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(offerings.id, offeringId),
          eq(offerings.entityId, result.entity.id)
        )
      )
      .returning();

    if (!updated) {
      return c.json(errorResponse("Offering not found"), 404);
    }

    return c.json(successResponse(updated));
  }
);

/** DELETE /:id - Delete an offering */
vendorOfferingsLegacy.delete("/:id", async c => {
  const offeringId = c.req.param("id");
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
    .delete(offerings)
    .where(
      and(
        eq(offerings.id, offeringId),
        eq(offerings.entityId, result.entity.id)
      )
    )
    .returning();

  if (!deleted) {
    return c.json(errorResponse("Offering not found"), 404);
  }

  return c.json(successResponse({ deleted: true }));
});

export default vendorOfferingsLegacy;
