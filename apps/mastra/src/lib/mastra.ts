import { Mastra } from "@mastra/core";
import { registerApiRoute } from "@mastra/core/server";
import { LibSQLStore } from "@mastra/libsql";

import { renameAgent } from "../agents/renameAgent";
import { createChatStreamResponse } from "../routes/chatStreamResponse";

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: "contentful-rename-storage",
    url:
      process.env.MASTRA_STORAGE_URL ?? "file:./.mastra/contentful-rename.db",
  }),
  agents: {
    renameAgent,
  },
  server: {
    apiRoutes: [
      registerApiRoute("/chat/stream", {
        method: "POST",
        requiresAuth: false,
        handler: async (c) =>
          createChatStreamResponse(
            c.get("mastra"),
            await c.req.json().catch(() => ({})),
            c.req.raw.signal,
          ),
      }),
    ],
  },
});
