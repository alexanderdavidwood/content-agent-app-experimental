import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import {
  createChatDebugError,
  serializeChatDebugError,
  type ChatExecutionContext,
  type RenameRunInput,
} from "@contentful-rename/shared";
import {
  applyApprovedChangesToolInputSchema,
  applyApprovedChangesToolOutputSchema,
  chatExecutionContextSchema,
  discoverCandidatesToolInputSchema,
  discoverCandidatesToolOutputSchema,
  draftProposalsToolInputSchema,
  draftProposalsToolOutputSchema,
  renameChatRequestSchema,
  renameRunInputSchema,
  reviewProposalsToolInputSchema,
  reviewProposalsToolOutputSchema,
} from "@contentful-rename/shared";
import { z } from "zod";

import { buildDiscoveryPlan, buildProposedChanges } from "../lib/renameEngine";

const renameDiscoveryRequestSchema = renameChatRequestSchema.extend({
  searchMode: renameRunInputSchema.shape.searchMode.optional(),
});

function getChatContext(context: any) {
  return chatExecutionContextSchema.parse(context?.requestContext?.all ?? {});
}

function resolveSearchMode(
  requestedSearchMode: RenameRunInput["searchMode"] | undefined,
  chatContext: ChatExecutionContext,
): RenameRunInput["searchMode"] {
  if (!chatContext.toolAvailability.semanticSearch) {
    return "keyword";
  }

  return requestedSearchMode ?? "semantic";
}

export const discoverCandidatesClientTool = createTool({
  id: "discover-candidates-client",
  description:
    "Search Contentful for rename candidates using the current Contentful app permissions. Use this after you know the old and new product names and want real candidate entry snapshots.",
  inputSchema: renameDiscoveryRequestSchema,
  outputSchema: discoverCandidatesToolOutputSchema,
  suspendSchema: discoverCandidatesToolInputSchema,
  resumeSchema: discoverCandidatesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw new Error(
        serializeChatDebugError(
          createChatDebugError(new Error("Agent context is required for Contentful search."), {
            code: "agent_context_missing",
            phase: "searching-contentful",
            toolName: "discoverCandidatesClient",
          }),
        ),
      );
    }

    if (!context.agent.resumeData) {
      const chatContext = getChatContext(context);
      const runInput: RenameRunInput = renameRunInputSchema.parse({
        oldProductName: inputData.oldProductName,
        newProductName: inputData.newProductName,
        defaultLocale: chatContext.defaultLocale,
        searchMode: resolveSearchMode(inputData.searchMode, chatContext),
        contentTypeIds: chatContext.allowedContentTypes,
        userNotes: inputData.userNotes,
        surfaceContext: chatContext.surfaceContext,
      });
      const discoveryPlan = await buildDiscoveryPlan(runInput);

      await context.agent.suspend(
        discoverCandidatesToolInputSchema.parse({
          runId: randomUUID(),
          input: runInput,
          discoveryPlan,
          maxCandidatesPerRun: chatContext.maxCandidatesPerRun,
        }),
      );
      return undefined as never;
    }

    return discoverCandidatesToolOutputSchema.parse(context.agent.resumeData);
  },
});

export const draftProposalsTool = createTool({
  id: "draft-proposals",
  description:
    "Draft field-level rename changes from Contentful candidate snapshots. Use this after candidate snapshots are available.",
  inputSchema: draftProposalsToolInputSchema,
  outputSchema: draftProposalsToolOutputSchema,
  execute: async (inputData) => {
    const renameInput: RenameRunInput = renameRunInputSchema.parse(inputData.input);
    const proposedChanges = await buildProposedChanges(
      renameInput,
      inputData.candidateSnapshots,
    );

    return draftProposalsToolOutputSchema.parse({
      runId: inputData.runId,
      proposedChanges,
    });
  },
});

export const reviewProposalsClientTool = createTool({
  id: "review-proposals-client",
  description:
    "Request human review for drafted rename changes inside the Contentful app. Use this when you need explicit approval, edits, or cancellation before applying updates.",
  inputSchema: reviewProposalsToolInputSchema,
  outputSchema: reviewProposalsToolOutputSchema,
  suspendSchema: reviewProposalsToolInputSchema,
  resumeSchema: reviewProposalsToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw new Error(
        serializeChatDebugError(
          createChatDebugError(new Error("Agent context is required for review."), {
            code: "agent_context_missing",
            phase: "reviewing-proposed-changes",
            toolName: "reviewProposalsClient",
          }),
        ),
      );
    }

    if (!context.agent.resumeData) {
      await context.agent.suspend(reviewProposalsToolInputSchema.parse(inputData));
      return undefined as never;
    }

    return reviewProposalsToolOutputSchema.parse(context.agent.resumeData);
  },
});

export const applyApprovedChangesClientTool = createTool({
  id: "apply-approved-changes-client",
  description:
    "Apply approved rename changes through the current Contentful app session. Use this only after review confirms which changes should be written.",
  inputSchema: applyApprovedChangesToolInputSchema,
  outputSchema: applyApprovedChangesToolOutputSchema,
  suspendSchema: applyApprovedChangesToolInputSchema,
  resumeSchema: applyApprovedChangesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw new Error(
        serializeChatDebugError(
          createChatDebugError(new Error("Agent context is required for applying changes."), {
            code: "agent_context_missing",
            phase: "applying-approved-changes",
            toolName: "applyApprovedChangesClient",
          }),
        ),
      );
    }

    if (!context.agent.resumeData) {
      await context.agent.suspend(
        applyApprovedChangesToolInputSchema.parse(inputData),
      );
      return undefined as never;
    }

    return applyApprovedChangesToolOutputSchema.parse(context.agent.resumeData);
  },
});
