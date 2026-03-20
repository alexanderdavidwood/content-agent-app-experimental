import { Hono } from "hono";

import { mastra } from "../lib/mastra";
import { createChatStreamResponse } from "./chatStreamResponse";

export const chatStreamRoute = new Hono().post("/", async (c) => {
  try {
    return await createChatStreamResponse(
      mastra,
      await c.req.json().catch(() => ({})),
      c.req.raw.signal,
    );
  } catch (error) {
    return c.text(
      error instanceof Error
        ? error.message
        : "The rename assistant failed to stream a response.",
      500,
    );
  }
});
