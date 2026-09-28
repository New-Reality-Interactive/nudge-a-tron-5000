import { createApp } from "./http/app";

export { UserNudger } from "./durable/UserNudger";

export const app = createApp();

export default app satisfies ExportedHandler<Env>;
