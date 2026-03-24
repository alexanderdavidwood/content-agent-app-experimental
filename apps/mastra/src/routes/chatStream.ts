import { Hono } from "hono";
import {
  chatExecutionContextSchema,
  createChatDebugError,
  serializeChatDebugError,
} from "@contentful-rename/shared";

import {
  buildChatContextWithSession,
  buildMcpSessionStatus,
  readMcpSessionIdFromCookie,
} from "../lib/mcp/status";
import { mastra } from "../lib/mastra";
import { createChatStreamResponse } from "./chatStreamResponse";

export const chatStreamRoute = new Hono().post("/", async (c) => {
  try {
    const payload = await c.req.json().catch(() => ({}));
    if (
      payload &&
      typeof payload === "object" &&
      "requestContext" in payload &&
      payload.requestContext
    ) {
      const chatContext = chatExecutionContextSchema.parse(payload.requestContext);
      const sessionId = await readMcpSessionIdFromCookie(c);
      const sessionStatus = await buildMcpSessionStatus({
        provider: chatContext.contentOpsProvider,
        generalContentToolAvailability: chatContext.generalContentToolAvailability,
        mcpAutoFallbackToClientSdk: chatContext.mcpAutoFallbackToClientSdk,
        sessionId,
        spaceId: chatContext.spaceId,
        environmentId: chatContext.environmentId,
        organizationId: chatContext.organizationId,
        contentfulUserId: chatContext.contentfulUserId,
      });

      (payload as Record<string, unknown>).requestContext =
        buildChatContextWithSession(chatContext, sessionStatus);
    }

    return await createChatStreamResponse(
      mastra,
      payload,
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
