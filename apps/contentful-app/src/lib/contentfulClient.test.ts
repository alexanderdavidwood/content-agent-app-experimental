import assert from "node:assert/strict";
import test from "node:test";

import { fallbackKeywordSearch, performCandidateSearch } from "./contentfulClient";

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
  assert.match(
    result.searchResult.warnings.at(-1) ?? "",
    /fell back to keyword search/i,
  );
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
  assert.match(
    result.searchResult.warnings[0] ?? "",
    /Semantic search is disabled/i,
  );
});
