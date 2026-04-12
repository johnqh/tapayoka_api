import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorInstallationSlots,
  vendorInstallations,
  vendorOfferings,
  vendorLocations,
} from "../../db/schema.ts";
import {
  vendorInstallationSlotCreateSchema,
  vendorInstallationSlotUpdateSchema,
  vendorInstallationSlotBulkCreateSchema,
  ethAddressSchema,
  uuidSchema,
} from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
  type VendorInstallationSlot,
  type PricingTier,
  type DeleteResult,
} from "@sudobility/tapayoka_types";
import type { AppEnv } from "../../lib/hono-types.ts";
import {
  getEntityWithPermission,
  getPermissionErrorStatus,
} from "../../lib/entity-helpers.ts";

const installationSlots = new Hono<AppEnv>();

/** Helper: verify installation belongs to entity via offering -> location */
async function verifyInstallationOwnership(
  db: ReturnType<typeof getDb>,
  walletAddress: string,
  entityId: string
) {
  const [result] = await db
    .select({ installation: vendorInstallations })
    .from(vendorInstallations)
    .innerJoin(
      vendorOfferings,
      eq(vendorInstallations.vendorOfferingId, vendorOfferings.id)
    )
    .innerJoin(
      vendorLocations,
      eq(vendorOfferings.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorInstallations.walletAddress, walletAddress),
        eq(vendorLocations.entityId, entityId)
      )
    )
    .limit(1);
  return !!result;
}

/** GET /installation/:walletAddress - List all slots for an installation */
installationSlots.get("/installation/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
  const parsed = ethAddressSchema.safeParse(walletAddress);
  if (!parsed.success) {
    return c.json(errorResponse("Invalid wallet address"), 400);
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
  const owned = await verifyInstallationOwnership(
    db,
    walletAddress,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  const results = await db
    .select()
    .from(vendorInstallationSlots)
    .where(eq(vendorInstallationSlots.installationWalletAddress, walletAddress))
    .orderBy(vendorInstallationSlots.sortOrder);

  const data: VendorInstallationSlot[] = results.map(r => ({
    ...r,
    pricingTier: r.pricingTier as PricingTier | null,
  }));
  return c.json(successResponse(data));
});

/** POST /installation/:walletAddress - Create a single slot */
installationSlots.post(
  "/installation/:walletAddress",
  zValidator("json", vendorInstallationSlotCreateSchema),
  async c => {
    const walletAddress = c.req.param("walletAddress");
    const parsedAddr = ethAddressSchema.safeParse(walletAddress);
    if (!parsedAddr.success) {
      return c.json(errorResponse("Invalid wallet address"), 400);
    }

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
      walletAddress,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    // Check for soft-deleted slot with same label
    const [existingSlot] = await db
      .select()
      .from(vendorInstallationSlots)
      .where(
        and(
          eq(vendorInstallationSlots.installationWalletAddress, walletAddress),
          eq(vendorInstallationSlots.label, data.label)
        )
      )
      .limit(1);

    let slot;
    if (existingSlot && existingSlot.status === "Deleted") {
      const [reactivated] = await db
        .update(vendorInstallationSlots)
        .set({
          ...data,
          installationWalletAddress: walletAddress,
          status: "Active" as const,
          updatedAt: new Date(),
        })
        .where(eq(vendorInstallationSlots.id, existingSlot.id))
        .returning();
      slot = reactivated;
    } else if (existingSlot) {
      return c.json(
        errorResponse("A slot with this label already exists"),
        409
      );
    } else {
      const [created] = await db
        .insert(vendorInstallationSlots)
        .values({
          installationWalletAddress: walletAddress,
          ...data,
        })
        .returning();
      slot = created;
    }

    const responseData: VendorInstallationSlot = {
      ...slot,
      pricingTier: slot.pricingTier as PricingTier | null,
    };
    return c.json(successResponse(responseData), 201);
  }
);

/** POST /installation/:walletAddress/bulk - Bulk create from rows x columns */
installationSlots.post(
  "/installation/:walletAddress/bulk",
  zValidator("json", vendorInstallationSlotBulkCreateSchema),
  async c => {
    const walletAddress = c.req.param("walletAddress");
    const parsedAddr = ethAddressSchema.safeParse(walletAddress);
    if (!parsedAddr.success) {
      return c.json(errorResponse("Invalid wallet address"), 400);
    }

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
      walletAddress,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    // Generate labels row-major: A1, A2, ..., B1, B2, ...
    const values = data.rows.flatMap((row, rowIdx) =>
      data.columns.map((col, colIdx) => ({
        installationWalletAddress: walletAddress,
        label: `${row}${col}`,
        row,
        column: col,
        sortOrder: rowIdx * data.columns.length + colIdx,
      }))
    );

    const slots = await db
      .insert(vendorInstallationSlots)
      .values(values)
      .onConflictDoUpdate({
        target: [
          vendorInstallationSlots.installationWalletAddress,
          vendorInstallationSlots.label,
        ],
        set: {
          row: sql`excluded.row`,
          column: sql`excluded.column`,
          sortOrder: sql`excluded.sort_order`,
          status: "Active" as const,
          updatedAt: new Date(),
        },
      })
      .returning();

    const responseData: VendorInstallationSlot[] = slots.map(s => ({
      ...s,
      pricingTier: s.pricingTier as PricingTier | null,
    }));
    return c.json(successResponse(responseData), 201);
  }
);

/** PUT /:slotId - Update a slot */
installationSlots.put(
  "/:slotId",
  zValidator("json", vendorInstallationSlotUpdateSchema),
  async c => {
    const slotId = c.req.param("slotId");
    const parsedId = uuidSchema.safeParse(slotId);
    if (!parsedId.success) {
      return c.json(errorResponse("Invalid slot ID"), 400);
    }

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

    // Get slot and verify ownership
    const [slot] = await db
      .select()
      .from(vendorInstallationSlots)
      .where(eq(vendorInstallationSlots.id, slotId))
      .limit(1);

    if (!slot) {
      return c.json(errorResponse("Slot not found"), 404);
    }

    const owned = await verifyInstallationOwnership(
      db,
      slot.installationWalletAddress,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Slot not found"), 404);
    }

    const [updatedRow] = await db
      .update(vendorInstallationSlots)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorInstallationSlots.id, slotId))
      .returning();

    const updated: VendorInstallationSlot = {
      ...updatedRow,
      pricingTier: updatedRow.pricingTier as PricingTier | null,
    };
    return c.json(successResponse(updated));
  }
);

