import { Mastra } from "@mastra/core";

import { renameAgent } from "../agents/renameAgent";
import { renameWorkflow } from "../workflows/renameWorkflow";

export const mastra = new Mastra({
  agents: {
    renameAgent,
  },
  workflows: {
    renameWorkflow,
  },
});
