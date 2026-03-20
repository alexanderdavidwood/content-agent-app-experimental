import assert from "node:assert/strict";
import test from "node:test";
import { RequestContext } from "@mastra/core/request-context";
import type {
  ChatExecutionContext,
  ReviewProposalsToolInput,
} from "@contentful-rename/shared";
import {
  discoverCandidatesToolInputSchema,
  draftProposalsToolOutputSchema,
  reviewProposalsToolOutputSchema,
} from "@contentful-rename/shared";

import {
  discoverCandidatesClientTool,
  draftProposalsTool,
  reviewProposalsClientTool,
} from "./renameTools";

const chatContext: ChatExecutionContext = {
  defaultLocale: "en-US",
  surfaceContext: { surface: "page" },
  allowedContentTypes: ["page"],
  maxDiscoveryQueries: 5,
  maxCandidatesPerRun: 30,
};

function createRequestContext() {
  const requestContext = new RequestContext<ChatExecutionContext>();
  requestContext.set("defaultLocale", chatContext.defaultLocale);
  requestContext.set("surfaceContext", chatContext.surfaceContext);
  requestContext.set("allowedContentTypes", chatContext.allowedContentTypes);
  requestContext.set("maxDiscoveryQueries", chatContext.maxDiscoveryQueries);
  requestContext.set("maxCandidatesPerRun", chatContext.maxCandidatesPerRun);
  return requestContext;
}

test("discoverCandidatesClientTool suspends with a client search payload", async () => {
  delete process.env.OPENAI_API_KEY;
  let suspendedPayload: unknown;

  await discoverCandidatesClientTool.execute!(
    {
      oldProductName: "Acme Lite",
      newProductName: "Acme Core",
    },
    {
      requestContext: createRequestContext(),
      agent: {
        toolCallId: "tool-discover",
        messages: [],
        suspend: async (payload: unknown) => {
          suspendedPayload = payload;
        },
      },
    } as any,
  );

  const parsed = discoverCandidatesToolInputSchema.parse(suspendedPayload);
  assert.equal(parsed.input.oldProductName, "Acme Lite");
  assert.equal(parsed.input.newProductName, "Acme Core");
  assert.equal(parsed.input.defaultLocale, "en-US");
  assert.equal(parsed.input.surfaceContext?.surface, "page");
});

test("draftProposalsTool creates proposed changes from candidate snapshots", async () => {
  delete process.env.OPENAI_API_KEY;

  const result = await draftProposalsTool.execute!(
    {
      runId: "run-1",
      input: {
        oldProductName: "Acme Lite",
        newProductName: "Acme Core",
        defaultLocale: "en-US",
        searchMode: "semantic",
        contentTypeIds: ["page"],
      },
      candidateSnapshots: [
        {
          entryId: "entry-1",
          contentTypeId: "page",
          version: 4,
          updatedAt: new Date().toISOString(),
          fields: [
            {
              fieldId: "title",
              locale: "en-US",
              fieldType: "Text",
              rawValue: "Acme Lite",
              segments: [],
            },
          ],
        },
      ],
    },
    {} as any,
  );

  const parsed = draftProposalsToolOutputSchema.parse(result);
  assert.equal(parsed.runId, "run-1");
  assert.equal(parsed.proposedChanges.length, 1);
  assert.equal(parsed.proposedChanges[0]?.proposedText, "Acme Core");
});

test("reviewProposalsClientTool returns validated review data on resume", async () => {
  const reviewInput: ReviewProposalsToolInput = {
    runId: "run-1",
    input: {
      oldProductName: "Acme Lite",
      newProductName: "Acme Core",
      defaultLocale: "en-US",
      searchMode: "semantic",
      contentTypeIds: [],
    },
    proposedChanges: [],
    candidateSnapshots: [],
  };

  const result = await reviewProposalsClientTool.execute!(reviewInput, {
    requestContext: createRequestContext(),
    agent: {
      toolCallId: "tool-review",
      messages: [],
      resumeData: {
        runId: "run-1",
        approvals: [],
        cancelled: true,
      },
      suspend: async () => {},
    },
  } as any);

  assert.deepEqual(
    result,
    reviewProposalsToolOutputSchema.parse({
      runId: "run-1",
      approvals: [],
      cancelled: true,
    }),
  );
});
