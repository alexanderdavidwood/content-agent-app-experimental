import { generateObject } from "ai";
import type {
  CandidateEntrySnapshot,
  DiscoveryQueryPlan,
  ProposedChange,
  RenameRunInput,
} from "@contentful-rename/shared";
import {
  discoveryQueryPlanSchema,
  proposedChangeSchema,
} from "@contentful-rename/shared";
import { z } from "zod";

import { getOpenAIModel } from "./model";
import {
  buildHeuristicDiscoveryPlan,
  buildHeuristicProposals,
} from "./renameHeuristics";
import { DISCOVERY_SYSTEM_PROMPT } from "../prompts/discovery";
import { PROPOSAL_SYSTEM_PROMPT } from "../prompts/proposals";

export async function buildDiscoveryPlan(
  input: RenameRunInput,
): Promise<DiscoveryQueryPlan> {
  if (!process.env.OPENAI_API_KEY) {
    return buildHeuristicDiscoveryPlan(input);
  }

  try {
    const result = await generateObject({
      model: getOpenAIModel(),
      schema: discoveryQueryPlanSchema,
      system: DISCOVERY_SYSTEM_PROMPT,
      prompt: JSON.stringify(input),
    });

    return result.object;
  } catch {
    return buildHeuristicDiscoveryPlan(input);
  }
}

export async function buildProposedChanges(
  input: RenameRunInput,
  candidates: CandidateEntrySnapshot[],
): Promise<ProposedChange[]> {
  if (!process.env.OPENAI_API_KEY) {
    return buildHeuristicProposals(input, candidates);
  }

  try {
    const result = await generateObject({
      model: getOpenAIModel(),
      schema: z.object({
        proposedChanges: z.array(proposedChangeSchema),
      }),
      system: PROPOSAL_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        input,
        candidates,
      }),
    });

    return result.object.proposedChanges;
  } catch {
    return buildHeuristicProposals(input, candidates);
  }
}
