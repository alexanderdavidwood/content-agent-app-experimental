const DEFAULT_MAX_DISCOVERY_QUERIES = 5;
export const SEARCH_QUERY_CAP = 5;

export type BuildSearchQueriesInput = {
  discoveryQueries?: string[];
  oldProductName: string;
  maxDiscoveryQueries?: number;
};

export function getSearchQueryLimit(maxDiscoveryQueries?: number) {
  const candidate =
    typeof maxDiscoveryQueries === "number" && Number.isFinite(maxDiscoveryQueries)
      ? Math.floor(maxDiscoveryQueries)
      : DEFAULT_MAX_DISCOVERY_QUERIES;

  return Math.max(1, Math.min(candidate, SEARCH_QUERY_CAP));
}

export function normalizeSearchQueries(
  queries: string[],
  maxQueries = SEARCH_QUERY_CAP,
): string[] {
  const limit = getSearchQueryLimit(maxQueries);
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const trimmed = query.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(trimmed);

    if (normalized.length === limit) {
      break;
    }
  }

  return normalized;
}

export function buildSearchQueries({
  discoveryQueries = [],
  oldProductName,
  maxDiscoveryQueries,
}: BuildSearchQueriesInput): string[] {
  const exactQuery = oldProductName.trim();
  const limit = getSearchQueryLimit(maxDiscoveryQueries);

  const normalizedDiscovery = normalizeSearchQueries(discoveryQueries, SEARCH_QUERY_CAP).map(
    (query) => (query.toLowerCase() === exactQuery.toLowerCase() ? exactQuery : query),
  );

  if (!exactQuery) {
    return normalizedDiscovery.slice(0, limit);
  }

  if (
    normalizedDiscovery.some(
      (query) => query.toLowerCase() === exactQuery.toLowerCase(),
    )
  ) {
    return normalizedDiscovery.slice(0, limit);
  }

  if (normalizedDiscovery.length < limit) {
    return [...normalizedDiscovery, exactQuery];
  }

  return [
    ...normalizedDiscovery.slice(0, Math.max(0, limit - 1)),
    exactQuery,
  ];
}
