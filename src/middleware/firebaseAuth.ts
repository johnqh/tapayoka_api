import type { Context, Next } from "hono";
import { getFirebaseAdmin } from "../services/firebase.ts";
import { getDb } from "../db/index.ts";
import { users } from "../db/schema.ts";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../lib/hono-types.ts";

/**
 * Firebase authentication middleware.
 * Verifies Firebase ID token from Authorization header.
 * Sets context variables: firebaseUid, userId, userEmail, userRole.
 */
export async function firebaseAuth(c: Context<AppEnv>, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Missing authorization token" }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const admin = getFirebaseAdmin();
    const decoded = await admin.auth().verifyIdToken(token);

    if (!decoded.uid) {
      return c.json({ success: false, error: "Invalid token" }, 401);
    }

    // Ensure user exists in database
    const db = getDb();
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, decoded.uid))
      .limit(1);

    if (!user) {
      // Auto-create user record
      [user] = await db
        .insert(users)
        .values({
          firebaseUid: decoded.uid,
          email: decoded.email ?? null,
          displayName: decoded.name ?? null,
        })
        .returning();
    }

    // Set context variables
    c.set("firebaseUid", decoded.uid);
    c.set("userId", user!.id);
    c.set("userEmail", user!.email);
    c.set("userRole", user!.role);

    await next();
  } catch (error) {
    console.error("Firebase auth error:", error);
    return c.json({ success: false, error: "Invalid or expired token" }, 401);
  }
}
