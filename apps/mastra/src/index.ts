import { Mastra } from "@mastra/core";
import { registerApiRoute } from "@mastra/core/server";
import { LibSQLStore } from "@mastra/libsql";
import {
  createChatDebugError,
  serializeChatDebugError,
} from "@contentful-rename/shared";

import { renameAgent } from "./agents/renameAgent";
import { createChatStreamResponse } from "./routes/chatStreamResponse";

function envFlag(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function resolveStorageUrl() {
  return (
    process.env.MASTRA_STORAGE_URL?.trim() ||
    "file:./.mastra/contentful-rename.db"
  );
}

function resolveStorageAuthToken() {
  return (
    process.env.MASTRA_STORAGE_AUTH_TOKEN?.trim() ||
    process.env.TURSO_AUTH_TOKEN?.trim() ||
    process.env.DATABASE_AUTH_TOKEN?.trim()
  );
}

function createStorage() {
  if (envFlag(process.env.MASTRA_USE_CLOUD_STORAGE)) {
    console.log("Using Mastra Cloud managed storage");
    return undefined;
  }

  const url = resolveStorageUrl();
  const authToken = resolveStorageAuthToken();

  if (url.startsWith("libsql://") && !authToken) {
    throw new Error(
      "Remote LibSQL storage requires an auth token. Set MASTRA_STORAGE_AUTH_TOKEN, TURSO_AUTH_TOKEN, or DATABASE_AUTH_TOKEN, or set MASTRA_USE_CLOUD_STORAGE=true to use Mastra Cloud managed storage.",
    );
  }

  return new LibSQLStore({
    id: "contentful-rename-storage",
    url,
    ...(authToken ? { authToken } : {}),
  });
}

const storage = createStorage();

export const mastra = new Mastra({
  ...(storage ? { storage } : {}),
  agents: {
    renameAgent,
  },
  server: {
    apiRoutes: [
      registerApiRoute("/chat/stream", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) => {
          try {
            return await createChatStreamResponse(
              c.get("mastra"),
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
        },
      }),
    ],
  },
});
