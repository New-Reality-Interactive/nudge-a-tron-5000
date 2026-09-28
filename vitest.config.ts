import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig, type Plugin } from "vitest/config";

/** Loads `.sql` as a string in Node, as Wrangler's default Text module rule does in workerd. */
const sqlAsText: Plugin = {
  name: "sql-as-text",
  transform(code, id) {
    return id.endsWith(".sql")
      ? { code: `export default ${JSON.stringify(code)};`, map: null }
      : null;
  },
};

export default defineConfig({
  test: {
    // v8 coverage needs node:inspector, which workerd does not implement, so the
    // gate measures the Node-testable layers via the `unit` project. Code bound
    // to workerd (entrypoint, Durable Object, HTTP, DO/D1 adapters) is exercised
    // behaviourally by the `integration` project instead.
    coverage: {
      provider: "v8",
      include: ["src/domain/**/*.ts", "src/app/**/*.ts"],
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        "src/domain/**": { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
    projects: [
      {
        plugins: [sqlAsText],
        test: {
          name: "unit",
          environment: "node",
          // The fast-check properties are CPU-bound. Run in parallel with the other
          // projects, or under v8 coverage on CI runners, some take longer than 5 s.
          testTimeout: 30_000,
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                // Applied to the local D1 by test/integration/setup.ts.
                TEST_MIGRATIONS: await readD1Migrations("./migrations/d1"),
                ADMIN_API_KEY: "test-admin-key",
                ACK_SIGNING_KEY: "test-ack-signing-key",
              },
            },
          })),
        ],
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          setupFiles: ["./test/integration/setup.ts"],
        },
      },
    ],
  },
});
