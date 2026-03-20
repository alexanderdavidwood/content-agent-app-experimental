import type { SemanticEnsureIndexResult } from "@contentful-rename/shared";

import {
  buildSemanticEndpoints,
  fetchJson,
  localeSupported,
  parseEnsureIndexInput,
  resolveContext,
  semanticHeaders,
} from "./_shared";

type SearchIndex = {
  sys?: { id?: string };
  id?: string;
  locale?: string;
  status?: string;
};

export default async function semanticEnsureIndex(
  request: { body?: unknown; payload?: unknown; parameters?: unknown },
  context: Record<string, unknown>,
): Promise<SemanticEnsureIndexResult> {
  const input = parseEnsureIndexInput(request);
  const resolved = resolveContext(context);
  const endpoints = buildSemanticEndpoints(resolved);
  const headers = semanticHeaders(resolved.accessToken);

  const settings = await fetchJson<{
    supportedLocalePrefixes?: string[];
    supportedLocales?: string[];
  }>(endpoints.semanticSettings, {
    method: "GET",
    headers,
  });

  if (!localeSupported(settings, input.locale)) {
    return {
      status: "UNSUPPORTED",
      locale: input.locale,
      warning: `Locale ${input.locale} is not supported by semantic indexing for this organization.`,
    };
  }

  const listResponse = await fetchJson<{ items?: SearchIndex[] }>(
    `${endpoints.listEnvironmentIndices}?status=ACTIVE`,
    {
      method: "GET",
      headers,
    },
  );

  const activeIndex = listResponse.items?.find(
    (index) =>
      index.status === "ACTIVE" &&
      (!index.locale || index.locale === input.locale),
  );

  if (activeIndex) {
    return {
      status: "ACTIVE",
      locale: input.locale,
      indexId: activeIndex.sys?.id ?? activeIndex.id,
    };
  }

  if (!input.createIfMissing) {
    return {
      status: "MISSING",
      locale: input.locale,
      warning: "No active semantic index exists for this environment.",
    };
  }

  const created = await fetchJson<SearchIndex>(endpoints.createSearchIndex, {
    method: "POST",
    headers,
    body: JSON.stringify({
      locale: input.locale,
    }),
  });

  return {
    status: created.status === "ACTIVE" ? "ACTIVE" : "PENDING",
    locale: input.locale,
    indexId: created.sys?.id ?? created.id,
    warning:
      created.status === "ACTIVE"
        ? undefined
        : "Semantic index creation has started and may take time to become active.",
  };
}
