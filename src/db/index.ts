import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";
import { getRequiredEnv } from "../lib/env-helper.ts";

// Lazy-initialized database connection
let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let sql: ReturnType<typeof postgres> | null = null;

function getConnection() {
  if (!sql) {
    const databaseUrl = getRequiredEnv("DATABASE_URL");
    sql = postgres(databaseUrl);
  }
  return sql;
}

/** Get the Drizzle database instance (lazy init) */
export function getDb() {
  if (!db) {
    db = drizzle(getConnection(), { schema });
  }
  return db;
}

/** Get raw SQL connection for migrations */
export function getSql() {
  return getConnection();
}

/** Initialize database: create schema and run migrations */
export async function initDatabase() {
  const connection = getConnection();

  // Create schema if not exists
  await connection`CREATE SCHEMA IF NOT EXISTS tapayoka`;

  // Create enums
  const enumDefs = [
    {
      name: "tapayoka.service_type",
      values: ["TRIGGER", "FIXED", "VARIABLE"],
    },
    {
      name: "tapayoka.order_status",
      values: ["CREATED", "PAID", "AUTHORIZED", "RUNNING", "DONE", "FAILED"],
    },
    {
      name: "tapayoka.device_status",
      values: ["ACTIVE", "OFFLINE", "MAINTENANCE", "DEACTIVATED"],
    },
    { name: "tapayoka.user_role", values: ["vendor", "buyer"] },
    {
      name: "tapayoka.log_direction",
      values: ["PI_TO_SRV", "SRV_TO_PI"],
    },
  ];

  for (const { name, values } of enumDefs) {
    const valuesStr = values.map(v => `'${v}'`).join(", ");
    await connection.unsafe(
      `DO $$ BEGIN CREATE TYPE ${name} AS ENUM (${valuesStr}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
    );
  }

  // Create tables
  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      firebase_uid VARCHAR(128) NOT NULL UNIQUE,
      email VARCHAR(255),
      display_name VARCHAR(255),
      role tapayoka.user_role NOT NULL DEFAULT 'buyer',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.devices (
      wallet_address VARCHAR(42) PRIMARY KEY NOT NULL,
      entity_id VARCHAR(255) NOT NULL,
      label VARCHAR(255) NOT NULL,
      model VARCHAR(255),
      location VARCHAR(255),
      gpio_config JSONB,
      status tapayoka.device_status NOT NULL DEFAULT 'ACTIVE',
      server_wallet_address VARCHAR(42),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      type tapayoka.service_type NOT NULL,
      price_cents INTEGER NOT NULL,
      fixed_minutes INTEGER,
      minutes_per_25c INTEGER,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.device_services (
      device_wallet_address VARCHAR(42) NOT NULL REFERENCES tapayoka.devices(wallet_address) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES tapayoka.services(id) ON DELETE CASCADE,
      UNIQUE(device_wallet_address, service_id)
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_wallet_address VARCHAR(42) NOT NULL REFERENCES tapayoka.devices(wallet_address),
      service_id UUID NOT NULL REFERENCES tapayoka.services(id),
      buyer_uid VARCHAR(128),
      amount_cents INTEGER NOT NULL,
      authorized_seconds INTEGER NOT NULL DEFAULT 0,
      status tapayoka.order_status NOT NULL DEFAULT 'CREATED',
      stripe_payment_intent_id VARCHAR(255),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.authorizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL UNIQUE REFERENCES tapayoka.orders(id) ON DELETE CASCADE,
      payload_json TEXT NOT NULL,
      server_signature TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.device_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_wallet_address VARCHAR(42) NOT NULL REFERENCES tapayoka.devices(wallet_address),
      direction tapayoka.log_direction NOT NULL,
      ok BOOLEAN NOT NULL DEFAULT true,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.admin_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR(128) NOT NULL,
      action VARCHAR(255) NOT NULL,
      entity_type VARCHAR(100),
      entity_id VARCHAR(255),
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // --- Vendor Management Tables ---
  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      firebase_user_id VARCHAR(128) NOT NULL,
      name VARCHAR(255) NOT NULL,
      address VARCHAR(255) NOT NULL,
      city VARCHAR(255) NOT NULL,
      state_province VARCHAR(255) NOT NULL,
      zipcode VARCHAR(20) NOT NULL,
      country VARCHAR(100) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_equipment_categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      firebase_user_id VARCHAR(128) NOT NULL,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_services (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_location_id UUID NOT NULL REFERENCES tapayoka.vendor_locations(id),
      vendor_equipment_category_id UUID NOT NULL REFERENCES tapayoka.vendor_equipment_categories(id),
      name VARCHAR(255) NOT NULL,
      price NUMERIC(10,2) NOT NULL,
      currency_code VARCHAR(3) NOT NULL DEFAULT 'USD',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(vendor_location_id, vendor_equipment_category_id)
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_service_controls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_service_id UUID NOT NULL REFERENCES tapayoka.vendor_services(id) ON DELETE CASCADE,
      pin_number INTEGER NOT NULL,
      duration INTEGER NOT NULL
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_equipments (
      wallet_address VARCHAR(42) PRIMARY KEY NOT NULL,
      vendor_service_id UUID NOT NULL REFERENCES tapayoka.vendor_services(id),
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Create indexes
  await connection`CREATE INDEX IF NOT EXISTS devices_entity_idx ON tapayoka.devices(entity_id)`;
  await connection`CREATE INDEX IF NOT EXISTS services_entity_idx ON tapayoka.services(entity_id)`;
  await connection`CREATE INDEX IF NOT EXISTS orders_device_idx ON tapayoka.orders(device_wallet_address)`;
  await connection`CREATE INDEX IF NOT EXISTS orders_status_idx ON tapayoka.orders(status)`;
  await connection`CREATE INDEX IF NOT EXISTS authorizations_order_idx ON tapayoka.authorizations(order_id)`;
  await connection`CREATE INDEX IF NOT EXISTS device_logs_device_idx ON tapayoka.device_logs(device_wallet_address)`;
  await connection`CREATE INDEX IF NOT EXISTS admin_logs_user_idx ON tapayoka.admin_logs(user_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_locations_firebase_user_idx ON tapayoka.vendor_locations(firebase_user_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_equipment_categories_firebase_user_idx ON tapayoka.vendor_equipment_categories(firebase_user_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_services_location_idx ON tapayoka.vendor_services(vendor_location_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_services_category_idx ON tapayoka.vendor_services(vendor_equipment_category_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_service_controls_service_idx ON tapayoka.vendor_service_controls(vendor_service_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_equipments_service_idx ON tapayoka.vendor_equipments(vendor_service_id)`;

  console.log("Database initialized successfully");
}
