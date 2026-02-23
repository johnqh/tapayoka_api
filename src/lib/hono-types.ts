import type { UserRole } from "@sudobility/tapayoka_types";

/** Context variables set by firebaseAuth middleware */
export type AppVariables = {
  firebaseUid: string;
  userId: string;
  userEmail: string | null;
  userRole: UserRole;
};

/** Hono env type for authenticated routes */
export type AppEnv = {
  Variables: AppVariables;
};
