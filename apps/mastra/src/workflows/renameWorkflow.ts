import { createStep, createWorkflow } from "@mastra/core/workflows";
import {
  approvedChangeSchema,
  candidateEntrySnapshotSchema,
  proposedChangeSchema,
  renameRunInputSchema,
} from "@contentful-rename/shared";
import { z } from "zod";

import { buildProposedChanges } from "../lib/renameEngine";

const workflowInputSchema = z.object({
  input: renameRunInputSchema,
  candidates: z.array(candidateEntrySnapshotSchema),
});

const generateProposalsStep = createStep({
  id: "generate-proposals",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    proposedChanges: z.array(proposedChangeSchema),
  }),
  execute: async ({ inputData }) => {
    return {
      proposedChanges: await buildProposedChanges(
        inputData.input,
        inputData.candidates,
      ),
    };
  },
});

const approvalStep = createStep({
  id: "await-approval",
  inputSchema: z.object({
    proposedChanges: z.array(proposedChangeSchema),
  }),
  outputSchema: z.object({
    approvedChangeIds: z.array(z.string()),
    proposedChanges: z.array(proposedChangeSchema),
  }),
  resumeSchema: z.object({
    approvals: z.array(approvedChangeSchema),
  }),
  suspendSchema: z
    .object({
      reason: z.string(),
    })
    .passthrough(),
  execute: async ({ inputData, suspend, resumeData }) => {
    if (!resumeData) {
      return suspend({
        reason: "Awaiting user approval from the Contentful review panel.",
      });
    }

    return {
      approvedChangeIds: resumeData.approvals
        .filter((approval) => approval.approved)
        .map((approval) => approval.changeId),
      proposedChanges: inputData.proposedChanges,
    };
  },
});

export const renameWorkflow = createWorkflow({
  id: "rename-workflow",
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    approvedChangeIds: z.array(z.string()),
    proposedChanges: z.array(proposedChangeSchema),
  }),
})
  .then(generateProposalsStep)
  .then(approvalStep)
  .commit();
