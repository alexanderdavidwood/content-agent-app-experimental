import {
  type ApprovedChange,
  type ApplyApprovedChangesToolInput,
  type DiscoverCandidatesToolInput,
  type DiscoverCandidatesToolOutput,
  type ProposedChange,
  type ReviewProposalsToolInput,
  type ReviewProposalsToolOutput,
  applyApprovedChangesToolInputSchema,
  applyApprovedChangesToolOutputSchema,
  discoverCandidatesToolInputSchema,
  discoverCandidatesToolOutputSchema,
  reviewProposalsToolInputSchema,
  reviewProposalsToolOutputSchema,
} from "@contentful-rename/shared";

import type { RenameChatMessage } from "./chatTypes";
import {
  toolCallApprovalDataSchema,
  toolCallSuspendedDataSchema,
} from "./chatTypes";

export type ReviewDraftItem = {
  approved: boolean;
  editedText: string;
  reviewerNote?: string;
  isEditing: boolean;
};

export type ReviewDraftMap = Record<string, ReviewDraftItem>;

export type SuspendedToolCall =
  | {
      toolName: "discoverCandidatesClient";
      runId: string;
      toolCallId: string;
      input: DiscoverCandidatesToolInput;
    }
  | {
      toolName: "reviewProposalsClient";
      runId: string;
      toolCallId: string;
      input: ReviewProposalsToolInput;
    }
  | {
      toolName: "applyApprovedChangesClient";
      runId: string;
      toolCallId: string;
      input: ApplyApprovedChangesToolInput;
    };

type LatestToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export function buildWelcomeMessage(): RenameChatMessage {
  return {
    id: "assistant-welcome",
    role: "assistant",
    parts: [
      {
        type: "text",
        text:
          'Describe the rename you want to explore, for example: Rename "Acme Lite" to "Acme Core", search marketing pages first, and wait for approval before applying.',
      },
    ],
  };
}

export function getMessageText(message: RenameChatMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}

export function getLatestToolPart(
  message: RenameChatMessage | undefined,
): LatestToolPart | null {
  if (!message || message.role !== "assistant") {
    return null;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
      continue;
    }

    return {
      type: part.type,
      toolCallId: (part as any).toolCallId,
      state: (part as any).state,
      input: (part as any).input,
      output: (part as any).output,
      errorText: (part as any).errorText,
    };
  }

  return null;
}

function suspendedToolPartFromMessage(message: RenameChatMessage | undefined) {
  if (!message || message.role !== "assistant") {
    return null;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part.type === "data-toolCallSuspended") {
      return toolCallSuspendedDataSchema.parse((part as any).data);
    }
    if (part.type === "data-toolCallApproval") {
      return toolCallApprovalDataSchema.parse((part as any).data);
    }
  }

  return null;
}

export function getLatestSuspendedToolCall(
  messages: RenameChatMessage[],
): SuspendedToolCall | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const data = suspendedToolPartFromMessage(messages[messageIndex]);
    if (!data || data.state !== "data-tool-call-suspended") {
      continue;
    }

    switch (data.toolName) {
      case "discoverCandidatesClient":
        return {
          toolName: data.toolName,
          runId: data.runId,
          toolCallId: data.toolCallId,
          input: discoverCandidatesToolInputSchema.parse(data.suspendPayload),
        };
      case "reviewProposalsClient":
        return {
          toolName: data.toolName,
          runId: data.runId,
          toolCallId: data.toolCallId,
          input: reviewProposalsToolInputSchema.parse(data.suspendPayload),
        };
      case "applyApprovedChangesClient":
        return {
          toolName: data.toolName,
          runId: data.runId,
          toolCallId: data.toolCallId,
          input: applyApprovedChangesToolInputSchema.parse(data.suspendPayload),
        };
      default:
        break;
    }
  }

  return null;
}

export function isProposalSafe(change: ProposedChange) {
  return change.riskFlags.length === 0 && change.confidence >= 0.8;
}

export function buildReviewDraft(
  input: ReviewProposalsToolInput,
): ReviewDraftMap {
  return Object.fromEntries(
    input.proposedChanges.map((change) => [
      change.changeId,
      {
        approved: false,
        editedText: change.proposedText,
        reviewerNote: undefined,
        isEditing: false,
      },
    ]),
  );
}

export function buildReviewOutput(
  input: ReviewProposalsToolInput,
  draft: ReviewDraftMap,
  cancelled = false,
): ReviewProposalsToolOutput {
  const approvals: ApprovedChange[] = input.proposedChanges.map((change) => {
    const next = draft[change.changeId];
    return {
      changeId: change.changeId,
      approved: next?.approved ?? false,
      editedText:
        next && next.editedText !== change.proposedText
          ? next.editedText
          : undefined,
      reviewerNote: next?.reviewerNote || undefined,
    };
  });

  return reviewProposalsToolOutputSchema.parse({
    runId: input.runId,
    approvals,
    cancelled,
  });
}

export function countApproved(draft: ReviewDraftMap) {
  return Object.values(draft).filter((entry) => entry.approved).length;
}

export function approveSafeChanges(
  input: ReviewProposalsToolInput,
  draft: ReviewDraftMap,
) {
  const nextDraft = { ...draft };

  for (const change of input.proposedChanges) {
    if (isProposalSafe(change)) {
      nextDraft[change.changeId] = {
        ...(nextDraft[change.changeId] ?? {
          approved: false,
          editedText: change.proposedText,
          reviewerNote: undefined,
          isEditing: false,
        }),
        approved: true,
      };
    }
  }

  return nextDraft;
}

export function getToolError(message: RenameChatMessage) {
  const toolPart = getLatestToolPart(message);
  if (toolPart?.state !== "output-error") {
    return null;
  }

  return {
    toolName: toolPart.type.slice(5),
    message: toolPart.errorText ?? "This step failed.",
  };
}

export function parseDiscoverCandidatesOutput(
  output: unknown,
): DiscoverCandidatesToolOutput {
  return discoverCandidatesToolOutputSchema.parse(output);
}

export function parseApplyApprovedChangesOutput(output: unknown) {
  return applyApprovedChangesToolOutputSchema.parse(output);
}
