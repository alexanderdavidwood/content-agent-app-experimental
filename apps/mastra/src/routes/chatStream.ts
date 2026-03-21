import { Hono } from "hono";
import {
  createChatDebugError,
  serializeChatDebugError,
} from "@contentful-rename/shared";

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
      serializeChatDebugError(
        createChatDebugError(error, {
          code: "chat_stream_failed",
          phase: "error",
          details: {
            route: "/chat/stream",
          },
        }),
      ),
      500,
    );
  }
});
