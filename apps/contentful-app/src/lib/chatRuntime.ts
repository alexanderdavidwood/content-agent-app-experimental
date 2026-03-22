import {
  createChatDebugError,
  parseChatDebugError,
  type AgentTraceData,
  type ApprovedChange,
  type ProposedChange,
  type ReviewProposalsToolInput,
  type ReviewProposalsToolOutput,
  reviewProposalsToolInputSchema,
  reviewProposalsToolOutputSchema,
} from "@contentful-rename/shared";

import { getSuspendedClientToolDefinition } from "./clientToolRegistry";
import type { RenameChatMessage, RenameChatTools } from "./chatTypes";
import {
  LEGACY_TOOL_CALL_APPROVAL_PART_TYPE,
  LEGACY_TOOL_CALL_SUSPENDED_PART_TYPE,
  TOOL_CALL_APPROVAL_PART_TYPE,
  TOOL_CALL_SUSPENDED_PART_TYPE,
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

type SuspendedToolName = Exclude<
  keyof RenameChatTools,
  "draftProposals" | "extractSearchFilters"
>;

export type SuspendedToolCall = {
  [Name in SuspendedToolName]: {
    toolName: Name;
    runId: string;
    toolCallId: string;
    input: RenameChatTools[Name]["input"];
  };
}[SuspendedToolName];

type LatestToolPart = {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type ToolPartSummary = {
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
          'Ask for a rename or inspect the space first. Examples: "Rename Acme Lite to Acme Core and wait for approval before applying", "What locales are available here?", "Inspect content types for landing pages", or "Find draft landing pages about Acme updated last week."',
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

export function getReasoningText(message: RenameChatMessage) {
  return message.parts
    .map((part) => (part.type === "reasoning" ? part.text : ""))
    .join("")
    .trim();
}

export function getToolParts(message: RenameChatMessage): ToolPartSummary[] {
  if (message.role !== "assistant") {
    return [];
  }

  return message.parts.flatMap((part) => {
    if (typeof part.type !== "string" || !part.type.startsWith("tool-")) {
      return [];
    }

    return [
      {
        type: part.type,
        toolCallId: (part as any).toolCallId,
        state: (part as any).state,
        input: (part as any).input,
        output: (part as any).output,
        errorText: (part as any).errorText,
      },
    ];
  });
}

export function getLatestToolPart(
  message: RenameChatMessage | undefined,
): LatestToolPart | null {
  if (!message || message.role !== "assistant") {
    return null;
  }

  return getToolParts(message).at(-1) ?? null;
}

function suspendedToolPartFromMessage(message: RenameChatMessage | undefined) {
  if (!message || message.role !== "assistant") {
    return null;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    const partType = String(part.type);
    if (
      partType === TOOL_CALL_SUSPENDED_PART_TYPE ||
      partType === LEGACY_TOOL_CALL_SUSPENDED_PART_TYPE
    ) {
      return toolCallSuspendedDataSchema.parse((part as any).data);
    }
    if (
      partType === TOOL_CALL_APPROVAL_PART_TYPE ||
      partType === LEGACY_TOOL_CALL_APPROVAL_PART_TYPE
    ) {
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

    const definition = getSuspendedClientToolDefinition(data.toolName);
    if (!definition) {
      continue;
    }

    return {
      toolName: definition.toolName,
      runId: data.runId,
      toolCallId: data.toolCallId,
      input: definition.parseInput(data.suspendPayload),
    } as SuspendedToolCall;
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

  const parsed = parseChatDebugError(toolPart.errorText);

  return parsed ?? createChatDebugError(toolPart.errorText ?? "This step failed.", {
    toolName: toolPart.type.slice(5),
  });
}

export function getLatestAgentTrace(
  messages: RenameChatMessage[],
): AgentTraceData | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") {
      continue;
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part.type === "data-tool-agent") {
        return (part as any).data as AgentTraceData;
      }
    }
  }

  return null;
}
