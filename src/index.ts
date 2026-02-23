/**
 * @fileoverview Tapayoka API entry point
 * @description Hono app setup with CORS, logging, health check, and route mounting.
 * Initializes the database on startup and exports the Bun server configuration.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { initDatabase } from "./db/index.ts";
import routes from "./routes/index.ts";
import { successResponse } from "@sudobility/tapayoka_types";
import { getEnv } from "./lib/env-helper.ts";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());

// Health check
app.get("/", c => {
  return c.json(
    successResponse({
      name: "Tapayoka API",
      version: "0.0.1",
      status: "healthy",
    })
  );
});

// Health endpoint (public, no auth)
app.get("/health", c => {
  return c.json(
    successResponse({
      status: "healthy",
    })
  );
});

// API routes
app.route("/api/v1", routes);

// Initialize database and start server
const port = parseInt(getEnv("PORT", "3000")!);

initDatabase()
  .then(() => {
    console.log(`Tapayoka API running on http://localhost:${port}`);
  })
  .catch(err => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });

export default {
  port,
  fetch: app.fetch,
};

// Export app for testing
export { app };
