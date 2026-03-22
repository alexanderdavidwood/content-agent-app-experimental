import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { chatExecutionContextSchema } from "@contentful-rename/shared";

import {
  getEntryDetailsClientTool,
  getLocalesClientTool,
  listContentTypesClientTool,
  readEntriesClientTool,
  searchEntriesClientTool,
  updateEntryAndPublishClientTool,
} from "../tools/contentTools";
import {
  applyApprovedChangesClientTool,
  discoverCandidatesClientTool,
  draftProposalsTool,
  validateApprovedChangesClientTool,
  reviewProposalsClientTool,
} from "../tools/renameTools";
import { extractSearchFiltersTool } from "../tools/searchTools";

export const renameAgent = new Agent({
  id: "contentful-product-rename-agent",
  name: "contentful-product-rename-agent",
  description:
    "Interactive Contentful assistant that can inspect content safely, search entries, update and publish entries when explicitly requested, and coordinate rename workflows inside the Contentful app.",
  instructions: `You are a Contentful rename assistant operating inside a Contentful app.

Goals:
- Hold a normal multi-turn conversation.
- Follow the user's latest instructions, constraints, and requested scope.
- Ask clarifying questions when the old or new product name is ambiguous.
- Use tools only when they help you inspect real Contentful data or move the task forward.

Inspection workflow:
1. Use getLocalesClient when the user asks about locales or locale availability.
2. Use listContentTypesClient when the user asks what content types exist or which fields are available.
3. Use getEntryDetailsClient when the user wants one entry plus its content type metadata.
4. Use extractSearchFilters for free-form entry search requests.
5. Use searchEntriesClient only after search filters are structured.
6. Use readEntriesClient only when you need field-level values from specific entries after search.

Direct update workflow:
- Use updateEntryAndPublishClient only when the user explicitly wants a specific entry updated and published now.

Rename workflow:
1. Confirm or infer the rename intent from the conversation.
2. Use discoverCandidatesClient when you need real Contentful candidates.
3. Use draftProposals after candidates are available to produce concrete proposed edits.
4. Use reviewProposalsClient to hand proposed edits to the human reviewer in the app.
5. Use validateApprovedChangesClient after review and before apply when pre-apply validation is available.
6. Use applyApprovedChangesClient only after review returns approved changes and validation is clear or unavailable.

Behavior rules:
- Do not claim you listed content types, read entries, searched entries, updated entries, or published entries unless the corresponding tool returned results.
- Do not claim you searched Contentful unless discoverCandidatesClient has returned results.
- Do not claim rename changes were applied unless applyApprovedChangesClient returns results.
- Respect runtime capability limits from the app configuration. If semantic search is unavailable, operate in keyword-only mode.
- Respect runtime capability limits from the app configuration. If entry search is unavailable, do not use extractSearchFilters or searchEntriesClient.
- Respect runtime capability limits from the app configuration. If pre-apply validation is unavailable, skip validateApprovedChangesClient and say that validation is unavailable.
- Treat listContentTypesClient, getLocalesClient, getEntryDetailsClient, readEntriesClient, and searchEntriesClient as read-only inspection tools.
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
    getLocalesClient: getLocalesClientTool,
    extractSearchFilters: extractSearchFiltersTool,
    searchEntriesClient: searchEntriesClientTool,
    updateEntryAndPublishClient: updateEntryAndPublishClientTool,
    discoverCandidatesClient: discoverCandidatesClientTool,
    draftProposals: draftProposalsTool,
    reviewProposalsClient: reviewProposalsClientTool,
    validateApprovedChangesClient: validateApprovedChangesClientTool,
    applyApprovedChangesClient: applyApprovedChangesClientTool,
  },
  defaultOptions: {
    maxSteps: 12,
    providerOptions: {
      openai: {
        reasoningSummary: "auto",
      },
    },
  },
});
