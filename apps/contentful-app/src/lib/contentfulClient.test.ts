import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDefaultRenameInput,
  fallbackKeywordSearch,
  getEntryDetailsWithContentType,
  getLocales,
  listContentTypes,
  performCandidateSearch,
  readEntries,
  searchEntries,
  updateEntryAndPublish,
} from "./contentfulClient";

function createSdk(cma: any, overrides: Record<string, unknown> = {}) {
  return {
    cma,
    cmaAdapter: {},
    ids: { space: "space-id", environment: "master" },
    parameters: {},
    ...overrides,
  } as any;
}

test("buildDefaultRenameInput prefers hybrid search to avoid missing exact matches", () => {
  const result = buildDefaultRenameInput({ surface: "page" }, "en-US");

  assert.equal(result.searchMode, "hybrid");
});

test("fallbackKeywordSearch truncates duplicate porter queries with the shared cap", async () => {
  const seenQueries: string[] = [];
  const result = await fallbackKeywordSearch(
    {
      cmaAdapter: {},
      ids: { space: "space-id" },
      parameters: {},
    },
    [
      "porter",
      " Porter ",
      "",
      "porter docs",
      "porter setup",
      "porter api",
      "porter faq",
    ],
    3,
    {
      entry: {
        async getMany({ query, limit }) {
          seenQueries.push(query);
          return {
            items: Array.from({ length: limit }, (_, index) => ({
              sys: {
                id: `${query}-${index + 1}`,
              },
            })),
          };
        },
      },
    },
  );

  assert.deepEqual(seenQueries, [
    "porter",
    "porter docs",
    "porter setup",
    "porter api",
    "porter faq",
  ]);
  assert.equal(result.queryHits.length, 5);
  assert.equal(result.entryIds.length, 15);
});

test("fallbackKeywordSearch records scoped warnings when a porter query fails", async () => {
  const result = await fallbackKeywordSearch(
    {
      cmaAdapter: {},
      ids: { space: "space-id" },
      parameters: {},
    },
    ["porter", "porter docs"],
    2,
    {
      entry: {
        async getMany({ query, limit }) {
          if (query === "porter docs") {
            throw new Error("boom");
          }

          return {
            items: Array.from({ length: limit }, (_, index) => ({
              sys: {
                id: `${query}-${index + 1}`,
              },
            })),
          };
        },
      },
    },
  );

  assert.deepEqual(result.entryIds, ["porter-1", "porter-2"]);
  assert.deepEqual(result.warnings, ['Keyword fallback failed for "porter docs": boom']);
  assert.equal(result.queryHits[1]?.warning, "boom");
  assert.deepEqual(result.queryHits[1]?.entryIds, []);
});

test("performCandidateSearch falls back to keyword search when semantic app actions fail", async () => {
  const calls: string[] = [];
  const result = await performCandidateSearch(
    {
      cmaAdapter: {},
      ids: { space: "space-id" },
      parameters: {},
      appAction: {
        async callAppAction(actionName: string) {
          calls.push(actionName);
          throw new Error(`${actionName} unavailable`);
        },
      },
    } as any,
    {
      defaultLocale: "en-US",
      searchMode: "semantic",
      queries: ["porter"],
      limitPerQuery: 2,
    },
    {
      entry: {
        async getMany({ query, limit }) {
          return {
            items: Array.from({ length: limit }, (_, index) => ({
              sys: {
                id: `${query}-${index + 1}`,
              },
            })),
          };
        },
      },
    },
  );

  assert.deepEqual(calls, ["semantic.ensureIndex", "semantic.search"]);
  assert.equal(result.indexStatus?.status, "UNSUPPORTED");
  assert.deepEqual(result.searchResult.entryIds, ["porter-1", "porter-2"]);
  assert.match(result.searchResult.warnings.at(-1) ?? "", /fell back to keyword search/i);
});

test("performCandidateSearch enforces keyword mode when semantic search is disabled", async () => {
  const calls: string[] = [];
  const result = await performCandidateSearch(
    {
      cmaAdapter: {},
      ids: { space: "space-id" },
      parameters: {},
      appAction: {
        async callAppAction(actionName: string) {
          calls.push(actionName);
          return {
            entryIds: [],
            queryHits: [],
            warnings: [],
          };
        },
      },
    } as any,
    {
      defaultLocale: "en-US",
      searchMode: "hybrid",
      queries: ["porter"],
      limitPerQuery: 2,
      semanticSearchEnabled: false,
    },
    {
      entry: {
        async getMany({ query, limit }) {
          return {
            items: Array.from({ length: limit }, (_, index) => ({
              sys: {
                id: `${query}-${index + 1}`,
              },
            })),
          };
        },
      },
    },
  );

  assert.deepEqual(calls, []);
  assert.deepEqual(result.searchResult.entryIds, ["porter-1", "porter-2"]);
  assert.match(result.searchResult.warnings[0] ?? "", /Semantic search is disabled/i);
});

