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
  queries: z.array(z.string().min(1)).min(1).max(5),
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

export const chatArtifactSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "quick-start",
    "scan-plan",
    "index-status",
    "scan-status",
    "candidate-summary",
    "diff-review",
    "apply-summary",
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
export type ProposedChange = z.infer<typeof proposedChangeSchema>;
export type ApprovedChange = z.infer<typeof approvedChangeSchema>;
export type ApplyOperation = z.infer<typeof applyOperationSchema>;
export type ApplyResult = z.infer<typeof applyResultSchema>;
export type AppInstallationParameters = z.infer<
  typeof appInstallationParametersSchema
>;
export type SemanticEnsureIndexInput = z.infer<
  typeof semanticEnsureIndexInputSchema
>;
export type SemanticEnsureIndexResult = z.infer<
  typeof semanticEnsureIndexResultSchema
>;
export type SemanticSearchInput = z.infer<typeof semanticSearchInputSchema>;
export type SemanticSearchResult = z.infer<typeof semanticSearchResultSchema>;
export type ChatArtifact = z.infer<typeof chatArtifactSchema>;
export type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;
