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
import telemetry from "./buyer/telemetry.ts";

// Vendor routes
import vendorDevices from "./vendor/devices.ts";
import vendorServices from "./vendor/services.ts";
import vendorOrders from "./vendor/orders.ts";
import vendorEntities from "./vendor/entities.ts";
import vendorQr from "./vendor/qr.ts";

const routes = new Hono();

// --- Public routes (no auth) ---
routes.route("/health", health);

// --- Buyer routes (Firebase auth, buyer role) ---
const buyerRoutes = new Hono<AppEnv>();
buyerRoutes.use("*", firebaseAuth);
buyerRoutes.route("/devices", buyerDevices);
buyerRoutes.route("/orders", buyerOrders);
buyerRoutes.route("/authorizations", buyerAuthorizations);
buyerRoutes.route("/telemetry", telemetry);
routes.route("/buyer", buyerRoutes);

// --- Vendor routes (Firebase auth, vendor role) ---
const vendorRoutes = new Hono<AppEnv>();
vendorRoutes.use("*", firebaseAuth);
vendorRoutes.use("*", roleGuard("vendor"));
vendorRoutes.route("/devices", vendorDevices);
vendorRoutes.route("/services", vendorServices);
vendorRoutes.route("/orders", vendorOrders);
vendorRoutes.route("/entities", vendorEntities);
vendorRoutes.route("/qr", vendorQr);
routes.route("/vendor", vendorRoutes);

export default routes;
