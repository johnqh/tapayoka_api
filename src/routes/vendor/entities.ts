import { Hono } from "hono";
import { successResponse } from "@sudobility/tapayoka_types";

const vendorEntities = new Hono();

/**
 * GET / - Get vendor's entity info
 * TODO: Integrate with @sudobility/entity_service
 */
vendorEntities.get("/", async c => {
  return c.json(
    successResponse({
      message: "Entity management - to be integrated with @sudobility/entity_service",
    })
  );
});

export default vendorEntities;
