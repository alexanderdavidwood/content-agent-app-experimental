import assert from "node:assert/strict";
import test from "node:test";
import { RequestContext } from "@mastra/core/request-context";
import type { ChatExecutionContext } from "@contentful-rename/shared";
import {
  getEntryDetailsToolInputSchema,
  getLocalesToolOutputSchema,
  listContentTypesToolInputSchema,
  listContentTypesToolOutputSchema,
  readEntriesToolInputSchema,
  searchEntriesToolInputSchema,
  updateEntryAndPublishToolOutputSchema,
} from "@contentful-rename/shared";

import {
  getEntryDetailsClientTool,
  getLocalesClientTool,
  listContentTypesClientTool,
  readEntriesClientTool,
  searchEntriesClientTool,
  updateEntryAndPublishClientTool,
} from "./contentTools";

const chatContext: ChatExecutionContext = {
  defaultLocale: "en-US",
  timeZone: "UTC",
  currentDate: "2026-03-22",
  surfaceContext: { surface: "page" },
  allowedContentTypes: ["landingPage"],
  maxDiscoveryQueries: 5,
  maxCandidatesPerRun: 30,
  toolAvailability: {
    semanticSearch: true,
    entrySearch: true,
    preApplyValidation: true,
  },
};

function createRequestContext() {
  const requestContext = new RequestContext<ChatExecutionContext>();
  requestContext.set("defaultLocale", chatContext.defaultLocale);
  requestContext.set("timeZone", chatContext.timeZone);
  requestContext.set("currentDate", chatContext.currentDate);
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
      contentTypeIds: ["landingPage"],
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
  assert.deepEqual(parsed.contentTypeIds, ["landingPage"]);
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

test("getLocalesClientTool returns validated locale data on resume", async () => {
  const result = await getLocalesClientTool.execute!({}, {
    requestContext: createRequestContext(),
    agent: {
      toolCallId: "tool-get-locales",
      messages: [],
      resumeData: {
        locales: [
          {
            code: "en-US",
            name: "English (United States)",
            default: true,
          },
        ],
      },
      suspend: async () => {},
    },
  } as any);

  assert.equal(getLocalesToolOutputSchema.parse(result).locales[0]?.code, "en-US");
});

test("searchEntriesClientTool suspends with structured filters", async () => {
  let suspendedPayload: unknown;

  await searchEntriesClientTool.execute!(
    {
      queryText: "Acme",
      contentTypeIds: ["landingPage"],
      status: "draft",
      updatedAtFrom: "2026-03-15",
      updatedAtTo: "2026-03-22",
      limit: 10,
    },
    {
      requestContext: createRequestContext(),
      agent: {
        toolCallId: "tool-search-entries",
        messages: [],
        suspend: async (payload: unknown) => {
          suspendedPayload = payload;
        },
      },
    } as any,
  );

  const parsed = searchEntriesToolInputSchema.parse(suspendedPayload);
  assert.equal(parsed.status, "draft");
  assert.equal(parsed.limit, 10);
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
          contentTypeId: "landingPage",
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
      contentTypeId: "landingPage",
      status: "PUBLISHED",
      version: 4,
      publishedVersion: 3,
      updatedAt: "2026-03-22T10:00:00.000Z",
      publishedAt: "2026-03-22T10:00:00.000Z",
    }),
  );
});

test("listContentTypesClientTool validates resume payloads", async () => {
  const result = await listContentTypesClientTool.execute!(
    {
      contentTypeIds: [],
      includeFields: false,
      limit: 20,
    },
    {
      requestContext: createRequestContext(),
      agent: {
        toolCallId: "tool-list-content-types",
        messages: [],
        resumeData: {
          requestedContentTypeIds: [],
          contentTypes: [
            {
              contentTypeId: "landingPage",
              name: "Landing page",
              fieldCount: 0,
            },
          ],
          missingContentTypeIds: [],
        },
        suspend: async () => {},
      },
    } as any,
  );

  assert.deepEqual(
    result,
    listContentTypesToolOutputSchema.parse({
      requestedContentTypeIds: [],
      contentTypes: [
        {
          contentTypeId: "landingPage",
          name: "Landing page",
          fieldCount: 0,
        },
      ],
      missingContentTypeIds: [],
    }),
  );
});
