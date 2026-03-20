import { z } from "zod";
import type { UIMessage } from "ai";
import type {
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
import { chatExecutionContextSchema } from "@contentful-rename/shared";

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

export type RenameChatDataParts = {
  toolCallSuspended: z.infer<typeof toolCallSuspendedDataSchema>;
  toolCallApproval: z.infer<typeof toolCallApprovalDataSchema>;
  toolAgent: unknown;
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
  "data-tool-call-suspended": toolCallSuspendedDataSchema,
  "data-tool-call-approval": toolCallApprovalDataSchema,
  "data-tool-agent": z.unknown(),
} as const;
