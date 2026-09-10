/**
 * Database-test setup. Loaded by `bun run test:db` only — never by CI.
 *
 * Throws unless TEST_DATABASE_URL names a localhost database, then publishes it
 * as DATABASE_URL for the application code to read.
 *
 * This repo has no *.db.test.ts files yet. The wiring exists so the first one
 * added lands correctly instead of quietly running against whatever DATABASE_URL
 * happens to be exported.
 */
import { setupTestDatabase } from "@sudobility/test-db-guard";

process.env.NODE_ENV = "test";

setupTestDatabase();

// Well-known Hardhat account #0 key. Test fixture, not a credential.
process.env.SERVER_ETH_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
