import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";
import { getRequiredEnv } from "../lib/env-helper.ts";
import { runEntityMigration } from "@sudobility/entity_service";

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
      name: "tapayoka.offering_type",
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
    {
      name: "tapayoka.vendor_model_type",
      values: ["Washer", "Dryer", "Parking", "Locker", "Vending"],
    },
  ];

  for (const { name, values } of enumDefs) {
    const valuesStr = values.map(v => `'${v}'`).join(", ");
    await connection.unsafe(
      `DO $$ BEGIN CREATE TYPE ${name} AS ENUM (${valuesStr}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
    );
  }

  // Create users table
  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      firebase_uid VARCHAR(128) NOT NULL UNIQUE,
      email VARCHAR(255),
      display_name VARCHAR(255),
      role tapayoka.user_role NOT NULL DEFAULT 'buyer',
      tos_accepted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // Add tos_accepted_at column if it doesn't exist (migration for existing DBs)
  await connection`
    ALTER TABLE tapayoka.users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMP
  `;

  // Run entity_service migrations (creates entities, entity_members, entity_invitations tables)
  await runEntityMigration({
    client: connection,
    schemaName: "tapayoka",
    indexPrefix: "tapayoka",
    migrateProjects: false,
    migrateUsers: false,
  });

  // Create legacy tables (devices, offerings use entity_id FK)
  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.devices (
      wallet_address VARCHAR(42) PRIMARY KEY NOT NULL,
      entity_id UUID NOT NULL REFERENCES tapayoka.entities(id) ON DELETE CASCADE,
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
    CREATE TABLE IF NOT EXISTS tapayoka.offerings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id UUID NOT NULL REFERENCES tapayoka.entities(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      type tapayoka.offering_type NOT NULL,
      price_cents INTEGER NOT NULL,
      fixed_minutes INTEGER,
      minutes_per_25c INTEGER,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.device_offerings (
      device_wallet_address VARCHAR(42) NOT NULL REFERENCES tapayoka.devices(wallet_address) ON DELETE CASCADE,
      offering_id UUID NOT NULL REFERENCES tapayoka.offerings(id) ON DELETE CASCADE,
      UNIQUE(device_wallet_address, offering_id)
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_wallet_address VARCHAR(42) NOT NULL REFERENCES tapayoka.devices(wallet_address),
      offering_id UUID NOT NULL REFERENCES tapayoka.offerings(id),
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

  // --- Vendor Management Tables (entity-scoped) ---
  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_locations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id UUID NOT NULL REFERENCES tapayoka.entities(id) ON DELETE CASCADE,
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
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_models (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id UUID NOT NULL REFERENCES tapayoka.entities(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      type tapayoka.vendor_model_type,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_offerings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_location_id UUID NOT NULL REFERENCES tapayoka.vendor_locations(id),
      vendor_model_id UUID NOT NULL REFERENCES tapayoka.vendor_models(id),
      name VARCHAR(255) NOT NULL,
      pricing JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(vendor_location_id, vendor_model_id)
    )
  `;

  await connection`
    CREATE TABLE IF NOT EXISTS tapayoka.vendor_installations (
      wallet_address VARCHAR(42) PRIMARY KEY NOT NULL,
      vendor_offering_id UUID NOT NULL REFERENCES tapayoka.vendor_offerings(id),
      label VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;

  // --- Migrations for existing databases ---
  // Rename enums
  await connection.unsafe(`
    DO $$ BEGIN ALTER TYPE tapayoka.service_type RENAME TO offering_type; EXCEPTION WHEN undefined_object OR duplicate_object THEN NULL; END $$;
  `);

  // Rename legacy tables
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE IF EXISTS tapayoka.services RENAME TO offerings; EXCEPTION WHEN duplicate_table THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE IF EXISTS tapayoka.device_services RENAME TO device_offerings; EXCEPTION WHEN duplicate_table THEN NULL; END $$;
  `);

  // Rename legacy columns
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.device_offerings RENAME COLUMN service_id TO offering_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.orders RENAME COLUMN service_id TO offering_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);

  // Rename vendor tables
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE IF EXISTS tapayoka.vendor_equipment_categories RENAME TO vendor_models; EXCEPTION WHEN duplicate_table THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE IF EXISTS tapayoka.vendor_services RENAME TO vendor_offerings; EXCEPTION WHEN duplicate_table THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE IF EXISTS tapayoka.vendor_service_controls RENAME TO vendor_offering_controls; EXCEPTION WHEN duplicate_table THEN NULL; END $$;
  `);

  // Rename vendor_equipments → vendor_installations
  // Drop stale vendor_installations if it has the wrong schema (leftover from previous renames)
  await connection.unsafe(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'tapayoka' AND table_name = 'vendor_installations' AND column_name = 'id')
         AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'tapayoka' AND table_name = 'vendor_equipments') THEN
        DROP TABLE tapayoka.vendor_installations CASCADE;
      END IF;
    END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE IF EXISTS tapayoka.vendor_equipments RENAME TO vendor_installations; EXCEPTION WHEN duplicate_table THEN NULL; END $$;
  `);

  // Add type column to vendor_models (nullable)
  await connection`ALTER TABLE tapayoka.vendor_models ADD COLUMN IF NOT EXISTS type tapayoka.vendor_model_type`;

  // Add enums and columns to vendor_models
  // Recreate pricing enum if it has old values (variableAtStart/variableAtEnd → variable)
  await connection.unsafe(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'variableAtStart' AND enumtypid = 'tapayoka.vendor_model_pricing'::regtype) THEN
        ALTER TABLE tapayoka.vendor_models DROP COLUMN IF EXISTS pricing;
        DROP TYPE tapayoka.vendor_model_pricing;
      END IF;
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN CREATE TYPE tapayoka.vendor_model_pricing AS ENUM ('fixed', 'variable'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN CREATE TYPE tapayoka.vendor_model_action AS ENUM ('timed', 'sequence'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN CREATE TYPE tapayoka.vendor_model_interruption AS ENUM ('stop', 'continue'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN CREATE TYPE tapayoka.vendor_model_payment AS ENUM ('atStart', 'atEnd'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await connection`ALTER TABLE tapayoka.vendor_models ADD COLUMN IF NOT EXISTS pricing tapayoka.vendor_model_pricing`;
  await connection`ALTER TABLE tapayoka.vendor_models ADD COLUMN IF NOT EXISTS action tapayoka.vendor_model_action`;
  await connection`ALTER TABLE tapayoka.vendor_models ADD COLUMN IF NOT EXISTS interruption tapayoka.vendor_model_interruption`;
  await connection`ALTER TABLE tapayoka.vendor_models ADD COLUMN IF NOT EXISTS payment tapayoka.vendor_model_payment`;
  await connection`ALTER TABLE tapayoka.vendor_models ADD COLUMN IF NOT EXISTS schedule JSONB`;

  // Rename vendor columns
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.vendor_offerings RENAME COLUMN vendor_equipment_category_id TO vendor_model_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.vendor_offering_controls RENAME COLUMN vendor_service_id TO vendor_offering_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.vendor_installations RENAME COLUMN vendor_service_id TO vendor_offering_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);
  // Rename installation columns to offering columns (installation→offering rename)
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.vendor_installations RENAME COLUMN vendor_installation_id TO vendor_offering_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);
  // Rename equipment columns to offering columns (equipment→installation rename)
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.vendor_installations RENAME COLUMN vendor_equipment_id TO vendor_offering_id; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);

  // Rename vendor_installations.name → label
  await connection.unsafe(`
    DO $$ BEGIN ALTER TABLE tapayoka.vendor_installations RENAME COLUMN name TO label; EXCEPTION WHEN undefined_column THEN NULL; END $$;
  `);

  // Add slot enum + column to vendor_models
  await connection.unsafe(`
    DO $$ BEGIN CREATE TYPE tapayoka.vendor_model_slot AS ENUM ('single', 'multi'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
  await connection`ALTER TABLE tapayoka.vendor_models ADD COLUMN IF NOT EXISTS slot tapayoka.vendor_model_slot`;

  // Migrate vendor_offerings: add pricing JSONB, migrate existing data, drop old columns
  await connection.unsafe(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'tapayoka' AND table_name = 'vendor_offerings' AND column_name = 'price') THEN
        ALTER TABLE tapayoka.vendor_offerings ADD COLUMN IF NOT EXISTS pricing JSONB;
        UPDATE tapayoka.vendor_offerings vi SET pricing = jsonb_build_object(
          'type', 'fixed',
          'currencyCode', vi.currency_code,
          'price', vi.price::text,
          'signals', COALESCE(
            (SELECT jsonb_agg(jsonb_build_object('pinNumber', vic.pin_number, 'duration', vic.duration))
             FROM tapayoka.vendor_offering_controls vic WHERE vic.vendor_offering_id = vi.id),
            '[]'::jsonb
          )
        ) WHERE vi.pricing IS NULL;
        ALTER TABLE tapayoka.vendor_offerings ALTER COLUMN pricing SET NOT NULL;
        ALTER TABLE tapayoka.vendor_offerings DROP COLUMN IF EXISTS price;
        ALTER TABLE tapayoka.vendor_offerings DROP COLUMN IF EXISTS currency_code;
      END IF;
    END $$;
  `);

  // Create indexes
  await connection`CREATE INDEX IF NOT EXISTS devices_entity_idx ON tapayoka.devices(entity_id)`;
  await connection`CREATE INDEX IF NOT EXISTS offerings_entity_idx ON tapayoka.offerings(entity_id)`;
  await connection`CREATE INDEX IF NOT EXISTS orders_device_idx ON tapayoka.orders(device_wallet_address)`;
  await connection`CREATE INDEX IF NOT EXISTS orders_status_idx ON tapayoka.orders(status)`;
  await connection`CREATE INDEX IF NOT EXISTS authorizations_order_idx ON tapayoka.authorizations(order_id)`;
  await connection`CREATE INDEX IF NOT EXISTS device_logs_device_idx ON tapayoka.device_logs(device_wallet_address)`;
  await connection`CREATE INDEX IF NOT EXISTS admin_logs_user_idx ON tapayoka.admin_logs(user_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_locations_entity_idx ON tapayoka.vendor_locations(entity_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_models_entity_idx ON tapayoka.vendor_models(entity_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_offerings_location_idx ON tapayoka.vendor_offerings(vendor_location_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_offerings_model_idx ON tapayoka.vendor_offerings(vendor_model_id)`;
  await connection`CREATE INDEX IF NOT EXISTS vendor_installations_offering_idx ON tapayoka.vendor_installations(vendor_offering_id)`;

  console.log("Database initialized successfully");
}
