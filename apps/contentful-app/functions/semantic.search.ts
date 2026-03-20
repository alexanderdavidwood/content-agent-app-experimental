import type { SemanticSearchResult } from "@contentful-rename/shared";

import {
  buildSemanticEndpoints,
  fetchJson,
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
  const headers = semanticHeaders(resolved.accessToken);

  const queryHits: SemanticSearchResult["queryHits"] = [];
  const warnings: string[] = [];
  const entryIds = new Set<string>();

  for (const query of input.queries.slice(0, 5)) {
    try {
      const response = await fetchJson<any>(endpoints.semanticSearch, {
        method: "POST",
        headers,
        body: JSON.stringify({
          query,
        }),
      });

      const ids = normalizeEntryIds(response).slice(0, input.limitPerQuery);
      ids.forEach((id) => entryIds.add(id));
      queryHits.push({
        query,
        entryIds: ids,
      });
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error);
      warnings.push(`Query "${query}" failed: ${warning}`);
      queryHits.push({
        query,
        entryIds: [],
        warning,
      });
    }
  }

  return {
    entryIds: [...entryIds],
    queryHits,
    warnings,
  };
}
