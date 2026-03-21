import { z } from "zod";

import {
  APPLY_RESULT_STATUSES,
  CONTENTFUL_SUPPORTED_FIELD_TYPES,
  RISK_FLAGS,
} from "./contentTypes";

export const agentSurfaceContextSchema = z.object({
  surface: z.enum(["page", "agent"]),
  entryId: z.string().optional(),
  contentTypeId: z.string().optional(),
  lastFocusedFieldId: z.string().optional(),
});

export const discoveryQueryPlanSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
  aliases: z.array(z.string()).default([]),
  ignorePatterns: z.array(z.string()).default([]),
  riskNotes: z.array(z.string()).default([]),
});

export const richTextSegmentSchema = z.object({
  segmentId: z.string(),
  path: z.array(z.number().int().nonnegative()),
  text: z.string(),
  marks: z.array(z.string()),
});

export const candidateFieldSnapshotSchema = z.object({
  fieldId: z.string(),
  locale: z.string(),
  fieldType: z.enum(CONTENTFUL_SUPPORTED_FIELD_TYPES),
  rawValue: z.unknown(),
  segments: z.array(richTextSegmentSchema),
});

export const candidateEntrySnapshotSchema = z.object({
  entryId: z.string(),
  contentTypeId: z.string(),
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
  fields: z.array(candidateFieldSnapshotSchema),
});

export const renameRunInputSchema = z.object({
  oldProductName: z.string().min(1),
  newProductName: z.string().min(1),
  defaultLocale: z.string().min(1),
  searchMode: z.enum(["semantic", "keyword", "hybrid"]).default("semantic"),
  contentTypeIds: z.array(z.string()).default([]),
  userNotes: z.string().optional(),
  surfaceContext: agentSurfaceContextSchema.optional(),
});

export const renameChatRequestSchema = z.object({
  oldProductName: z.string().min(1),
  newProductName: z.string().min(1),
  userNotes: z.string().optional(),
});

export const renameRunPhaseSchema = z.enum([
  "parsing-request",
  "planning-search",
  "searching-contentful",
  "reviewing-proposed-changes",
  "applying-approved-changes",
  "completed",
  "error",
]);