/** DELETE /:slotId - Delete a slot */
installationSlots.delete("/:slotId", async c => {
  const slotId = c.req.param("slotId");
  const parsedId = uuidSchema.safeParse(slotId);
  if (!parsedId.success) {
    return c.json(errorResponse("Invalid slot ID"), 400);
  }

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
  const [slot] = await db
    .select()
    .from(vendorInstallationSlots)
    .where(eq(vendorInstallationSlots.id, slotId))
    .limit(1);

  if (!slot) {
    return c.json(errorResponse("Slot not found"), 404);
  }

  const owned = await verifyInstallationOwnership(
    db,
    slot.installationWalletAddress,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Slot not found"), 404);
  }

  await db
    .update(vendorInstallationSlots)
    .set({ status: "Deleted" as const, updatedAt: new Date() })
    .where(eq(vendorInstallationSlots.id, slotId));
  const deleteData: DeleteResult = { deleted: true };
  return c.json(successResponse(deleteData));
});

/** DELETE /installation/:walletAddress - Delete all slots for an installation */
installationSlots.delete("/installation/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
  const parsedAddr = ethAddressSchema.safeParse(walletAddress);
  if (!parsedAddr.success) {
    return c.json(errorResponse("Invalid wallet address"), 400);
  }

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
    walletAddress,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  await db
    .update(vendorInstallationSlots)
    .set({ status: "Deleted" as const, updatedAt: new Date() })
    .where(
      eq(vendorInstallationSlots.installationWalletAddress, walletAddress)
    );
  const deleteData: DeleteResult = { deleted: true };
  return c.json(successResponse(deleteData));
});

export default installationSlots;
