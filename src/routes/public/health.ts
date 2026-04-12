import { Hono } from "hono";
import {
  successResponse,
  type HealthCheckData,
} from "@sudobility/tapayoka_types";
import pkg from "../../../package.json";

const health = new Hono();

health.get("/", c => {
  const data: HealthCheckData = {
    name: pkg.name,
    version: pkg.version,
    status: "healthy",
  };
  return c.json(successResponse(data));
});

export default health;
