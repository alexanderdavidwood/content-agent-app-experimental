import assert from "node:assert/strict";
import test from "node:test";

import {
  getLatestAgentTrace,
  approveSafeChanges,
  buildReviewDraft,
  buildReviewOutput,
  buildWelcomeMessage,
  countApproved,
  getLatestSuspendedToolCall,
  getToolError,
} from "./chatRuntime";
import type { RenameChatMessage } from "./chatTypes";
import {
  LEGACY_TOOL_CALL_SUSPENDED_PART_TYPE,
  TOOL_CALL_SUSPENDED_PART_TYPE,
} from "./chatTypes";

const reviewInput = {
  runId: "run-1",
  input: {
    oldProductName: "Acme Lite",
    newProductName: "Acme Core",
    defaultLocale: "en-US",
    searchMode: "semantic" as const,
    contentTypeIds: [],
  },
  proposedChanges: [
    {
      changeId: "safe-change",
      entryId: "entry-1",
      fieldId: "title",
      locale: "en-US",
      originalText: "Acme Lite",
      proposedText: "Acme Core",
      reason: "Direct title rename",
      confidence: 0.91,
      riskFlags: [],
    },
    {
      changeId: "risky-change",
      entryId: "entry-2",
      fieldId: "body",
      locale: "en-US",
      originalText: "Acme Lite legal disclaimer",
      proposedText: "Acme Core legal disclaimer",
      reason: "Body copy rename",
      confidence: 0.7,
      riskFlags: ["LEGAL_CONTEXT" as const],
    },
  ],
  candidateSnapshots: [],
};

test("buildWelcomeMessage seeds the chat with a multi-turn rename example", () => {
  const message = buildWelcomeMessage();

  assert.equal(message.role, "assistant");
  assert.match((message.parts[0] as any).text, /Rename "Acme Lite" to "Acme Core"/);
});

test("getLatestSuspendedToolCall returns the current review suspension", () => {
  const message: RenameChatMessage = {
    id: "assistant-review",
    role: "assistant",
    parts: [
      {
        type: TOOL_CALL_SUSPENDED_PART_TYPE,
        data: {
          state: "data-tool-call-suspended",
          runId: "run-1",
          toolCallId: "tool-review",
          toolName: "reviewProposalsClient",
          suspendPayload: reviewInput,
        },
      } as any,
    ],
  };

  const pending = getLatestSuspendedToolCall([message]);

  assert.equal(pending?.toolCallId, "tool-review");
  assert.equal(pending?.toolName, "reviewProposalsClient");
  assert.equal(pending?.input.runId, "run-1");
});

test("getLatestSuspendedToolCall supports legacy camelCase suspension parts", () => {
  const message: RenameChatMessage = {
    id: "assistant-review-legacy",
    role: "assistant",
    parts: [
      {
        type: LEGACY_TOOL_CALL_SUSPENDED_PART_TYPE,
        data: {
          state: "data-tool-call-suspended",
          runId: "run-2",
          toolCallId: "tool-review-legacy",
          toolName: "reviewProposalsClient",
          suspendPayload: reviewInput,
        },
      } as any,
    ],
  };

  const pending = getLatestSuspendedToolCall([message]);

  assert.equal(pending?.toolCallId, "tool-review-legacy");
  assert.equal(pending?.toolName, "reviewProposalsClient");
});

test("review draft helpers preserve edited text and only bulk-approve safe changes", () => {
  const initialDraft = buildReviewDraft(reviewInput);
  const safeApprovedDraft = approveSafeChanges(reviewInput, initialDraft);
  safeApprovedDraft["safe-change"] = {
    ...safeApprovedDraft["safe-change"],
    editedText: "Acme Core Premium",
  };

  const reviewOutput = buildReviewOutput(reviewInput, safeApprovedDraft, false);

  assert.equal(countApproved(safeApprovedDraft), 1);
  assert.equal(safeApprovedDraft["safe-change"]?.approved, true);
  assert.equal(safeApprovedDraft["risky-change"]?.approved, false);
  assert.deepEqual(reviewOutput.approvals, [
    {
      changeId: "safe-change",
      approved: true,
      editedText: "Acme Core Premium",
      reviewerNote: undefined,
    },
    {
      changeId: "risky-change",
      approved: false,
      editedText: undefined,
      reviewerNote: undefined,
    },
  ]);
});

test("getToolError parses structured debug errors from tool parts", () => {
  const message: RenameChatMessage = {
    id: "assistant-tool-error",
    role: "assistant",
    parts: [
      {
        type: "tool-discoverCandidatesClient",
        toolCallId: "tool-1",
        state: "output-error",
        errorText: JSON.stringify({
          message: "Search failed",
          code: "discover_candidates_failed",
          phase: "searching-contentful",
          details: ["query: porter"],
        }),
      } as any,
    ],
  };

  const error = getToolError(message);

  assert.equal(error?.message, "Search failed");
  assert.equal(error?.code, "discover_candidates_failed");
  assert.equal(error?.phase, "searching-contentful");
});

test("getLatestAgentTrace returns the latest streamed agent trace data", () => {
  const message: RenameChatMessage = {
    id: "assistant-trace",
    role: "assistant",
    parts: [
      {
        type: "data-tool-agent",
        data: {
          status: "running",
          text: "Working",
          reasoning: ["Thinking..."],
          warnings: [],
          toolCalls: [],
          toolResults: [],
          steps: [],
        },
      } as any,
    ],
  };

  const trace = getLatestAgentTrace([message]);

  assert.equal(trace?.status, "running");
  assert.equal(trace?.reasoning[0], "Thinking...");
});
