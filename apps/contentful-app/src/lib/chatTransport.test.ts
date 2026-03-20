import assert from "node:assert/strict";
import test from "node:test";

import { createRenameChatTransport } from "./chatTransport";

const textEncoder = new TextEncoder();

function createContext() {
  return {
    requestContext: {
      defaultLocale: "en-US",
      allowedContentTypes: [],
      maxDiscoveryQueries: 5,
      maxCandidatesPerRun: 30,
    },
    memory: {
      thread: "thread-1",
      resource: "resource-1",
    },
  };
}

function createEventStreamResponse() {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          textEncoder.encode('data: {"type":"start","messageId":"msg-1"}\n\n'),
        );
        controller.enqueue(textEncoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
      },
    },
  );
}

async function sendViaTransport(
  transport: ReturnType<typeof createRenameChatTransport>,
) {
  return transport.sendMessages({
    trigger: "submit-message",
    chatId: "chat-1",
    messageId: undefined,
    messages: [],
    abortSignal: undefined,
    headers: undefined,
    body: undefined,
    metadata: undefined,
  });
}

test("createRenameChatTransport resolves the backend URL from the latest getter value", async () => {
  let baseUrl = "https://first.example.com";
  const seenUrls: string[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input) => {
    seenUrls.push(String(input));
    return createEventStreamResponse();
  }) as typeof fetch;

  try {
    const transport = createRenameChatTransport(() => baseUrl, createContext());

    await sendViaTransport(transport);
    baseUrl = "https://second.example.com";
    await sendViaTransport(transport);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(seenUrls, [
    "https://first.example.com/chat/stream",
    "https://second.example.com/chat/stream",
  ]);
});

test("createRenameChatTransport surfaces backend preflight guidance after a fetch failure", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input) => {
    const url = String(input);

    if (url.endsWith("/chat/stream")) {
      throw new TypeError("Failed to fetch");
    }

    if (url.endsWith("/health")) {
      return new Response("Tunnel Unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      });
    }

    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const transport = createRenameChatTransport(
      "https://stale-tunnel.example.com",
      createContext(),
    );

    await assert.rejects(
      () => sendViaTransport(transport),
      /Tunnel is unavailable \(503\)\. Restart your tunnel and update mastraBaseUrl if the URL changed\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
