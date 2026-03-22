import assert from "node:assert/strict";
import test from "node:test";
import { RequestContext } from "@mastra/core/request-context";
import type { ChatExecutionContext } from "@contentful-rename/shared";
import { extractSearchFiltersToolOutputSchema } from "@contentful-rename/shared";

import { extractSearchFiltersTool } from "./searchTools";

const chatContext: ChatExecutionContext = {
  defaultLocale: "en-US",
  timeZone: "UTC",
  currentDate: "2026-03-22",
  allowedContentTypes: ["landingPage", "blogPost"],
  maxDiscoveryQueries: 5,
  maxCandidatesPerRun: 30,
  toolAvailability: {
    semanticSearch: true,
    entrySearch: true,
    preApplyValidation: true,
  },
};

function createRequestContext(overrides: Partial<ChatExecutionContext> = {}) {
  const requestContext = new RequestContext<ChatExecutionContext>();
  const resolved = {
    ...chatContext,
    ...overrides,
  };
  requestContext.set("defaultLocale", resolved.defaultLocale);
  requestContext.set("timeZone", resolved.timeZone);
  requestContext.set("currentDate", resolved.currentDate);
  requestContext.set("allowedContentTypes", resolved.allowedContentTypes);
  requestContext.set("maxDiscoveryQueries", resolved.maxDiscoveryQueries);
  requestContext.set("maxCandidatesPerRun", resolved.maxCandidatesPerRun);
  requestContext.set("toolAvailability", resolved.toolAvailability);
  if (resolved.surfaceContext) {
    requestContext.set("surfaceContext", resolved.surfaceContext);
  }
  return requestContext;
}

test("extractSearchFiltersTool builds structured filters from a free-form search request", async () => {
  delete process.env.OPENAI_API_KEY;

  const result = extractSearchFiltersToolOutputSchema.parse(
    await extractSearchFiltersTool.execute!(
    {
      userQuery: "find draft landing pages about Acme updated last week",
    },
    {
      requestContext: createRequestContext(),
    } as any,
    ),
  );

  assert.equal(result.filters.status, "draft");
  assert.deepEqual(result.filters.contentTypeIds, ["landingPage"]);
  assert.equal(result.filters.queryText, "Acme");
  assert.equal(result.filters.updatedAtFrom, "2026-03-15");
  assert.equal(result.filters.updatedAtTo, "2026-03-22");
});

test("extractSearchFiltersTool clips explicit content type ids to the allowed list", async () => {
  delete process.env.OPENAI_API_KEY;

  const result = extractSearchFiltersToolOutputSchema.parse(
    await extractSearchFiltersTool.execute!(
    {
      userQuery: "find content types landingPage and blogPost about Acme",
    },
    {
      requestContext: createRequestContext({
        allowedContentTypes: ["landingPage"],
      }),
    } as any,
    ),
  );

  assert.deepEqual(result.filters.contentTypeIds, ["landingPage"]);
  assert.match(result.warnings[0] ?? "", /not allowed/i);
});
