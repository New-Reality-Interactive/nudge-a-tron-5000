import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Brings the local D1 up to date before each test file. Already-applied migrations are
// recorded in d1_migrations and skipped, so this is cheap to repeat. TEST_MIGRATIONS is a
// test-only binding set in vitest.config.ts, so it isn't in the generated Env type.
const { TEST_MIGRATIONS } = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };
await applyD1Migrations(env.DB, TEST_MIGRATIONS);
