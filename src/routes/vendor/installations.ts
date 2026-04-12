import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count, ne } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorInstallations,
  vendorInstallationSlots,
  vendorOfferings,
  vendorLocations,
  vendorModels,
} from "../../db/schema.ts";
import {
  vendorInstallationCreateSchema,
  vendorInstallationUpdateSchema,
  ethAddressSchema,
  uuidSchema,
} from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
  verifySignedData,
  type VendorInstallation,
  type DeleteResult,
} from "@sudobility/tapayoka_types";
import type { AppEnv } from "../../lib/hono-types.ts";
import {
  getEntityWithPermission,
  getPermissionErrorStatus,
} from "../../lib/entity-helpers.ts";
import { verifyResponseSignature } from "../../services/crypto.ts";

const installations = new Hono<AppEnv>();

/** Helper: verify offering belongs to entity via location */
async function verifyOfferingOwnership(
  db: ReturnType<typeof getDb>,
  offeringId: string,
  entityId: string
) {
  const [result] = await db
    .select({ offering: vendorOfferings })
    .from(vendorOfferings)
    .innerJoin(
      vendorLocations,
      eq(vendorOfferings.vendorLocationId, vendorLocations.id)
    )
    .where(
      and(
        eq(vendorOfferings.id, offeringId),
        eq(vendorLocations.entityId, entityId)
      )
    )
    .limit(1);
  return !!result;
}

/** GET /service/:serviceId - Get all installations for an offering */
installations.get("/service/:serviceId", async c => {
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
  const owned = await verifyOfferingOwnership(db, serviceId, result.entity.id);
  if (!owned) {
    return c.json(errorResponse("Offering not found"), 404);
  }

  const results = await db
    .select({
      walletAddress: vendorInstallations.walletAddress,
      vendorOfferingId: vendorInstallations.vendorOfferingId,
      label: vendorInstallations.label,
      connectionString: vendorInstallations.connectionString,
      status: vendorInstallations.status,
      createdAt: vendorInstallations.createdAt,
      updatedAt: vendorInstallations.updatedAt,
      slotCount: count(vendorInstallationSlots.id),
    })
    .from(vendorInstallations)
    .leftJoin(
      vendorInstallationSlots,
      eq(
        vendorInstallations.walletAddress,
        vendorInstallationSlots.installationWalletAddress
      )
    )
    .where(
      and(
        eq(vendorInstallations.vendorOfferingId, serviceId),
        ne(vendorInstallations.status, "Deleted")
      )
    )
    .groupBy(vendorInstallations.walletAddress);

  const data: VendorInstallation[] = results;
  return c.json(successResponse(data));
});

