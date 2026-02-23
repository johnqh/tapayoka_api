import type { Context, Next } from "hono";
import type { UserRole } from "@sudobility/tapayoka_types";

/**
 * Role guard middleware factory.
 * Checks that the authenticated user has the required role.
 * Must be used after firebaseAuth middleware.
 */
export function roleGuard(...allowedRoles: UserRole[]) {
  return async (c: Context, next: Next) => {
    const userRole = c.get("userRole") as UserRole | undefined;

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
