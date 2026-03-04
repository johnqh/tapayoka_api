import { Hono } from "hono";
import { entityHelpers as helpers } from "../lib/entity-helpers.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";
import type { AppEnv } from "../lib/hono-types.ts";

const invitationsRouter = new Hono<AppEnv>();

/** GET /invitations/mine - List user's pending invitations */
invitationsRouter.get("/mine", async c => {
  const userEmail = c.get("userEmail");

  if (!userEmail) {
    return c.json(successResponse([]));
  }

  try {
    const invitations = await helpers.invitations.getUserPendingInvitations(userEmail);
    return c.json(successResponse(invitations));
  } catch (error: any) {
    console.error("Error listing user invitations:", error);
    return c.json(errorResponse(error.message || "Internal server error"), 500);
  }
});

/** POST /invitations/:token/accept - Accept invitation */
invitationsRouter.post("/:token/accept", async c => {
  const token = c.req.param("token");
  const userId = c.get("firebaseUid");

  try {
    const result = await helpers.invitations.acceptInvitation(token, userId);
    return c.json(successResponse(result));
  } catch (error: any) {
    console.error("Error accepting invitation:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

/** POST /invitations/:token/decline - Decline invitation */
invitationsRouter.post("/:token/decline", async c => {
  const token = c.req.param("token");

  try {
    const result = await helpers.invitations.declineInvitation(token);
    return c.json(successResponse(result));
  } catch (error: any) {
    console.error("Error declining invitation:", error);
    return c.json(errorResponse(error.message || "Bad request"), 400);
  }
});

export default invitationsRouter;
