import {
  pgSchema,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
  unique,
} from "drizzle-orm/pg-core";

// PostgreSQL schema namespace
export const tapayoka = pgSchema("tapayoka");

// =============================================================================
// Enums
// =============================================================================

export const serviceTypeEnum = tapayoka.enum("service_type", [
  "TRIGGER",
  "FIXED",
  "VARIABLE",
]);

export const orderStatusEnum = tapayoka.enum("order_status", [
  "CREATED",
  "PAID",
  "AUTHORIZED",
  "RUNNING",
  "DONE",
  "FAILED",
]);

export const deviceStatusEnum = tapayoka.enum("device_status", [
  "ACTIVE",
  "OFFLINE",
  "MAINTENANCE",
  "DEACTIVATED",
]);

export const userRoleEnum = tapayoka.enum("user_role", ["vendor", "buyer"]);

export const logDirectionEnum = tapayoka.enum("log_direction", [
  "PI_TO_SRV",
  "SRV_TO_PI",
]);

// =============================================================================
// Tables
// =============================================================================

export const users = tapayoka.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  firebaseUid: varchar("firebase_uid", { length: 128 }).notNull().unique(),
  email: varchar("email", { length: 255 }),
  displayName: varchar("display_name", { length: 255 }),
  role: userRoleEnum("role").notNull().default("buyer"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const devices = tapayoka.table(
  "devices",
  {
    walletAddress: varchar("wallet_address", { length: 42 })
      .primaryKey()
      .notNull(),
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    model: varchar("model", { length: 255 }),
    location: varchar("location", { length: 255 }),
    gpioConfig: jsonb("gpio_config"),
    status: deviceStatusEnum("status").notNull().default("ACTIVE"),
    serverWalletAddress: varchar("server_wallet_address", { length: 42 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  table => [index("devices_entity_idx").on(table.entityId)]
);

export const services = tapayoka.table(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    type: serviceTypeEnum("type").notNull(),
    priceCents: integer("price_cents").notNull(),
    fixedMinutes: integer("fixed_minutes"),
    minutesPer25c: integer("minutes_per_25c"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  table => [index("services_entity_idx").on(table.entityId)]
);

export const deviceServices = tapayoka.table(
  "device_services",
  {
    deviceWalletAddress: varchar("device_wallet_address", { length: 42 })
      .notNull()
      .references(() => devices.walletAddress, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  table => [
    unique("device_services_unique").on(
      table.deviceWalletAddress,
      table.serviceId
    ),
  ]
);

export const orders = tapayoka.table(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceWalletAddress: varchar("device_wallet_address", { length: 42 })
      .notNull()
      .references(() => devices.walletAddress),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    buyerUid: varchar("buyer_uid", { length: 128 }),
    amountCents: integer("amount_cents").notNull(),
    authorizedSeconds: integer("authorized_seconds").notNull().default(0),
    status: orderStatusEnum("status").notNull().default("CREATED"),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", {
      length: 255,
    }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  table => [
    index("orders_device_idx").on(table.deviceWalletAddress),
    index("orders_status_idx").on(table.status),
  ]
);

export const authorizations = tapayoka.table(
  "authorizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    payloadJson: text("payload_json").notNull(),
    serverSignature: text("server_signature").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  table => [index("authorizations_order_idx").on(table.orderId)]
);

export const deviceLogs = tapayoka.table(
  "device_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceWalletAddress: varchar("device_wallet_address", { length: 42 })
      .notNull()
      .references(() => devices.walletAddress),
    direction: logDirectionEnum("direction").notNull(),
    ok: boolean("ok").notNull().default(true),
    details: text("details"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  table => [index("device_logs_device_idx").on(table.deviceWalletAddress)]
);

export const adminLogs = tapayoka.table(
  "admin_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    action: varchar("action", { length: 255 }).notNull(),
    entityType: varchar("entity_type", { length: 100 }),
    entityId: varchar("entity_id", { length: 255 }),
    details: text("details"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  table => [index("admin_logs_user_idx").on(table.userId)]
);

// =============================================================================
// Vendor Management Tables
// =============================================================================

export const vendorLocations = tapayoka.table(
  "vendor_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firebaseUserId: varchar("firebase_user_id", { length: 128 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    address: varchar("address", { length: 255 }).notNull(),
    city: varchar("city", { length: 255 }).notNull(),
    stateProvince: varchar("state_province", { length: 255 }).notNull(),
    zipcode: varchar("zipcode", { length: 20 }).notNull(),
    country: varchar("country", { length: 100 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  table => [index("vendor_locations_firebase_user_idx").on(table.firebaseUserId)]
);

export const vendorEquipmentCategories = tapayoka.table(
  "vendor_equipment_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firebaseUserId: varchar("firebase_user_id", { length: 128 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  table => [
    index("vendor_equipment_categories_firebase_user_idx").on(
      table.firebaseUserId
    ),
  ]
);

export const vendorServices = tapayoka.table(
  "vendor_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorLocationId: uuid("vendor_location_id")
      .notNull()
      .references(() => vendorLocations.id),
    vendorEquipmentCategoryId: uuid("vendor_equipment_category_id")
      .notNull()
      .references(() => vendorEquipmentCategories.id),
    name: varchar("name", { length: 255 }).notNull(),
    price: numeric("price", { precision: 10, scale: 2 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .notNull()
      .default("USD"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  table => [
    unique("vendor_services_location_category_unique").on(
      table.vendorLocationId,
      table.vendorEquipmentCategoryId
    ),
    index("vendor_services_location_idx").on(table.vendorLocationId),
    index("vendor_services_category_idx").on(table.vendorEquipmentCategoryId),
  ]
);

export const vendorServiceControls = tapayoka.table(
  "vendor_service_controls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorServiceId: uuid("vendor_service_id")
      .notNull()
      .references(() => vendorServices.id, { onDelete: "cascade" }),
    pinNumber: integer("pin_number").notNull(),
    duration: integer("duration").notNull(),
  },
  table => [
    index("vendor_service_controls_service_idx").on(table.vendorServiceId),
  ]
);

export const vendorEquipments = tapayoka.table(
  "vendor_equipments",
  {
    walletAddress: varchar("wallet_address", { length: 42 })
      .primaryKey()
      .notNull(),
    vendorServiceId: uuid("vendor_service_id")
      .notNull()
      .references(() => vendorServices.id),
    name: varchar("name", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  table => [
    index("vendor_equipments_service_idx").on(table.vendorServiceId),
  ]
);
