import assert from "node:assert/strict";
import test from "node:test";
import { RequestContext } from "@mastra/core/request-context";
import type { ChatExecutionContext } from "@contentful-rename/shared";
import {
  getEntryDetailsToolInputSchema,
  listContentTypesToolInputSchema,
  readEntriesToolInputSchema,
  updateEntryAndPublishToolOutputSchema,
} from "@contentful-rename/shared";

import {
  getEntryDetailsClientTool,
  listContentTypesClientTool,
  readEntriesClientTool,
  updateEntryAndPublishClientTool,
} from "./contentTools";

const chatContext: ChatExecutionContext = {
  defaultLocale: "en-US",
  surfaceContext: { surface: "page" },
  allowedContentTypes: ["page"],
  maxDiscoveryQueries: 5,
  maxCandidatesPerRun: 30,
  toolAvailability: {
    semanticSearch: true,
  },
};

function createRequestContext() {
  const requestContext = new RequestContext<ChatExecutionContext>();
  requestContext.set("defaultLocale", chatContext.defaultLocale);
  requestContext.set("surfaceContext", chatContext.surfaceContext);
  requestContext.set("allowedContentTypes", chatContext.allowedContentTypes);
  requestContext.set("maxDiscoveryQueries", chatContext.maxDiscoveryQueries);
  requestContext.set("maxCandidatesPerRun", chatContext.maxCandidatesPerRun);
  requestContext.set("toolAvailability", chatContext.toolAvailability);
  return requestContext;
}

test("listContentTypesClientTool suspends with validated content type lookup input", async () => {
  let suspendedPayload: unknown;

  await listContentTypesClientTool.execute!(
    {
      contentTypeIds: ["page"],
      includeFields: true,
      limit: 10,
    },
    {
      requestContext: createRequestContext(),
      agent: {
        toolCallId: "tool-list-content-types",
        messages: [],
        suspend: async (payload: unknown) => {
          suspendedPayload = payload;
        },
      },
    } as any,
  );

  const parsed = listContentTypesToolInputSchema.parse(suspendedPayload);
  assert.deepEqual(parsed.contentTypeIds, ["page"]);
  assert.equal(parsed.includeFields, true);
  assert.equal(parsed.limit, 10);
});

test("getEntryDetailsClientTool defaults locale from request context", async () => {
  let suspendedPayload: unknown;

  await getEntryDetailsClientTool.execute!(
    {
      entryId: "entry-1",
      includeContentTypeFields: false,
    },
    {
      requestContext: createRequestContext(),
      agent: {
        toolCallId: "tool-get-entry-details",
        messages: [],
        suspend: async (payload: unknown) => {
          suspendedPayload = payload;
        },
      },
    } as any,
  );

  const parsed = getEntryDetailsToolInputSchema.parse(suspendedPayload);
  assert.equal(parsed.entryId, "entry-1");
  assert.equal(parsed.locale, "en-US");
  assert.equal(parsed.includeContentTypeFields, false);
});

test("readEntriesClientTool defaults locales from request context", async () => {
  let suspendedPayload: unknown;

  await readEntriesClientTool.execute!(
    {
      entryIds: ["entry-1", "entry-2"],
    },
    {
      requestContext: createRequestContext(),
      agent: {
        toolCallId: "tool-read-entries",
        messages: [],
        suspend: async (payload: unknown) => {
          suspendedPayload = payload;
        },
      },
    } as any,
  );

  const parsed = readEntriesToolInputSchema.parse(suspendedPayload);
  assert.deepEqual(parsed.entryIds, ["entry-1", "entry-2"]);
  assert.deepEqual(parsed.locales, ["en-US"]);
});

test("updateEntryAndPublishClientTool returns validated resume data", async () => {
  const result = await updateEntryAndPublishClientTool.execute!(
    {
      entryId: "entry-1",
      updates: [
        {
          fieldId: "title",
          locale: "en-US",
          value: "Updated title",
        },
      ],
    },
    {
      requestContext: createRequestContext(),
      agent: {
        toolCallId: "tool-update-entry",
        messages: [],
        resumeData: {
          entryId: "entry-1",
          contentTypeId: "page",
          status: "PUBLISHED",
          version: 4,
          publishedVersion: 3,
          updatedAt: "2026-03-22T10:00:00.000Z",
          publishedAt: "2026-03-22T10:00:00.000Z",
        },
        suspend: async () => {},
      },
    } as any,
  );

  assert.deepEqual(
    result,
    updateEntryAndPublishToolOutputSchema.parse({
      entryId: "entry-1",
      contentTypeId: "page",
      status: "PUBLISHED",
      version: 4,
      publishedVersion: 3,
      updatedAt: "2026-03-22T10:00:00.000Z",
      publishedAt: "2026-03-22T10:00:00.000Z",
    }),
  );
});
