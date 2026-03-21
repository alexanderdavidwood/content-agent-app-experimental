import { z } from "zod";
import type { UIMessage } from "ai";
import type {
  AgentTraceData,
  ApplyApprovedChangesToolInput,
  ApplyApprovedChangesToolOutput,
  ChatExecutionContext,
  DiscoverCandidatesToolInput,
  DiscoverCandidatesToolOutput,
  DraftProposalsToolInput,
  DraftProposalsToolOutput,
  ReviewProposalsToolInput,
  ReviewProposalsToolOutput,
} from "@contentful-rename/shared";
import {
  agentTraceDataSchema,
  chatExecutionContextSchema,
} from "@contentful-rename/shared";

export const chatMemorySchema = z.object({
  thread: z.string().min(1),
  resource: z.string().min(1),
});

export const toolCallSuspendedDataSchema = z.object({
  state: z.literal("data-tool-call-suspended"),
  runId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  suspendPayload: z.unknown(),
  resumeSchema: z.unknown().optional(),
});

export const toolCallApprovalDataSchema = z.object({
  state: z.literal("data-tool-call-approval"),
  runId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.unknown(),
  resumeSchema: z.unknown().optional(),
});

export const TOOL_CALL_SUSPENDED_PART_TYPE = "data-tool-call-suspended";
export const TOOL_CALL_APPROVAL_PART_TYPE = "data-tool-call-approval";
export const LEGACY_TOOL_CALL_SUSPENDED_PART_TYPE = "data-toolCallSuspended";
export const LEGACY_TOOL_CALL_APPROVAL_PART_TYPE = "data-toolCallApproval";

export type RenameChatDataParts = {
  "tool-call-suspended": z.infer<typeof toolCallSuspendedDataSchema>;
  "tool-call-approval": z.infer<typeof toolCallApprovalDataSchema>;
  "tool-agent": AgentTraceData;
};

export type RenameChatTools = {
  discoverCandidatesClient: {
    input: DiscoverCandidatesToolInput;
    output: DiscoverCandidatesToolOutput;
  };
  draftProposals: {
    input: DraftProposalsToolInput;
    output: DraftProposalsToolOutput;
  };
  reviewProposalsClient: {
    input: ReviewProposalsToolInput;
    output: ReviewProposalsToolOutput;
  };
  applyApprovedChangesClient: {
    input: ApplyApprovedChangesToolInput;
    output: ApplyApprovedChangesToolOutput;
  };
};

export type RenameChatMessage = UIMessage<
  Record<string, unknown>,
  RenameChatDataParts,
  RenameChatTools
>;

export const renameChatRequestBodySchema = z.object({
  requestContext: chatExecutionContextSchema,
  memory: chatMemorySchema,
});

export type RenameChatRequestBody = {
  requestContext: ChatExecutionContext;
  memory: z.infer<typeof chatMemorySchema>;
};

export const renameChatDataPartSchemas = {
  [TOOL_CALL_SUSPENDED_PART_TYPE]: toolCallSuspendedDataSchema,
  [TOOL_CALL_APPROVAL_PART_TYPE]: toolCallApprovalDataSchema,
  "data-tool-agent": agentTraceDataSchema,
} as const;
