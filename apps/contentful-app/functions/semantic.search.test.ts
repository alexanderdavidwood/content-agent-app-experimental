import assert from "node:assert/strict";
import test from "node:test";

import semanticSearch from "./semantic.search";

function createJsonResponse(payload: unknown) {
  return {
    ok: true,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  } as Response;
}

test("semanticSearch merges hybrid porter results and dedupes entry ids", async () => {
  const originalFetch = global.fetch;
  const requests: Array<{ url: string; method?: string }> = [];

  try {
    global.fetch = (async (url, init) => {
      const target = String(url);
      requests.push({ url: target, method: init?.method });

      if (target.includes("/semantic_search")) {
        return createJsonResponse({
          items: [{ sys: { id: "entry-1" } }, { sys: { id: "entry-2" } }],
        });
      }

      return createJsonResponse({
        items: [{ sys: { id: "entry-2" } }, { sys: { id: "entry-3" } }],
      });
    }) as typeof fetch;

    const result = await semanticSearch(
      {
        body: {
          mode: "hybrid",
          queries: ["porter"],
          limitPerQuery: 10,
        },
      },
      {
        organizationId: "org-id",
        spaceId: "space-id",
        environmentId: "master",
        appAccessToken: "token-value",
      },
    );

    assert.deepEqual(result.entryIds, ["entry-1", "entry-2", "entry-3"]);
    assert.deepEqual(result.queryHits, [
      {
        query: "porter",
        entryIds: ["entry-1", "entry-2", "entry-3"],
        warning: undefined,
      },
    ]);
    assert.deepEqual(
      requests.map((request) => request.method),
      ["POST", "GET"],
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("semanticSearch keeps keyword porter hits when semantic search fails", async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = (async (url) => {
      const target = String(url);

      if (target.includes("/semantic_search")) {
        return {
          ok: false,
          status: 500,
          async text() {
            return "semantic down";
          },
        } as Response;
      }

      return createJsonResponse({
        items: [{ sys: { id: "entry-porter" } }],
      });
    }) as typeof fetch;

    const result = await semanticSearch(
      {
        body: {
          mode: "hybrid",
          queries: ["porter"],
          limitPerQuery: 10,
        },
      },
      {
        organizationId: "org-id",
        spaceId: "space-id",
        environmentId: "master",
        appAccessToken: "token-value",
      },
    );

    assert.deepEqual(result.entryIds, ["entry-porter"]);
    assert.match(
      result.warnings[0] ?? "",
      /semantic search failed for "porter": Contentful semantic request failed \(500\): semantic down/,
    );
    assert.match(
      result.queryHits[0]?.warning ?? "",
      /semantic search failed for "porter"/,
    );
    assert.deepEqual(result.queryHits[0]?.entryIds, ["entry-porter"]);
  } finally {
    global.fetch = originalFetch;
  }
});
