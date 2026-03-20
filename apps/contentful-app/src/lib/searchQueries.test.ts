import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchQueries,
  getSearchQueryLimit,
  normalizeSearchQueries,
  SEARCH_QUERY_CAP,
} from "./searchQueries";

test("buildSearchQueries dedupes porter queries and preserves the exact term once", () => {
  const queries = buildSearchQueries({
    discoveryQueries: [
      " Porter ",
      "porter docs",
      "PORTER",
      "porter setup",
      "",
    ],
    oldProductName: "porter",
    maxDiscoveryQueries: 5,
  });

  assert.deepEqual(queries, ["porter", "porter docs", "porter setup"]);
});

test("buildSearchQueries forces the exact porter term into a capped list", () => {
  const queries = buildSearchQueries({
    discoveryQueries: [
      "porter docs",
      "porter setup",
      "porter api",
      "porter faq",
      "porter guide",
    ],
    oldProductName: "porter",
    maxDiscoveryQueries: 4,
  });

  assert.equal(queries.length, 4);
  assert.deepEqual(queries, [
    "porter docs",
    "porter setup",
    "porter api",
    "porter",
  ]);
});

test("normalizeSearchQueries enforces the shared hard cap", () => {
  const queries = normalizeSearchQueries(
    [
      "porter",
      "porter docs",
      "porter setup",
      "porter api",
      "porter faq",
      "porter guide",
    ],
    SEARCH_QUERY_CAP + 4,
  );

  assert.equal(getSearchQueryLimit(999), SEARCH_QUERY_CAP);
  assert.equal(queries.length, SEARCH_QUERY_CAP);
  assert.deepEqual(queries, [
    "porter",
    "porter docs",
    "porter setup",
    "porter api",
    "porter faq",
  ]);
});
