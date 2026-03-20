import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";

import { renameAgent } from "../agents/renameAgent";

export const mastra = new Mastra({
  storage: new LibSQLStore({
    id: "contentful-rename-storage",
    url:
      process.env.MASTRA_STORAGE_URL ?? "file:./.mastra/contentful-rename.db",
  }),
  agents: {
    renameAgent,
  },
});
