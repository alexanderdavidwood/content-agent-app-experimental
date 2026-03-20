import { Hono } from "hono";

import { renameAgent } from "../agents/renameAgent";

function extractPrompt(messages: any[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  if (!lastUserMessage) {
    return "Help the user plan a Contentful product rename run.";
  }

  if (typeof lastUserMessage.content === "string") {
    return lastUserMessage.content;
  }

  const parts = lastUserMessage.parts ?? [];
  return parts
    .map((part: any) => (part.type === "text" ? part.text : ""))
    .join("");
}

export const chatStreamRoute = new Hono().post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt = extractPrompt(messages);

  try {
    const result = await (renameAgent as any).stream(prompt);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of result.textStream) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
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
