import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { chatExecutionContextSchema } from "@contentful-rename/shared";

import {
  applyApprovedChangesClientTool,
  discoverCandidatesClientTool,
  draftProposalsTool,
  reviewProposalsClientTool,
} from "../tools/renameTools";

export const renameAgent = new Agent({
  id: "contentful-product-rename-agent",
  name: "contentful-product-rename-agent",
  description:
    "Interactive Contentful rename assistant that can search content, draft rename updates, request review, and coordinate apply operations inside the Contentful app.",
  instructions: `You are a Contentful rename assistant operating inside a Contentful app.

Goals:
- Hold a normal multi-turn conversation.
- Follow the user's latest instructions, constraints, and requested scope.
- Ask clarifying questions when the old or new product name is ambiguous.
- Use tools only when they help you inspect real Contentful data or move the rename forward.

Rename workflow:
1. Confirm or infer the rename intent from the conversation.
2. Use discoverCandidatesClient when you need real Contentful candidates.
3. Use draftProposals after candidates are available to produce concrete proposed edits.
4. Use reviewProposalsClient to hand proposed edits to the human reviewer in the app.
5. Use applyApprovedChangesClient only after review returns approved changes.

Behavior rules:
- Do not claim you searched Contentful unless discoverCandidatesClient has returned results.
- Do not claim changes were applied unless applyApprovedChangesClient returns results.
- Respect runtime capability limits from the app configuration. If semantic search is unavailable, operate in keyword-only mode.
- Respect user requests like narrowing content types, waiting before apply, or explaining the rationale.
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