test("listContentTypes returns requested content types and missing ids", async () => {
  const result = await listContentTypes(
    createSdk({
      contentType: {
        async get({ contentTypeId }: { contentTypeId: string }) {
          if (contentTypeId === "missing") {
            const error = new Error("NotFound");
            (error as Error & { status?: number }).status = 404;
            throw error;
          }

          return {
            sys: { id: "page" },
            name: "Page",
            description: "Page content type",
            displayField: "title",
            fields: [
              {
                id: "title",
                name: "Title",
                type: "Symbol",
                required: true,
                localized: true,
              },
            ],
          };
        },
      },
      entry: {} as any,
    }),
    {
      contentTypeIds: ["page", "missing"],
      includeFields: true,
      limit: 10,
    },
  );

  assert.deepEqual(result.requestedContentTypeIds, ["page", "missing"]);
  assert.deepEqual(result.missingContentTypeIds, ["missing"]);
  assert.equal(result.contentTypes[0]?.contentTypeId, "page");
  assert.equal(result.contentTypes[0]?.fields?.[0]?.fieldId, "title");
});

test("listContentTypes loads all content types when no ids are requested", async () => {
  const result = await listContentTypes(
    createSdk({
      contentType: {
        async getMany() {
          return {
            items: [
              {
                sys: { id: "landingPage" },
                name: "Landing page",
                displayField: "title",
                fields: [
                  {
                    id: "title",
                    name: "Title",
                    type: "Symbol",
                    localized: true,
                    required: true,
                  },
                ],
              },
            ],
          };
        },
      },
      entry: {} as any,
    }),
  );

  assert.equal(result.contentTypes[0]?.contentTypeId, "landingPage");
  assert.equal(result.contentTypes[0]?.fieldCount, 1);
});

test("getEntryDetailsWithContentType returns a localized entry plus content type metadata", async () => {
  const result = await getEntryDetailsWithContentType(
    createSdk({
      entry: {
        async get() {
          return {
            sys: {
              id: "entry-1",
              version: 7,
              createdAt: "2026-03-20T10:00:00.000Z",
              updatedAt: "2026-03-21T10:00:00.000Z",
              contentType: {
                sys: {
                  id: "page",
                },
              },
            },
            fields: {
              title: {
                "en-US": "Hello",
                "de-DE": "Hallo",
              },
            },
          };
        },
      },
      contentType: {
        async get() {
          return {
            sys: { id: "page" },
            name: "Page",
            displayField: "title",
            fields: [
              {
                id: "title",
                name: "Title",
                type: "Symbol",
                required: true,
                localized: true,
              },
            ],
          };
        },
      },
    }),
    {
      entryId: "entry-1",
      locale: "en-US",
      includeContentTypeFields: true,
    },
  );

  assert.equal(result.locale, "en-US");
  assert.deepEqual(result.entry.fields, {
    title: {
      "en-US": "Hello",
    },
  });
  assert.equal(result.contentType.contentTypeId, "page");
});

test("readEntries reports missing entries and preserves requested locale filters", async () => {
  const result = await readEntries(
    createSdk({
      entry: {
        async get({ entryId }: { entryId: string }) {
          if (entryId === "missing") {
            const error = new Error("NotFound");
            (error as Error & { status?: number }).status = 404;
            throw error;
          }

          return {
            sys: {
              id: entryId,
              version: 3,
              updatedAt: "2026-03-21T10:00:00.000Z",
              contentType: {
                sys: {
                  id: "page",
                },
              },
            },
            fields: {
              title: {
                "en-US": "Hello",
                "fr-FR": "Bonjour",
              },
            },
          };
        },
      },
      contentType: {} as any,
    }),
    {
      entryIds: ["entry-1", "missing"],
      locales: ["en-US"],
    },
  );

  assert.deepEqual(result.requestedEntryIds, ["entry-1", "missing"]);
  assert.deepEqual(result.locales, ["en-US"]);
  assert.deepEqual(result.missingEntryIds, ["missing"]);
  assert.deepEqual(result.entries[0]?.fields, {
    title: {
      "en-US": "Hello",
    },
  });
});

test("readEntries can use entry.getMany for bulk reads", async () => {
  const result = await readEntries(
    createSdk({
      entry: {
        async getMany() {
          return {
            items: [
              {
                sys: {
                  id: "entry-1",
                  version: 3,
                  updatedAt: "2026-03-22T10:00:00.000Z",
                  contentType: { sys: { id: "landingPage" } },
                },
                fields: {
                  title: {
                    "en-US": "Acme landing page",
                  },
                },
              },
            ],
          };
        },
      },
      contentType: {} as any,
    }),
    {
      entryIds: ["entry-1"],
    },
  );

  assert.equal(result.entries[0]?.fields.title?.["en-US"], "Acme landing page");
});

