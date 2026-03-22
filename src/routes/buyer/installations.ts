import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import {
  vendorInstallations,
  vendorOfferings,
  vendorModels,
} from "../../db/schema.ts";
import { successResponse, errorResponse, type DailySchedule, type DayOfWeek } from "@sudobility/tapayoka_types";

const buyerInstallations = new Hono();

function isOperating(schedule: DailySchedule[] | null, tz: string): boolean {
  if (!schedule || schedule.length === 0) return true;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find(p => p.type === "weekday")?.value as DayOfWeek | undefined;
  const hour = parts.find(p => p.type === "hour")?.value ?? "00";
  const minute = parts.find(p => p.type === "minute")?.value ?? "00";
  const currentTime = `${hour}:${minute}`;

  if (!weekday) return true;

  return schedule.some(
    entry => entry.dayOfWeek === weekday && currentTime >= entry.startTime && currentTime <= entry.endTime
  );
}

/**
 * GET /:walletAddress?tz=America/New_York - Get installation info for buyer
 */
buyerInstallations.get("/:walletAddress", async c => {
  const walletAddress = c.req.param("walletAddress");
  const tz = c.req.query("tz") || "UTC";
  const db = getDb();

  const [result] = await db
    .select({
      label: vendorInstallations.label,
      modelType: vendorModels.type,
      schedule: vendorOfferings.schedule,
    })
    .from(vendorInstallations)
    .innerJoin(vendorOfferings, eq(vendorInstallations.vendorOfferingId, vendorOfferings.id))
    .innerJoin(vendorModels, eq(vendorOfferings.vendorModelId, vendorModels.id))
    .where(eq(vendorInstallations.walletAddress, walletAddress))
    .limit(1);

  if (!result) {
    return c.json(errorResponse("Installation not found"), 404);
  }

  const schedule = result.schedule as DailySchedule[] | null;
  const operating = isOperating(schedule, tz);

  return c.json(
    successResponse({
      label: result.label,
      modelType: result.modelType,
      operating,
    })
  );
});

export default buyerInstallations;
