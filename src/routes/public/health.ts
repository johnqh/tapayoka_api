import { Hono } from "hono";
import { successResponse } from "@sudobility/tapayoka_types";

const health = new Hono();

health.get("/", c => {
  return c.json(
    successResponse({
      status: "healthy",
    })
  );
});

export default health;
