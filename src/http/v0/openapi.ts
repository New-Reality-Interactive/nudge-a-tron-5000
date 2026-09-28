import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../env";
import { validationHook } from "../middleware/errors";
import { registerAdmin } from "./routes/admin";
import { registerMe } from "./routes/me";
import { registerOccurrences } from "./routes/occurrences";
import { registerReminders } from "./routes/reminders";

/** The v0 OpenAPI document's top level. The snapshot is `openapi/v0.json`. */
export const V0_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "Nudge-A-Tron 5000 API",
    version: "0",
    description:
      "Nagging reminders: a reminder fires on a schedule and keeps nagging, more insistently " +
      "each time, until it's acknowledged.\n\n" +
      "Within v0 the API only grows: clients must ignore response fields and enum values they " +
      "don't know. Errors are RFC 9457 problem details (`application/problem+json`).",
  },
  servers: [{ url: "/v0" }],
  tags: [
    { name: "Reminders" },
    { name: "Occurrences" },
    { name: "Me" },
    { name: "Admin", description: "Needs the admin key." },
  ],
};

/** The v0 API, mounted at `/v0`. It serves its own document at `/v0/openapi.json`. */
export function createV0(): OpenAPIHono<AppEnv> {
  const v0 = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  v0.openAPIRegistry.registerComponent("securitySchemes", "apiKey", {
    type: "http",
    scheme: "bearer",
    description: "A user API key, `nt5k_<keyId>_<secret>`.",
  });
  v0.openAPIRegistry.registerComponent("securitySchemes", "adminKey", {
    type: "http",
    scheme: "bearer",
    description: "The `ADMIN_API_KEY` Worker secret.",
  });

  registerReminders(v0);
  registerOccurrences(v0);
  registerMe(v0);
  registerAdmin(v0);

  v0.doc31("/openapi.json", V0_DOCUMENT);
  return v0;
}

/** The v0 OpenAPI document, as served. */
export const v0Document = () => createV0().getOpenAPI31Document(V0_DOCUMENT);
