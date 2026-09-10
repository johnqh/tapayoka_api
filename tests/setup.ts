/**
 * Unit-test setup. Loaded by `bun run test` — the script CI runs.
 *
 * No database is reachable from here: the guard deletes DATABASE_URL, and
 * vitest.config.ts excludes every *.db.test.ts file from collection. Both, so
 * that neither alone is load-bearing.
 *
 * Replaces a `process.env.DATABASE_URL ?? "postgresql://localhost:..."` default,
 * which applied only when the variable was unset — so an exported production URL
 * won. It never ran anyway: the preload was declared in bunfig.toml, which is
 * Bun test-runner config, while the test script is vitest.
 */
import { scrubDatabaseUrl } from "@sudobility/test-db-guard";

process.env.NODE_ENV = "test";

scrubDatabaseUrl();

// Well-known Hardhat account #0 key. Test fixture, not a credential.
process.env.SERVER_ETH_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
