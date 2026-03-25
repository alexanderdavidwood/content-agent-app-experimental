import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";

import {
  parseConfiguredCorsOrigins,
  resolveCorsOrigin,
} from "./lib/cors";
import { chatStreamRoute } from "./routes/chatStream";
import { mcpRoute } from "./routes/mcp";
import "./lib/mastra";

const app = new Hono();

const configuredOrigins = parseConfiguredCorsOrigins([
  process.env.ALLOWED_ORIGIN,
  process.env.ALLOWED_ORIGIN_EU,
]);
const allowContentfulHostedAppOrigins =
  /^(1|true|yes|on)$/i.test(
    process.env.ALLOW_CONTENTFUL_HOSTED_APP_ORIGINS?.trim() ?? "",
  );

if (
  process.env.NODE_ENV === "production" &&
  configuredOrigins.length === 0 &&
  !allowContentfulHostedAppOrigins
) {
  throw new Error(
    "Set ALLOWED_ORIGIN/ALLOWED_ORIGIN_EU or enable ALLOW_CONTENTFUL_HOSTED_APP_ORIGINS in production.",
  );
}

app.use(
  "*",
  cors({
    origin: (origin) =>
      resolveCorsOrigin(
        origin,
        configuredOrigins,
        allowContentfulHostedAppOrigins,
      ),
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "bypass-tunnel-reminder",
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    timestamp: new Date().toISOString(),
  }),
);

app.route("/chat/stream", chatStreamRoute);
app.route("/api/chat/stream", chatStreamRoute);
app.route("/mcp", mcpRoute);

export default app;

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 4111);
  serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      // Keep startup logging explicit for cloud and local runs.
      console.log(`Contentful rename Mastra server listening on ${port}`);
    },
  );
}