export const proposedChangeSchema = z.object({
  changeId: z.string(),
  entryId: z.string(),
  fieldId: z.string(),
  locale: z.string(),
  segmentId: z.string().optional(),
  originalText: z.string(),
  proposedText: z.string(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  riskFlags: z.array(z.enum(RISK_FLAGS)).default([]),
});

export const approvedChangeSchema = z.object({
  changeId: z.string(),
  approved: z.boolean(),
  editedText: z.string().optional(),
  reviewerNote: z.string().optional(),
});

export const applyOperationSchema = z.object({
  entryId: z.string(),
  version: z.number().int().nonnegative(),
  fieldId: z.string(),
  locale: z.string(),
  segmentId: z.string().optional(),
  nextValue: z.unknown(),
});

export const applyResultSchema = z.object({
  entryId: z.string(),
  status: z.enum(APPLY_RESULT_STATUSES),
  newVersion: z.number().int().nonnegative().optional(),
  message: z.string().optional(),
});

export const appInstallationParametersSchema = z.object({
  mastraBaseUrl: z.string().url(),
  allowedContentTypes: z.array(z.string()).default([]),
  maxDiscoveryQueries: z.number().int().positive().max(5).default(5),
  maxCandidatesPerRun: z.number().int().positive().max(100).default(30),
  defaultDryRun: z.boolean().default(true),
  toolAvailability: z
    .object({
      semanticSearch: z.boolean().default(true),
    })
    .default({
      semanticSearch: true,
    }),
});

export const chatExecutionContextSchema = z.object({
  defaultLocale: z.string().min(1),
  surfaceContext: agentSurfaceContextSchema.optional(),
  allowedContentTypes: z.array(z.string()).default([]),
  maxDiscoveryQueries: z.number().int().positive().max(5).default(5),
  maxCandidatesPerRun: z.number().int().positive().max(100).default(30),
  toolAvailability: z
    .object({
      semanticSearch: z.boolean().default(true),
    })
    .default({
      semanticSearch: true,
    }),
});

export const semanticEnsureIndexInputSchema = z.object({
  locale: z.string().min(1),
  createIfMissing: z.boolean().default(false),
});

export const semanticEnsureIndexResultSchema = z.object({
  status: z.enum(["ACTIVE", "PENDING", "MISSING", "UNSUPPORTED"]),
  locale: z.string(),
  indexId: z.string().optional(),
  warning: z.string().optional(),
});

export const semanticSearchInputSchema = z.object({
  mode: z.enum(["semantic", "keyword", "hybrid"]).default("semantic"),
  queries: z.array(z.string().min(1)).min(1).max(10),
  limitPerQuery: z.number().int().positive().max(10).default(10),
});

export const semanticSearchResultSchema = z.object({
  entryIds: z.array(z.string()),
  queryHits: z.array(
    z.object({
      query: z.string(),
      entryIds: z.array(z.string()),
      warning: z.string().optional(),
    }),
  ),
  warnings: z.array(z.string()).default([]),
});

export const renameRunSummarySchema = z.object({
  runId: z.string(),
  phase: renameRunPhaseSchema,
  defaultLocale: z.string().min(1),
  surface: z.enum(["page", "agent"]).optional(),
  oldProductName: z.string().optional(),
  newProductName: z.string().optional(),
  candidateCount: z.number().int().nonnegative().default(0),
  proposedChangeCount: z.number().int().nonnegative().default(0),
  approvedChangeCount: z.number().int().nonnegative().default(0),
  appliedCount: z.number().int().nonnegative().default(0),
  failedCount: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
});

export const chatMessageMetadataSchema = z.object({
  runId: z.string().optional(),
  phase: renameRunPhaseSchema.optional(),
});

export const chatRunErrorSchema = z.object({
  runId: z.string().optional(),
  phase: renameRunPhaseSchema.optional(),
  message: z.string().min(1),
  retryable: z.boolean().default(false),
});

export const chatDebugErrorSchema = z.object({
  message: z.string().min(1),
  name: z.string().optional(),
  code: z.string().optional(),
  phase: renameRunPhaseSchema.optional(),
  toolName: z.string().optional(),
  retryable: z.boolean().default(false),
  details: z.array(z.string()).default([]),
  stack: z.string().optional(),
});

const agentTraceUsageSchema = z
  .object({
    inputTokens: z.number().nullable().optional(),
    outputTokens: z.number().nullable().optional(),
    totalTokens: z.number().nullable().optional(),
    reasoningTokens: z.number().nullable().optional(),
    cachedInputTokens: z.number().nullable().optional(),
  })
  .passthrough();

export const agentTraceToolCallSchema = z
  .object({
    type: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    args: z.unknown().optional(),
    dynamic: z.boolean().optional(),
    providerExecuted: z.boolean().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();

export const agentTraceToolResultSchema = z
  .object({
    type: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
    result: z.unknown().optional(),
    output: z.unknown().optional(),
    isError: z.boolean().optional(),
    dynamic: z.boolean().optional(),
    errorText: z.string().optional(),
    payload: z.unknown().optional(),
  })
  .passthrough();

export const agentTraceStepSchema = z
  .object({
    stepType: z.string().optional(),
    text: z.string().optional(),
    reasoningText: z.string().optional(),
    finishReason: z.string().nullable().optional(),
    warnings: z.array(z.unknown()).default([]),
    staticToolCalls: z.array(agentTraceToolCallSchema).default([]),
    dynamicToolCalls: z.array(agentTraceToolCallSchema).default([]),
    staticToolResults: z.array(agentTraceToolResultSchema).default([]),
    dynamicToolResults: z.array(agentTraceToolResultSchema).default([]),
    usage: agentTraceUsageSchema.nullable().optional(),
    response: z
      .object({
        id: z.string().optional(),
        modelId: z.string().optional(),
        timestamp: z.union([z.string(), z.date()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const agentTraceDataSchema = z
  .object({
    id: z.string().optional(),
    status: z.enum(["running", "finished"]).optional(),
    text: z.string().default(""),
    reasoning: z.array(z.string()).default([]),
    warnings: z.array(z.unknown()).default([]),
    toolCalls: z.array(agentTraceToolCallSchema).default([]),
    toolResults: z.array(agentTraceToolResultSchema).default([]),
    steps: z.array(agentTraceStepSchema).default([]),
    finishReason: z.string().nullable().optional(),
    usage: agentTraceUsageSchema.nullable().optional(),
    response: z
      .object({
        id: z.string().optional(),
        modelId: z.string().optional(),
        timestamp: z.union([z.string(), z.date()]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const discoverCandidatesToolInputSchema = z.object({
  runId: z.string(),
  input: renameRunInputSchema,
  discoveryPlan: discoveryQueryPlanSchema,
  maxCandidatesPerRun: z.number().int().positive().max(100),
});

export const discoverCandidatesToolOutputSchema = z.object({
  runId: z.string(),
  indexStatus: semanticEnsureIndexResultSchema.nullable().optional(),
  searchResult: semanticSearchResultSchema,
  candidateSnapshots: z.array(candidateEntrySnapshotSchema),
});

export const draftProposalsToolInputSchema = z.object({
  runId: z.string(),
  input: renameRunInputSchema,
  candidateSnapshots: z.array(candidateEntrySnapshotSchema),
});

export const draftProposalsToolOutputSchema = z.object({
  runId: z.string(),
  proposedChanges: z.array(proposedChangeSchema),
});

export const reviewProposalsToolInputSchema = z.object({
  runId: z.string(),
  input: renameRunInputSchema,
  proposedChanges: z.array(proposedChangeSchema),
  candidateSnapshots: z.array(candidateEntrySnapshotSchema),
});

export const reviewProposalsToolOutputSchema = z.object({
  runId: z.string(),
  approvals: z.array(approvedChangeSchema),
  cancelled: z.boolean().default(false),
});

export const applyApprovedChangesToolInputSchema = z.object({
  runId: z.string(),
  input: renameRunInputSchema,
  candidateSnapshots: z.array(candidateEntrySnapshotSchema),
  proposedChanges: z.array(proposedChangeSchema),
  approvals: z.array(approvedChangeSchema),
});

export const applyApprovedChangesToolOutputSchema = z.object({
  runId: z.string(),
  results: z.array(applyResultSchema),
});

export const chatArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "intake-hint",
    "quick-start",
    "scan-plan",
    "index-status",
    "phase-status",
    "scan-status",
    "candidate-summary",
    "diff-review",
    "review-batch",
    "apply-summary",
    "completion-summary",
    "error-summary",
  ]),
  title: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

export const chatEnvelopeSchema = z.object({
  runId: z.string().optional(),
  content: z.string(),
  discoveryPlan: discoveryQueryPlanSchema.optional(),
  artifacts: z.array(chatArtifactSchema).default([]),
});

export type AgentSurfaceContext = z.infer<typeof agentSurfaceContextSchema>;
export type DiscoveryQueryPlan = z.infer<typeof discoveryQueryPlanSchema>;
export type CandidateFieldSnapshot = z.infer<typeof candidateFieldSnapshotSchema>;
export type CandidateEntrySnapshot = z.infer<typeof candidateEntrySnapshotSchema>;
export type RenameRunInput = z.infer<typeof renameRunInputSchema>;
export type RenameChatRequest = z.infer<typeof renameChatRequestSchema>;
export type RenameRunPhase = z.infer<typeof renameRunPhaseSchema>;
export type ProposedChange = z.infer<typeof proposedChangeSchema>;
export type ApprovedChange = z.infer<typeof approvedChangeSchema>;
export type ApplyOperation = z.infer<typeof applyOperationSchema>;
export type ApplyResult = z.infer<typeof applyResultSchema>;
export type AppInstallationParameters = z.infer<
  typeof appInstallationParametersSchema
>;
export type ChatExecutionContext = z.infer<typeof chatExecutionContextSchema>;
export type ToolAvailability = z.infer<
  typeof appInstallationParametersSchema.shape.toolAvailability
>;
export type SemanticEnsureIndexInput = z.infer<
  typeof semanticEnsureIndexInputSchema
>;
export type SemanticEnsureIndexResult = z.infer<
  typeof semanticEnsureIndexResultSchema
>;
export type SemanticSearchInput = z.infer<typeof semanticSearchInputSchema>;
export type SemanticSearchResult = z.infer<typeof semanticSearchResultSchema>;
export type RenameRunSummary = z.infer<typeof renameRunSummarySchema>;
export type ChatMessageMetadata = z.infer<typeof chatMessageMetadataSchema>;
export type ChatRunError = z.infer<typeof chatRunErrorSchema>;
export type ChatDebugError = z.infer<typeof chatDebugErrorSchema>;
export type DiscoverCandidatesToolInput = z.infer<
  typeof discoverCandidatesToolInputSchema
>;
export type DiscoverCandidatesToolOutput = z.infer<
  typeof discoverCandidatesToolOutputSchema
>;
export type DraftProposalsToolInput = z.infer<
  typeof draftProposalsToolInputSchema
>;
export type DraftProposalsToolOutput = z.infer<
  typeof draftProposalsToolOutputSchema
>;
export type ReviewProposalsToolInput = z.infer<
  typeof reviewProposalsToolInputSchema
>;
export type ReviewProposalsToolOutput = z.infer<
  typeof reviewProposalsToolOutputSchema
>;
export type ApplyApprovedChangesToolInput = z.infer<
  typeof applyApprovedChangesToolInputSchema
>;
export type ApplyApprovedChangesToolOutput = z.infer<
  typeof applyApprovedChangesToolOutputSchema
>;
export type AgentTraceToolCall = z.infer<typeof agentTraceToolCallSchema>;
export type AgentTraceToolResult = z.infer<typeof agentTraceToolResultSchema>;
export type AgentTraceStep = z.infer<typeof agentTraceStepSchema>;
export type AgentTraceData = z.infer<typeof agentTraceDataSchema>;
export type ChatArtifact = z.infer<typeof chatArtifactSchema>;
export type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;
