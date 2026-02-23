import type { Context, Next } from "hono";
import type { UserRole } from "@sudobility/tapayoka_types";
import type { AppEnv } from "../lib/hono-types.ts";

/**
 * Role guard middleware factory.
 * Checks that the authenticated user has the required role.
 * Must be used after firebaseAuth middleware.
 */
export function roleGuard(...allowedRoles: UserRole[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const userRole = c.get("userRole");

    if (!userRole || !allowedRoles.includes(userRole)) {
      return c.json(
        {
          success: false,
          error: `Access denied. Required role: ${allowedRoles.join(" or ")}`,
        },
        403
      );
    }

    await next();
  };
}
