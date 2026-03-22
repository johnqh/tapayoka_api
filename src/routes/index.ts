import { Hono } from "hono";
import { firebaseAuth } from "../middleware/firebaseAuth.ts";
import { roleGuard } from "../middleware/roleGuard.ts";
import type { AppEnv } from "../lib/hono-types.ts";

// Public routes
import health from "./public/health.ts";

// Buyer routes
import buyerDevices from "./buyer/devices.ts";
import buyerOrders from "./buyer/orders.ts";
import buyerAuthorizations from "./buyer/authorizations.ts";
import buyerSlots from "./buyer/slots.ts";
import buyerInstallations from "./buyer/installations.ts";
import telemetry from "./buyer/telemetry.ts";

// Entity/vendor routes
import entitiesRouter from "./entities.ts";
import invitationsRouter from "./invitations.ts";
import meRouter from "./me.ts";
import vendorDevices from "./vendor/devices.ts";
import vendorOfferingsLegacy from "./vendor/offerings-legacy.ts";
import vendorOrders from "./vendor/orders.ts";
import vendorQr from "./vendor/qr.ts";
import vendorLocations from "./vendor/locations.ts";
import vendorModels from "./vendor/models.ts";
import vendorOfferings from "./vendor/vendorOfferings.ts";
import vendorInstallations from "./vendor/installations.ts";
import vendorInstallationSlots from "./vendor/installationSlots.ts";

const routes = new Hono();

// --- Public routes (no auth) ---
routes.route("/health", health);

// --- Buyer routes (Firebase auth, buyer role) ---
const buyerRoutes = new Hono<AppEnv>();
buyerRoutes.use("*", firebaseAuth);
buyerRoutes.route("/devices", buyerDevices);
buyerRoutes.route("/orders", buyerOrders);
buyerRoutes.route("/authorizations", buyerAuthorizations);
buyerRoutes.route("/slots", buyerSlots);
buyerRoutes.route("/installations", buyerInstallations);
buyerRoutes.route("/telemetry", telemetry);
routes.route("/buyer", buyerRoutes);

// --- Authenticated routes (Firebase auth required) ---
const authRoutes = new Hono<AppEnv>();
authRoutes.use("*", firebaseAuth);

// User profile
authRoutes.route("/me", meRouter);

// Entity management (any authenticated user)
authRoutes.route("/entities", entitiesRouter);

// Invitation management (any authenticated user)
authRoutes.route("/invitations", invitationsRouter);

// Entity-scoped vendor routes (require vendor role)
const vendorEntityRoutes = new Hono<AppEnv>();
vendorEntityRoutes.use("*", roleGuard("vendor"));
vendorEntityRoutes.route("/locations", vendorLocations);
vendorEntityRoutes.route("/models", vendorModels);
vendorEntityRoutes.route("/offerings", vendorOfferings);
vendorEntityRoutes.route("/installations", vendorInstallations);
vendorEntityRoutes.route("/installation-slots", vendorInstallationSlots);
vendorEntityRoutes.route("/devices", vendorDevices);
vendorEntityRoutes.route("/services", vendorOfferingsLegacy);
vendorEntityRoutes.route("/orders", vendorOrders);
vendorEntityRoutes.route("/qr", vendorQr);

authRoutes.route("/entities/:entitySlug", vendorEntityRoutes);

routes.route("/", authRoutes);

export default routes;
