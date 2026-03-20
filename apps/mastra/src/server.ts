import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";

import { chatStreamRoute } from "./routes/chatStream";
import "./lib/mastra";

const app = new Hono();

const origins = [
  process.env.ALLOWED_ORIGIN,
  process.env.ALLOWED_ORIGIN_EU,
].filter((value): value is string => Boolean(value));

app.use(
  "*",
  cors({
    origin: origins.length > 0 ? origins : "*",
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "bypass-tunnel-reminder",
    ],
    allowMethods: ["GET", "POST", "OPTIONS"],
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
