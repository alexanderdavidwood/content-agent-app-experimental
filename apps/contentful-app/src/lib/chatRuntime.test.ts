import assert from "node:assert/strict";
import test from "node:test";

import {
  approveSafeChanges,
  buildReviewDraft,
  buildReviewOutput,
  buildWelcomeMessage,
  countApproved,
  getLatestSuspendedToolCall,
} from "./chatRuntime";
import type { RenameChatMessage } from "./chatTypes";

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
        type: "data-toolCallSuspended",
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
