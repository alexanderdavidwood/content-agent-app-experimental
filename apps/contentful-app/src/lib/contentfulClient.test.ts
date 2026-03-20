import assert from "node:assert/strict";
import test from "node:test";

import { fallbackKeywordSearch } from "./contentfulClient";

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
