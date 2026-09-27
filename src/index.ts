import { Hono } from "hono";

export { UserNudger } from "./durable/UserNudger";

export const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok" }));

export default app satisfies ExportedHandler<Env>;
