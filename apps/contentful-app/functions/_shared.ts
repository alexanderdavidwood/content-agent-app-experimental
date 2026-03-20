import {
  semanticEnsureIndexInputSchema,
  semanticSearchInputSchema,
} from "@contentful-rename/shared";

type FunctionRequestLike = {
  body?: unknown;
  payload?: unknown;
  parameters?: unknown;
};

type FunctionContextLike = {
  environmentId?: string;
  organizationId?: string;
  spaceId?: string;
  appAccessToken?: string;
  headers?: Record<string, string>;
  env?: Record<string, string | undefined>;
  ids?: {
    organization?: string;
    space?: string;
    environment?: string;
  };
};

type SemanticSettingsResponse = {
  supportedLocales?: string[];
  supportedLocalePrefixes?: string[];
};

function readBody(request: FunctionRequestLike) {
  return request.body ?? request.payload ?? request.parameters ?? {};
}

export function parseEnsureIndexInput(request: FunctionRequestLike) {
  return semanticEnsureIndexInputSchema.parse(readBody(request));
}

export function parseSemanticSearchInput(request: FunctionRequestLike) {
  return semanticSearchInputSchema.parse(readBody(request));
}

export function resolveContext(context: FunctionContextLike) {
  const env = context.env ?? process.env;

  const organizationId =
    context.organizationId ?? context.ids?.organization ?? env.CONTENTFUL_ORG_ID;
  const spaceId = context.spaceId ?? context.ids?.space ?? env.CONTENTFUL_SPACE_ID;
  const environmentId =
    context.environmentId ??
    context.ids?.environment ??
    env.CONTENTFUL_ENVIRONMENT_ID ??
    "master";
  const accessToken =
    context.appAccessToken ??
    env.CONTENTFUL_ACCESS_TOKEN ??
    env.CONTENTFUL_APP_TOKEN;

  if (!organizationId || !spaceId || !accessToken) {
    throw new Error(
      "Missing Contentful semantic context. Expected organizationId, spaceId, and an app or management token.",
    );
  }

  return {
    apiHost: env.CONTENTFUL_CMA_HOST ?? "https://api.contentful.com",
    accessToken,
    organizationId,
    spaceId,
    environmentId,
  };
}

export function semanticHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "x-contentful-enable-alpha-feature": "semantic-service",
  };
}

export function managementHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export function buildSemanticEndpoints(input: {
  apiHost: string;
  organizationId: string;
  spaceId: string;
  environmentId: string;
}) {
  const { apiHost, organizationId, spaceId, environmentId } = input;
  const host = apiHost.replace(/\/$/, "");

  return {
    semanticSettings:
      process.env.CONTENTFUL_SEMANTIC_SETTINGS_URL ??
      `${host}/organizations/${organizationId}/semantic_settings`,
    listEnvironmentIndices:
      process.env.CONTENTFUL_ENVIRONMENT_SEARCH_INDEX_URL ??
      `${host}/spaces/${spaceId}/environments/${environmentId}/search_indices`,
    createSearchIndex:
      process.env.CONTENTFUL_CREATE_SEARCH_INDEX_URL ??
      `${host}/spaces/${spaceId}/environments/master/search_indices`,
    semanticSearch:
      process.env.CONTENTFUL_SEMANTIC_SEARCH_URL ??
      `${host}/spaces/${spaceId}/environments/${environmentId}/entries/semantic_search`,
    entries:
      process.env.CONTENTFUL_ENTRIES_URL ??
      `${host}/spaces/${spaceId}/environments/${environmentId}/entries`,
  };
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Contentful semantic request failed (${response.status}): ${detail}`);
  }

  return (await response.json()) as T;
}

export function localeSupported(
  settings: SemanticSettingsResponse,
  locale: string,
): boolean {
  const prefixes =
    settings.supportedLocalePrefixes ?? settings.supportedLocales ?? [];

  if (prefixes.length === 0) {
    return true;
  }

  return prefixes.some((prefix) => locale.startsWith(prefix));
}

export function normalizeEntryIds(payload: any): string[] {
  const candidates = payload.items ?? payload.entries ?? payload.results ?? [];

  return candidates
    .map((item: any) => item?.sys?.id ?? item?.entry?.sys?.id ?? item?.id)
    .filter((value: unknown): value is string => typeof value === "string");
}
