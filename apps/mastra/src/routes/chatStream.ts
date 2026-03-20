import { createUIMessageStreamResponse } from "ai";
import { handleChatStream } from "@mastra/ai-sdk";
import { RequestContext } from "@mastra/core/request-context";
import { Hono } from "hono";
import { z } from "zod";

import { chatExecutionContextSchema } from "@contentful-rename/shared";

import { mastra } from "../lib/mastra";

const chatStreamBodySchema = z
  .object({
    messages: z.array(z.any()).default([]),
    requestContext: chatExecutionContextSchema,
    memory: z.object({
      thread: z.string().min(1),
      resource: z.string().min(1),
    }),
    runId: z.string().optional(),
    resumeData: z.record(z.string(), z.unknown()).optional(),
    trigger: z.enum(["submit-message", "regenerate-message"]).optional(),
  })
  .passthrough();

export const chatStreamRoute = new Hono().post("/", async (c) => {
  try {
    const body = chatStreamBodySchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const stream = await handleChatStream({
      mastra,
      agentId: "contentful-product-rename-agent",
      params: {
        ...body,
        requestContext: new RequestContext(Object.entries(body.requestContext)),
      },
    });

    return createUIMessageStreamResponse({
      stream: stream as any,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return c.text(
      error instanceof Error
        ? error.message
        : "The rename assistant failed to stream a response.",
      500,
    );
  }
});
