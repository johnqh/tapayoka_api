import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Database-backed suites are never collected here. This is what keeps CI
    // off a database — not a runtime skip inside the tests.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.db.test.ts"],
    // @sudobility service packages are compiled by tsc with extensionless and
    // directory-style relative imports. Bun resolves them; Node's ESM resolver,
    // which vitest uses for bare dependencies, does not.
    server: {
      deps: {
        inline: ["@sudobility/auth_service", "@sudobility/entity_service"],
      },
    },
  },
});
