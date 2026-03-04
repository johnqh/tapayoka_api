import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { successResponse, errorResponse } from "@sudobility/tapayoka_types";
import type { AppEnv } from "../lib/hono-types.ts";

const meRouter = new Hono<AppEnv>();

/** GET /me - Get current user profile (including tosAcceptedAt) */
meRouter.get("/", async c => {
  const firebaseUid = c.get("firebaseUid");
  const db = getDb();

  const [user] = await db
    .select({
      id: users.id,
      firebaseUid: users.firebaseUid,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      tosAcceptedAt: users.tosAcceptedAt,
    })
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  if (!user) {
    return c.json(errorResponse("User not found"), 404);
  }

  return c.json(
    successResponse({
      ...user,
      tosAcceptedAt: user.tosAcceptedAt?.toISOString() ?? null,
    })
  );
});

export default meRouter;
