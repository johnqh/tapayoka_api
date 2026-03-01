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

const serviceControls = new Hono<AppEnv>();

/** Helper: verify service belongs to authenticated user */
async function verifyServiceOwnership(
  db: ReturnType<typeof getDb>,
  serviceId: string,
  firebaseUid: string
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
        eq(vendorLocations.firebaseUserId, firebaseUid)
      )
    )
    .limit(1);
  return !!result;
}

/**
 * GET /service/:serviceId - Get all controls for a service
 */
serviceControls.get("/service/:serviceId", async c => {
  const serviceId = c.req.param("serviceId");
  const parsed = uuidSchema.safeParse(serviceId);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid service ID"), 400);
  }

  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  const owned = await verifyServiceOwnership(db, serviceId, firebaseUid);
  if (!owned) {
    return c.json(errorResponse("Service not found"), 404);
  }

  const results = await db
    .select()
    .from(vendorServiceControls)
    .where(eq(vendorServiceControls.vendorServiceId, serviceId));

  return c.json(successResponse(results));
});

/**
 * POST / - Create a new service control
 */
serviceControls.post(
  "/",
  zValidator("json", vendorServiceControlCreateSchema),
  async c => {
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    const owned = await verifyServiceOwnership(
      db,
      data.vendorServiceId,
      firebaseUid
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

/**
 * PUT /:id - Update a service control
 */
serviceControls.put(
  "/:id",
  zValidator("json", vendorServiceControlUpdateSchema),
  async c => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const firebaseUid = c.get("firebaseUid");
    const db = getDb();

    // Get the control and verify ownership through service -> location
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
      firebaseUid
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

/**
 * DELETE /:id - Delete a service control
 */
serviceControls.delete("/:id", async c => {
  const id = c.req.param("id");
  const firebaseUid = c.get("firebaseUid");
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
    firebaseUid
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
