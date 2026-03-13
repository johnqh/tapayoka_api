import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import { users } from "../db/schema.ts";
import {
  entityHelpers as helpers,
  getEntityWithPermission,
  getPermissionErrorStatus,
} from "../lib/entity-helpers.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";
import type { AppEnv } from "../lib/hono-types.ts";

// =============================================================================
// Entity CRUD Routes
// =============================================================================

const entitiesRouter = new Hono<AppEnv>();

/** GET /entities - List all entities for the current user */
entitiesRouter.get("/", async c => {
  const userId = c.get("firebaseUid");
  const userEmail = c.get("userEmail");

  try {
    const userEntities = await helpers.entity.getUserEntities(
      userId,
      userEmail ?? undefined
    );
    return c.json(successResponse(userEntities));
  } catch (error: any) {
    console.error("Error listing entities:", error);
    return c.json(errorResponse(error.message || "Internal server error"), 500);
  }
});

/** POST /entities - Create organization entity (+ set tosAcceptedAt) */
entitiesRouter.post("/", async c => {
  const userId = c.get("firebaseUid");
  const body = await c.req.json();

  const { displayName, acceptTos } = body;

  if (acceptTos !== true) {
    return c.json(errorResponse("acceptTos must be true"), 400);
  }

  try {
    const db = getDb();

    // Set tosAcceptedAt and grant vendor role
    await db
      .update(users)
      .set({ tosAcceptedAt: new Date(), role: "vendor", updatedAt: new Date() })
      .where(eq(users.firebaseUid, userId));

    // Auto-generate displayName from user if not provided
    let entityDisplayName = displayName;
    if (!entityDisplayName) {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.firebaseUid, userId))
        .limit(1);
      entityDisplayName =
        user?.displayName || user?.email?.split("@")[0] || "My Organization";
    }

    let entity;
    try {
      entity = await helpers.entity.createOrganizationEntity(userId, {
        displayName: entityDisplayName,
      });
    } catch {
      // Entity may already exist (e.g. user accepted buyer TOS first)
      const existing = await helpers.entity.getUserEntities(userId);
      if (existing.length > 0) {
        return c.json(successResponse(existing[0]), 200);
      }
      throw new Error("Failed to create entity");
    }
    return c.json(successResponse(entity), 201);
  } catch (error: any) {
    console.error("Error creating entity:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

/** GET /entities/:entitySlug - Get entity by slug */
entitiesRouter.get("/:entitySlug", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const isMember = await helpers.members.isMember(entity.id, userId);
    if (!isMember) {
      return c.json(errorResponse("Access denied"), 403);
    }

    const role = await helpers.members.getUserRole(entity.id, userId);
    return c.json(successResponse({ ...entity, userRole: role }));
  } catch (error: any) {
    console.error("Error getting entity:", error);
    return c.json(errorResponse(error.message || "Internal server error"), 500);
  }
});

/** PUT /entities/:entitySlug - Update entity */
entitiesRouter.put("/:entitySlug", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");
  const body = await c.req.json();

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canEdit = await helpers.permissions.canEditEntity(entity.id, userId);
    if (!canEdit) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    const updated = await helpers.entity.updateEntity(entity.id, body);
    return c.json(successResponse(updated));
  } catch (error: any) {
    console.error("Error updating entity:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

/** DELETE /entities/:entitySlug - Delete entity (owner only) */
entitiesRouter.delete("/:entitySlug", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canDelete = await helpers.permissions.canDeleteEntity(
      entity.id,
      userId
    );
    if (!canDelete) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    await helpers.entity.deleteEntity(entity.id);
    return c.json(successResponse(null));
  } catch (error: any) {
    console.error("Error deleting entity:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

// =============================================================================
// Member Routes
// =============================================================================

/** GET /entities/:entitySlug/members - List members */
entitiesRouter.get("/:entitySlug/members", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");

  try {
    const result = await getEntityWithPermission(entitySlug, userId);
    if (result.error !== undefined) {
      return c.json(
        { ...errorResponse(result.error), errorCode: result.errorCode },
        getPermissionErrorStatus(result.errorCode)
      );
    }

    const members = await helpers.members.getMembers(result.entity.id);
    return c.json(successResponse(members));
  } catch (error: any) {
    console.error("Error listing members:", error);
    return c.json(errorResponse(error.message || "Internal server error"), 500);
  }
});

/** PUT /entities/:entitySlug/members/:memberId - Update member role */
entitiesRouter.put("/:entitySlug/members/:memberId", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");
  const memberId = c.req.param("memberId");
  const body = await c.req.json();

  const { role } = body;
  if (!role) {
    return c.json(errorResponse("role is required"), 400);
  }

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canManage = await helpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    const updated = await helpers.members.updateMemberRole(
      entity.id,
      memberId,
      role
    );
    return c.json(successResponse(updated));
  } catch (error: any) {
    console.error("Error updating member role:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

/** DELETE /entities/:entitySlug/members/:memberId - Remove member */
entitiesRouter.delete("/:entitySlug/members/:memberId", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");
  const memberId = c.req.param("memberId");

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canManage = await helpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    await helpers.members.removeMember(entity.id, memberId);
    return c.json(successResponse(null));
  } catch (error: any) {
    console.error("Error removing member:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

// =============================================================================
// Invitation Routes
// =============================================================================

/** GET /entities/:entitySlug/invitations - List pending invitations */
entitiesRouter.get("/:entitySlug/invitations", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canManage = await helpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    const invitations = await helpers.invitations.getEntityInvitations(
      entity.id
    );
    return c.json(successResponse(invitations));
  } catch (error: any) {
    console.error("Error listing invitations:", error);
    return c.json(errorResponse(error.message || "Internal server error"), 500);
  }
});

/** POST /entities/:entitySlug/invitations - Create invitation */
entitiesRouter.post("/:entitySlug/invitations", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");
  const body = await c.req.json();

  const { email, role } = body;
  if (!email || !role) {
    return c.json(errorResponse("email and role are required"), 400);
  }

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canInvite = await helpers.permissions.canInviteMembers(
      entity.id,
      userId
    );
    if (!canInvite) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    const invitation = await helpers.invitations.createInvitation(
      entity.id,
      userId,
      { email, role }
    );

    return c.json(successResponse(invitation), 201);
  } catch (error: any) {
    console.error("Error creating invitation:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

/** PUT /entities/:entitySlug/invitations/:invitationId - Renew invitation */
entitiesRouter.put("/:entitySlug/invitations/:invitationId", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");
  const invitationId = c.req.param("invitationId");

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canManage = await helpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    const renewed = await helpers.invitations.renewInvitation(invitationId);
    return c.json(successResponse(renewed));
  } catch (error: any) {
    console.error("Error renewing invitation:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

/** DELETE /entities/:entitySlug/invitations/:invitationId - Cancel invitation */
entitiesRouter.delete("/:entitySlug/invitations/:invitationId", async c => {
  const userId = c.get("firebaseUid");
  const entitySlug = c.req.param("entitySlug");
  const invitationId = c.req.param("invitationId");

  try {
    const entity = await helpers.entity.getEntityBySlug(entitySlug);
    if (!entity) {
      return c.json(errorResponse("Entity not found"), 404);
    }

    const canManage = await helpers.permissions.canManageMembers(
      entity.id,
      userId
    );
    if (!canManage) {
      return c.json(errorResponse("Insufficient permissions"), 403);
    }

    await helpers.invitations.cancelInvitation(invitationId);
    return c.json(successResponse(null));
  } catch (error: any) {
    console.error("Error canceling invitation:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

export default entitiesRouter;
