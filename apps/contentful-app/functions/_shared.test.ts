import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSemanticEndpoints,
  fetchJson,
  localeSupported,
  normalizeEntryIds,
  resolveContext,
} from "./_shared";

test("resolveContext reads Contentful identifiers from context env", () => {
  const resolved = resolveContext({
    env: {
      CONTENTFUL_ORG_ID: "org-id",
      CONTENTFUL_SPACE_ID: "space-id",
      CONTENTFUL_ENVIRONMENT_ID: "staging",
      CONTENTFUL_ACCESS_TOKEN: "token-value",
      CONTENTFUL_CMA_HOST: "https://preview.contentful.test",
    },
  });

  assert.deepEqual(resolved, {
    apiHost: "https://preview.contentful.test",
    accessToken: "token-value",
    organizationId: "org-id",
    spaceId: "space-id",
    environmentId: "staging",
  });
});

test("buildSemanticEndpoints uses the resolved environment path", () => {
  const endpoints = buildSemanticEndpoints({
    apiHost: "https://api.contentful.test/",
    organizationId: "org-id",
    spaceId: "space-id",
    environmentId: "qa",
  });

  assert.deepEqual(endpoints, {
    semanticSettings:
      "https://api.contentful.test/organizations/org-id/semantic_settings",
    listEnvironmentIndices:
      "https://api.contentful.test/spaces/space-id/environments/qa/search_indices",
    createSearchIndex:
      "https://api.contentful.test/spaces/space-id/environments/master/search_indices",
    semanticSearch:
      "https://api.contentful.test/spaces/space-id/environments/qa/entries/semantic_search",
    entries: "https://api.contentful.test/spaces/space-id/environments/qa/entries",
  });
});

test("normalizeEntryIds supports items, entries, and results payloads", () => {
  assert.deepEqual(
    normalizeEntryIds({
      items: [{ sys: { id: "item-1" } }],
    }),
    ["item-1"],
  );
  assert.deepEqual(
    normalizeEntryIds({
      entries: [{ entry: { sys: { id: "entry-1" } } }],
    }),
    ["entry-1"],
  );
  assert.deepEqual(
    normalizeEntryIds({
      results: [{ id: "result-1" }],
    }),
    ["result-1"],
  );
});

test("localeSupported falls back to supportedLocales and fetchJson preserves error detail", async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = (async () =>
      ({
        ok: false,
        status: 500,
        async text() {
          return "semantic exploded";
        },
      }) as Response) as typeof fetch;

    await assert.rejects(
      () => fetchJson("https://example.com/test", { method: "GET" }),
      /Contentful semantic request failed \(500\): semantic exploded/,
    );
    assert.equal(localeSupported({ supportedLocales: ["en", "de"] }, "en-US"), true);
    assert.equal(localeSupported({ supportedLocales: ["de"] }, "en-US"), false);
  } finally {
    global.fetch = originalFetch;
  }
});
