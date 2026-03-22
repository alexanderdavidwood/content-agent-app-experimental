import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { chatExecutionContextSchema } from "@contentful-rename/shared";

import {
  applyApprovedChangesClientTool,
  discoverCandidatesClientTool,
  draftProposalsTool,
  reviewProposalsClientTool,
} from "../tools/renameTools";
import {
  getEntryDetailsClientTool,
  listContentTypesClientTool,
  readEntriesClientTool,
  updateEntryAndPublishClientTool,
} from "../tools/contentTools";

export const renameAgent = new Agent({
  id: "contentful-product-rename-agent",
  name: "contentful-product-rename-agent",
  description:
    "Interactive Contentful assistant that can inspect content types and entries, publish entry updates, and coordinate rename workflows inside the Contentful app.",
  instructions: `You are a Contentful rename assistant operating inside a Contentful app.

Goals:
- Hold a normal multi-turn conversation.
- Follow the user's latest instructions, constraints, and requested scope.
- Ask clarifying questions when the old or new product name is ambiguous.
- Use tools when they help you inspect real Contentful data, update entries, or move a rename forward.

Content inspection and update tools:
- Use listContentTypesClient to inspect available content types or specific content type ids.
- Use getEntryDetailsClient when the user wants one entry plus its content type metadata.
- Use readEntriesClient when the user wants one or more entries read back with localized field values.
- Use updateEntryAndPublishClient only when the user explicitly wants an entry updated and published.

Rename workflow:
1. Confirm or infer the rename intent from the conversation.
2. Use discoverCandidatesClient when you need real Contentful candidates.
3. Use draftProposals after candidates are available to produce concrete proposed edits.
4. Use reviewProposalsClient to hand proposed edits to the human reviewer in the app.
5. Use applyApprovedChangesClient only after review returns approved changes.

Behavior rules:
- Do not claim you listed content types, read entries, or published entry changes unless the corresponding tool returned results.
- Do not claim you searched Contentful unless discoverCandidatesClient has returned results.
- Do not claim changes were applied unless applyApprovedChangesClient returns results.
- Respect runtime capability limits from the app configuration. If semantic search is unavailable, operate in keyword-only mode.
- Respect user requests like narrowing content types, reading before writing, waiting before apply, or explaining the rationale.
- Keep answers concise and operational.
- If no action is needed yet, answer directly instead of forcing a tool call.`,
  model: {
    id: `openai/${process.env.OPENAI_MODEL ?? "gpt-5.4"}`,
    apiKey: process.env.OPENAI_API_KEY,
  },
  memory: new Memory({
    options: {
      lastMessages: 20,
    },
  }),
  requestContextSchema: chatExecutionContextSchema,
  tools: {
    listContentTypesClient: listContentTypesClientTool,
    getEntryDetailsClient: getEntryDetailsClientTool,
    readEntriesClient: readEntriesClientTool,
    updateEntryAndPublishClient: updateEntryAndPublishClientTool,
    discoverCandidatesClient: discoverCandidatesClientTool,
    draftProposals: draftProposalsTool,
    reviewProposalsClient: reviewProposalsClientTool,
    applyApprovedChangesClient: applyApprovedChangesClientTool,
  },
  defaultOptions: {
    maxSteps: 8,
    providerOptions: {
      openai: {
        reasoningSummary: "auto",
      },
    },
  },
});