/** POST / - Create a new installation */
installations.post(
  "/",
  zValidator("json", vendorInstallationCreateSchema),
  async c => {
    const body = c.req.valid("json");
    const entitySlug = c.req.param("entitySlug");
    const userId = c.get("firebaseUid");

    // Verify device proof (data integrity + signature)
    // Allow 5 minutes for the user to fill the installation form after scanning
    if (!verifySignedData(body.deviceProof, 5 * 60 * 1000)) {
      return c.json(errorResponse("Device signing data mismatch"), 400);
    }

    if (!verifyResponseSignature(body.deviceProof.signing)) {
      return c.json(errorResponse("Invalid device signature"), 401);
    }

    // Verify walletAddress in data matches signing walletAddress
    if (
      body.deviceProof.data.walletAddress !==
      body.deviceProof.signing.walletAddress
    ) {
      return c.json(errorResponse("Wallet address mismatch"), 400);
    }

    const walletAddress = body.deviceProof.data.walletAddress;

    const result = await getEntityWithPermission(entitySlug, userId, true);
    if (result.error !== undefined) {
      return c.json(
        { ...errorResponse(result.error), errorCode: result.errorCode },
        getPermissionErrorStatus(result.errorCode)
      );
    }

    const db = getDb();
    const owned = await verifyOfferingOwnership(
      db,
      body.vendorOfferingId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Offering not found"), 404);
    }

    // Check for existing wallet address
    const [existing] = await db
      .select()
      .from(vendorInstallations)
      .where(eq(vendorInstallations.walletAddress, walletAddress))
      .limit(1);

    if (existing && existing.status !== "Deleted") {
      return c.json(
        errorResponse("Installation with this wallet address already exists"),
        409
      );
    }

    const installationData = {
      walletAddress,
      vendorOfferingId: body.vendorOfferingId,
      label: body.label,
      connectionString: body.connectionString ?? null,
    };

    let installation;
    if (existing) {
      // Reactivate soft-deleted installation
      const [reactivated] = await db
        .update(vendorInstallations)
        .set({
          ...installationData,
          status: "Active" as const,
          updatedAt: new Date(),
        })
        .where(eq(vendorInstallations.walletAddress, walletAddress))
        .returning();
      installation = reactivated;
    } else {
      const [created] = await db
        .insert(vendorInstallations)
        .values(installationData)
        .returning();
      installation = created;
    }

    // Auto-create slot for single-slot models
    const [offering] = await db
      .select({ modelSlot: vendorModels.slot })
      .from(vendorOfferings)
      .innerJoin(
        vendorModels,
        eq(vendorOfferings.vendorModelId, vendorModels.id)
      )
      .where(eq(vendorOfferings.id, body.vendorOfferingId))
      .limit(1);

    if (
      offering &&
      (offering.modelSlot === "single" || offering.modelSlot === null)
    ) {
      // Reactivate soft-deleted slot or create new one
      const [existingSlot] = await db
        .select()
        .from(vendorInstallationSlots)
        .where(
          and(
            eq(
              vendorInstallationSlots.installationWalletAddress,
              walletAddress
            ),
            eq(vendorInstallationSlots.label, body.label)
          )
        )
        .limit(1);

      if (existingSlot) {
        await db
          .update(vendorInstallationSlots)
          .set({ status: "Active" as const, updatedAt: new Date() })
          .where(eq(vendorInstallationSlots.id, existingSlot.id));
      } else {
        await db.insert(vendorInstallationSlots).values({
          installationWalletAddress: walletAddress,
          label: body.label,
          sortOrder: 0,
        });
      }
    }

    const data: VendorInstallation = installation;
    return c.json(successResponse(data), 201);
  }
);

/** PUT /:walletAddress - Update an installation */
installations.put(
  "/:walletAddress",
  zValidator("json", vendorInstallationUpdateSchema),
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

    // Get installation and verify ownership through offering -> location
    const [installation] = await db
      .select()
      .from(vendorInstallations)
      .where(eq(vendorInstallations.walletAddress, walletAddress))
      .limit(1);

    if (!installation) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    const owned = await verifyOfferingOwnership(
      db,
      installation.vendorOfferingId,
      result.entity.id
    );
    if (!owned) {
      return c.json(errorResponse("Installation not found"), 404);
    }

    // If changing vendorOfferingId, verify ownership of target offering too
    if (data.vendorOfferingId) {
      const targetOwned = await verifyOfferingOwnership(
        db,
        data.vendorOfferingId,
        result.entity.id
      );
      if (!targetOwned) {
        return c.json(errorResponse("Target offering not found"), 404);
      }
    }

    const [updatedRow] = await db
      .update(vendorInstallations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(vendorInstallations.walletAddress, walletAddress))
      .returning();

    const updated: VendorInstallation = updatedRow;
    return c.json(successResponse(updated));
  }
);

/** DELETE /:walletAddress - Delete an installation */
installations.delete("/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
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
  const [installation] = await db
    .select()
    .from(vendorInstallations)
    .where(eq(vendorInstallations.walletAddress, walletAddress))
    .limit(1);

  if (!installation) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  const owned = await verifyOfferingOwnership(
    db,
    installation.vendorOfferingId,
    result.entity.id
  );
  if (!owned) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  await db
    .update(vendorInstallations)
    .set({ status: "Deleted" as const, updatedAt: new Date() })
    .where(eq(vendorInstallations.walletAddress, walletAddress));
  const data: DeleteResult = { deleted: true };
  return c.json(successResponse(data));
});

export default installations;
