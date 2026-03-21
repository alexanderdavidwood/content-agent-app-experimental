import { createUIMessageStreamResponse } from "ai";
import { handleChatStream } from "@mastra/ai-sdk";
import type { Mastra } from "@mastra/core";
import { RequestContext } from "@mastra/core/request-context";
import { z } from "zod";

import { chatExecutionContextSchema } from "@contentful-rename/shared";

export const chatStreamBodySchema = z
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

export async function createChatStreamResponse(
  mastra: Mastra,
  payload: unknown,
  abortSignal?: AbortSignal,
) {
  const body = chatStreamBodySchema.parse(payload);
  const stream = await handleChatStream({
    mastra,
    agentId: "contentful-product-rename-agent",
    sendReasoning: true,
    params: {
      ...body,
      requestContext: new RequestContext(Object.entries(body.requestContext)),
      abortSignal,
    },
  });

  return createUIMessageStreamResponse({
    stream: stream as any,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
