import type { SemanticSearchResult } from "@contentful-rename/shared";

import {
  buildSemanticEndpoints,
  fetchJson,
  managementHeaders,
  normalizeEntryIds,
  parseSemanticSearchInput,
  resolveContext,
  semanticHeaders,
} from "./_shared";

export default async function semanticSearch(
  request: { body?: unknown; payload?: unknown; parameters?: unknown },
  context: Record<string, unknown>,
): Promise<SemanticSearchResult> {
  const input = parseSemanticSearchInput(request);
  const resolved = resolveContext(context);
  const endpoints = buildSemanticEndpoints(resolved);
  const semanticRequestHeaders = semanticHeaders(resolved.accessToken);
  const cmaHeaders = managementHeaders(resolved.accessToken);

  const queryHits: SemanticSearchResult["queryHits"] = [];
  const warnings: string[] = [];
  const entryIds = new Set<string>();

  for (const query of input.queries.slice(0, 5)) {
    const sources = getSourcesForMode(input.mode);
    const combinedIds = new Set<string>();
    const queryWarnings: string[] = [];

    for (const source of sources) {
      try {
        const ids =
          source === "semantic"
            ? await runSemanticQuery(query)
            : await runKeywordQuery(query);
        ids.forEach((id) => combinedIds.add(id));
      } catch (error) {
        const warning = error instanceof Error ? error.message : String(error);
        const scopedWarning = `${source} search failed for "${query}": ${warning}`;
        queryWarnings.push(scopedWarning);
        warnings.push(scopedWarning);
      }
    }

    const ids = [...combinedIds].slice(0, input.limitPerQuery);
    ids.forEach((id) => entryIds.add(id));
    queryHits.push({
      query,
      entryIds: ids,
      warning: queryWarnings.length > 0 ? queryWarnings.join(" | ") : undefined,
    });
  }

  return {
    entryIds: [...entryIds],
    queryHits,
    warnings,
  };

  async function runSemanticQuery(query: string) {
    const response = await fetchJson<any>(endpoints.semanticSearch, {
      method: "POST",
      headers: semanticRequestHeaders,
      body: JSON.stringify({
        query,
      }),
    });

    return normalizeEntryIds(response);
  }

  async function runKeywordQuery(query: string) {
    const url = new URL(endpoints.entries);
    url.searchParams.set("query", query);
    url.searchParams.set("limit", String(input.limitPerQuery));
    url.searchParams.set("select", "sys.id");

    const response = await fetchJson<any>(url.toString(), {
      method: "GET",
      headers: cmaHeaders,
    });

    return normalizeEntryIds(response);
  }

  function getSourcesForMode(mode: "semantic" | "keyword" | "hybrid") {
    if (mode === "hybrid") {
      return ["semantic", "keyword"] as const;
    }

    return [mode] as const;
  }
}
