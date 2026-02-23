import { Hono } from "hono";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { orders, devices, services } from "../../db/schema.ts";
import { uuidSchema } from "../../schemas/index.ts";
import {
  successResponse,
  errorResponse,
} from "@sudobility/tapayoka_types";

const vendorOrders = new Hono();

/**
 * GET / - List recent orders for vendor's entity
 */
vendorOrders.get("/", async c => {
  const limit = parseInt(c.req.query("limit") ?? "50");
  const status = c.req.query("status");

  const db = getDb();

  let query = db
    .select({
      order: orders,
      deviceLabel: devices.label,
      serviceName: services.name,
      serviceType: services.type,
    })
    .from(orders)
    .innerJoin(devices, eq(orders.deviceWalletAddress, devices.walletAddress))
    .innerJoin(services, eq(orders.serviceId, services.id))
    .orderBy(desc(orders.createdAt))
    .limit(limit);

  // TODO: add status filter when needed

  const results = await query;

  const detailed = results.map(r => ({
    ...r.order,
    deviceLabel: r.deviceLabel,
    serviceName: r.serviceName,
    serviceType: r.serviceType,
  }));

  return c.json(successResponse(detailed));
});

/**
 * GET /stats - Dashboard statistics
 */
vendorOrders.get("/stats", async c => {
  const db = getDb();

  // Get counts
  const [deviceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(devices);

  const [activeDeviceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(devices)
    .where(eq(devices.status, "ACTIVE"));

  const [orderCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders);

  const [activeOrderCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "RUNNING"));

  // Revenue today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [revenueToday] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount_cents), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.status, "DONE"),
        gte(orders.createdAt, today)
      )
    );

  // Revenue this week
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [revenueWeek] = await db
    .select({ total: sql<number>`COALESCE(SUM(amount_cents), 0)` })
    .from(orders)
    .where(
      and(
        eq(orders.status, "DONE"),
        gte(orders.createdAt, weekAgo)
      )
    );

  // Success rate
  const [doneCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "DONE"));

  const [failedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "FAILED"));

  const total =
    Number(doneCount?.count ?? 0) + Number(failedCount?.count ?? 0);
  const successRate =
    total > 0 ? Number(doneCount?.count ?? 0) / total : 1;

  return c.json(
    successResponse({
      totalDevices: Number(deviceCount?.count ?? 0),
      activeDevices: Number(activeDeviceCount?.count ?? 0),
      totalOrders: Number(orderCount?.count ?? 0),
      activeOrders: Number(activeOrderCount?.count ?? 0),
      revenueTodayCents: Number(revenueToday?.total ?? 0),
      revenueThisWeekCents: Number(revenueWeek?.total ?? 0),
      successRate: Math.round(successRate * 100) / 100,
    })
  );
});

export default vendorOrders;
