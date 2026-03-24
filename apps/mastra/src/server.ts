import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";

import { chatStreamRoute } from "./routes/chatStream";
import { mcpRoute } from "./routes/mcp";
import "./lib/mastra";

const app = new Hono();

const configuredOrigins = [
  process.env.ALLOWED_ORIGIN,
  process.env.ALLOWED_ORIGIN_EU,
].filter((value): value is string => Boolean(value));

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]" ||
      url.hostname === "app.contentful.com" ||
      url.hostname === "app.eu.contentful.com"
    );
  } catch {
    return false;
  }
}

function resolveCorsOrigin(origin: string) {
  if (configuredOrigins.includes(origin)) {
    return origin;
  }

  if (process.env.NODE_ENV !== "production" && isLocalOrigin(origin)) {
    return origin;
  }

  return null;
}

if (process.env.NODE_ENV === "production" && configuredOrigins.length === 0) {
  throw new Error(
    "ALLOWED_ORIGIN and ALLOWED_ORIGIN_EU must be configured in production.",
  );
}

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin),
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