test("updateEntryAndPublish retries once after a version mismatch", async () => {
  const seenVersions: number[] = [];
  let getCount = 0;
  const result = await updateEntryAndPublish(
    createSdk({
      entry: {
        async get() {
          getCount += 1;
          return {
            sys: {
              id: "entry-1",
              version: getCount === 1 ? 2 : 3,
              updatedAt: "2026-03-21T10:00:00.000Z",
              contentType: {
                sys: {
                  id: "page",
                },
              },
            },
            fields: {
              title: {
                "en-US": "Original title",
              },
            },
          };
        },
        async update(
          _args: { entryId: string },
          payload: {
            fields: Record<string, Record<string, unknown>>;
            sys: { version: number };
          },
        ) {
          seenVersions.push(payload.sys.version);
          if (seenVersions.length === 1) {
            throw new Error("VersionMismatch");
          }

          return {
            sys: {
              id: "entry-1",
              version: 4,
              updatedAt: "2026-03-22T10:00:00.000Z",
              contentType: {
                sys: {
                  id: "page",
                },
              },
            },
            fields: payload.fields,
          };
        },
        async publish() {
          return {
            sys: {
              id: "entry-1",
              version: 5,
              updatedAt: "2026-03-22T10:00:01.000Z",
              publishedAt: "2026-03-22T10:00:01.000Z",
              publishedVersion: 4,
              contentType: {
                sys: {
                  id: "page",
                },
              },
            },
            fields: {
              title: {
                "en-US": "Updated title",
              },
            },
          };
        },
      },
      contentType: {
        async get() {
          return {
            sys: { id: "page" },
            fields: [
              {
                id: "title",
                type: "Symbol",
              },
            ],
          };
        },
      },
    }),
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
  );

  assert.deepEqual(seenVersions, [2, 3]);
  assert.equal(result.status, "PUBLISHED");
  assert.equal(result.version, 5);
});

test("updateEntryAndPublish reports UPDATED_NOT_PUBLISHED when publish fails", async () => {
  const result = await updateEntryAndPublish(
    createSdk({
      entry: {
        async get() {
          return {
            sys: {
              id: "entry-1",
              version: 2,
              updatedAt: "2026-03-21T10:00:00.000Z",
              contentType: {
                sys: {
                  id: "page",
                },
              },
            },
            fields: {
              title: {
                "en-US": "Original title",
              },
            },
          };
        },
        async update(
          _args: { entryId: string },
          payload: {
            fields: Record<string, Record<string, unknown>>;
            sys: { version: number };
          },
        ) {
          return {
            sys: {
              id: "entry-1",
              version: 3,
              updatedAt: "2026-03-22T10:00:00.000Z",
              contentType: {
                sys: {
                  id: "page",
                },
              },
            },
            fields: payload.fields,
          };
        },
        async publish() {
          throw new Error("publish denied");
        },
      },
      contentType: {
        async get() {
          return {
            sys: { id: "page" },
            fields: [
              {
                id: "title",
                type: "Symbol",
              },
            ],
          };
        },
      },
    }),
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
  );

  assert.equal(result.status, "UPDATED_NOT_PUBLISHED");
  assert.match(result.message ?? "", /publish denied/i);
});

test("getLocales maps CMA locale fields correctly", async () => {
  const result = await getLocales(
    createSdk({
      locale: {
        async getMany() {
          return {
            items: [
              {
                code: "en-US",
                name: "English (United States)",
                default: true,
              },
              {
                code: "de-DE",
                name: "German (Germany)",
                default: false,
                fallbackCode: "en-US",
              },
            ],
          };
        },
      },
    }),
  );

  assert.equal(result.locales[0]?.default, true);
  assert.equal(result.locales[1]?.fallbackCode, "en-US");
});

test("searchEntries builds the expected CMA query and resolves display field values", async () => {
  let seenQuery: Record<string, unknown> | undefined;
  const result = await searchEntries(
    createSdk({
      entry: {
        async getMany({ query }: { query: Record<string, unknown> }) {
          seenQuery = query;
          return {
            total: 1,
            items: [
              {
                sys: {
                  id: "entry-1",
                  version: 7,
                  updatedAt: "2026-03-22T10:00:00.000Z",
                  publishedAt: "2026-03-20T10:00:00.000Z",
                  contentType: { sys: { id: "landingPage" } },
                },
                fields: {
                  title: {
                    "en-US": "Acme Core",
                  },
                },
              },
            ],
          };
        },
      },
      contentType: {
        async get({ contentTypeId }: { contentTypeId: string }) {
          assert.equal(contentTypeId, "landingPage");
          return {
            sys: { id: "landingPage" },
            displayField: "title",
            fields: [],
          };
        },
      },
    }),
    {
      queryText: "Acme",
      contentTypeIds: ["landingPage"],
      status: "draft",
      updatedAtFrom: "2026-03-15",
      updatedAtTo: "2026-03-22",
      limit: 10,
    },
    {
      defaultLocale: "en-US",
    },
  );

  assert.deepEqual(seenQuery, {
    order: "-sys.updatedAt",
    limit: 10,
    query: "Acme",
    content_type: "landingPage",
    "sys.publishedAt[exists]": "false",
    "sys.archivedAt[exists]": "false",
    "sys.updatedAt[gte]": "2026-03-15T00:00:00.000Z",
    "sys.updatedAt[lte]": "2026-03-22T23:59:59.999Z",
  });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0]?.displayFieldValue, "Acme Core");
});
