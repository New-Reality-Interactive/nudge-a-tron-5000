import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

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
        test: {
          name: "unit",
          environment: "node",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
        },
      },
    ],
  },
});
