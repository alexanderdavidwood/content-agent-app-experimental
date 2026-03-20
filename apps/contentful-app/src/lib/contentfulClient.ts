import * as contentfulManagement from "contentful-management";

import type {
  AgentSurfaceContext,
  ApplyOperation,
  ApplyResult,
  CandidateEntrySnapshot,
  CandidateFieldSnapshot,
  ProposedChange,
  RenameRunInput,
  RichTextNode,
  SemanticEnsureIndexResult,
  SemanticSearchResult,
} from "@contentful-rename/shared";
import {
  appInstallationParametersSchema,
  extractRichTextSegments,
} from "@contentful-rename/shared";

import { applyProposedRichTextChange, groupOperationsByEntry } from "./richTextPatch";
import { normalizeSearchQueries, SEARCH_QUERY_CAP } from "./searchQueries";

type EntryLike = {
  sys: {
    id: string;
    version: number;
    updatedAt: string;
    contentType: {
      sys: {
        id: string;
      };
    };
  };
  fields: Record<string, Record<string, unknown>>;
};

type ContentTypeLike = {
  fields: Array<{
    id: string;
    type: string;
  }>;
};

type SdkLike = {
  cmaAdapter: unknown;
  cma?: unknown;
  ids: {
    space: string;
    environment?: string;
    environmentAlias?: string;
  };
  parameters: {
    installation?: unknown;
  };
};

type KeywordSearchClientOverride = {
  entry: {
    getMany(args: { query: string; limit: number }): Promise<{
      items?: Array<{ sys?: { id?: string } }>;
    }>;
  };
};

export type BackendPreflightIssueCode =
  | "tunnel_unavailable"
  | "network_auth_required"
  | "http_error"
  | "timeout"
  | "backend_unreachable";

export type BackendPreflightResult =
  | {
      ok: true;
      checkedUrl: string;
    }
  | {
      ok: false;
      checkedUrl: string;
      code: BackendPreflightIssueCode;
      message: string;
      status?: number;
      detail?: string;
    };

const DEFAULT_INSTALLATION_PARAMETERS = {
  mastraBaseUrl: "https://your-mastra-project.example.com",
  allowedContentTypes: [],
  maxDiscoveryQueries: 5,
  maxCandidatesPerRun: 30,
  defaultDryRun: true,
} as const;

const TUNNEL_REMINDER_BYPASS_HEADER = "bypass-tunnel-reminder";

function shouldBypassTunnelReminder(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    return (
      url.hostname.endsWith(".loca.lt") ||
      url.hostname.endsWith(".localtunnel.me")
    );
  } catch {
    return false;
  }
}

export function buildMastraRequestHeaders(
  baseUrl: string,
  headers: Record<string, string> = {},
) {
  return shouldBypassTunnelReminder(baseUrl)
    ? {
        ...headers,
        [TUNNEL_REMINDER_BYPASS_HEADER]: "1",
      }
    : headers;
}

export function getInstallationParameters(sdk: SdkLike) {
  const candidate = {
    ...DEFAULT_INSTALLATION_PARAMETERS,
    ...(sdk.parameters.installation && typeof sdk.parameters.installation === "object"
      ? (sdk.parameters.installation as Record<string, unknown>)
      : {}),
  };

  const parsed = appInstallationParametersSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  return appInstallationParametersSchema.parse(DEFAULT_INSTALLATION_PARAMETERS);
}

export function createCmaClient(sdk: SdkLike) {
  return contentfulManagement.createClient(
    { apiAdapter: sdk.cmaAdapter as never },
    {
      type: "plain",
      defaults: {
        spaceId: sdk.ids.space,
        environmentId: sdk.ids.environmentAlias ?? sdk.ids.environment ?? "master",
      },
    },
  );
}

export async function fetchEntrySnapshots(
  sdk: SdkLike,
  entryIds: string[],
  locale: string,
  allowedContentTypeIds: string[],
): Promise<CandidateEntrySnapshot[]> {
  const cma = createCmaClient(sdk);
  const contentTypeCache = new Map<string, ContentTypeLike>();
  const snapshots: CandidateEntrySnapshot[] = [];

  for (const entryId of entryIds) {
    const entry = (await (cma as any).entry.get({ entryId })) as EntryLike;
    const contentTypeId = entry.sys.contentType.sys.id;

    if (
      allowedContentTypeIds.length > 0 &&
      !allowedContentTypeIds.includes(contentTypeId)
    ) {
      continue;
    }

    let contentType = contentTypeCache.get(contentTypeId);
    if (!contentType) {
      contentType = (await (cma as any).contentType.get({
        contentTypeId,
      })) as ContentTypeLike;
      contentTypeCache.set(contentTypeId, contentType);
    }

    const fields = contentType.fields.flatMap((field) =>
      snapshotField(entry, field.id, field.type, locale),
    );

    if (fields.length === 0) {
      continue;
    }

    snapshots.push({
      entryId: entry.sys.id,
      contentTypeId,
      version: entry.sys.version,
      updatedAt: entry.sys.updatedAt,
      fields,
    });
  }

  return snapshots;
}

function snapshotField(
  entry: EntryLike,
  fieldId: string,
  fieldType: string,
  locale: string,
): CandidateFieldSnapshot[] {
  const localizedValue = entry.fields[fieldId]?.[locale];
  if (localizedValue === undefined || localizedValue === null) {
    return [];
  }

  if (fieldType === "Symbol" || fieldType === "Text") {
    return [
      {
        fieldId,
        locale,
        fieldType,
        rawValue: localizedValue,
        segments: [],
      },
    ];
  }

  if (fieldType === "RichText") {
    return [
      {
        fieldId,
        locale,
        fieldType,
        rawValue: localizedValue,
        segments: extractRichTextSegments(fieldId, localizedValue as RichTextNode),
      },
    ];
  }

  return [];
}

export function buildDefaultRenameInput(
  surfaceContext: AgentSurfaceContext,
  locale: string,
): RenameRunInput {
  return {
    oldProductName: "",
    newProductName: "",
    defaultLocale: locale,
    searchMode: "semantic",
    contentTypeIds: [],
    surfaceContext,
  };
}

export function buildApplyOperations(
  snapshots: CandidateEntrySnapshot[],
  changes: ProposedChange[],
  approvals: Record<string, { approved: boolean; editedText?: string }>,
): ApplyOperation[] {
  const snapshotLookup = new Map(
    snapshots.map((snapshot) => [snapshot.entryId, snapshot] as const),
  );

  const operations: ApplyOperation[] = [];

  for (const change of changes) {
    const approval = approvals[change.changeId];
    if (!approval?.approved) {
      continue;
    }

    const snapshot = snapshotLookup.get(change.entryId);
    const field = snapshot?.fields.find(
      (candidate) =>
        candidate.fieldId === change.fieldId && candidate.locale === change.locale,
    );

    if (!snapshot || !field) {
      continue;
    }

    const nextText = approval.editedText ?? change.proposedText;
    let nextValue: unknown = nextText;

    if (field.fieldType === "RichText") {
      nextValue = applyProposedRichTextChange(
        field.rawValue as RichTextNode,
        change,
        nextText,
      );
    }

    operations.push({
      entryId: snapshot.entryId,
      version: snapshot.version,
      fieldId: change.fieldId,
      locale: change.locale,
      segmentId: change.segmentId,
      nextValue,
    });
  }

  return operations;
}

export async function applyOperations(
  sdk: SdkLike,
  operations: ApplyOperation[],
): Promise<ApplyResult[]> {
  const cma = createCmaClient(sdk);
  const grouped = groupOperationsByEntry(operations);
  const results: ApplyResult[] = [];

  for (const [entryId, entryOperations] of Object.entries(grouped)) {
    try {
      let entry = (await (cma as any).entry.get({ entryId })) as EntryLike;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const nextFields = structuredClone(entry.fields);

          for (const operation of entryOperations) {
            nextFields[operation.fieldId] = nextFields[operation.fieldId] ?? {};
            nextFields[operation.fieldId][operation.locale] = operation.nextValue;
          }

          entry = (await (cma as any).entry.update(
            { entryId },
            {
              fields: nextFields,
              sys: {
                version: entry.sys.version,
              },
            },
          )) as EntryLike;

          results.push({
            entryId,
            status: "APPLIED",
            newVersion: entry.sys.version,
            message: `Updated ${entryOperations.length} approved change(s)`,
          });
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (attempt === 0 && message.includes("VersionMismatch")) {
            entry = (await (cma as any).entry.get({ entryId })) as EntryLike;
            continue;
          }

          results.push({
            entryId,
            status: message.includes("VersionMismatch") ? "CONFLICT" : "FAILED",
            message,
          });
          break;
        }
      }
    } catch (error) {
      results.push({
        entryId,
        status: "FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export async function invokeAppAction<TInput, TResult>(
  sdk: any,
  actionName: string,
  payload: TInput,
): Promise<TResult> {
  const api = sdk.appAction ?? sdk.appActions ?? sdk.cma?.appAction;
  const invoke = api?.callAppAction ?? api?.call ?? api?.run;

  if (!invoke) {
    throw new Error("App Action API is not available in this Contentful SDK context");
  }

  return invoke(actionName, payload) as Promise<TResult>;
}

export function hasAppActionApi(sdk: any): boolean {
  const api = sdk.appAction ?? sdk.appActions ?? sdk.cma?.appAction;
  const invoke = api?.callAppAction ?? api?.call ?? api?.run;
  return typeof invoke === "function";
}

function stringifyAppActionError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function performCandidateSearch(
  sdk: SdkLike,
  input: {
    defaultLocale: string;
    searchMode: "semantic" | "keyword" | "hybrid";
    queries: string[];
    limitPerQuery: number;
  },
  cmaOverride?: KeywordSearchClientOverride,
): Promise<{
  indexStatus: SemanticEnsureIndexResult | null;
  searchResult: SemanticSearchResult;
}> {
  const { defaultLocale, searchMode, queries, limitPerQuery } = input;
  let indexStatus: SemanticEnsureIndexResult | null = null;

  if (searchMode !== "keyword" && hasAppActionApi(sdk)) {
    try {
      indexStatus = await invokeAppAction(sdk as any, "semantic.ensureIndex", {
        locale: defaultLocale,
        createIfMissing: true,
      });
    } catch (error) {
      indexStatus = {
        status: "UNSUPPORTED",
        locale: defaultLocale,
        warning: `semantic.ensureIndex failed; falling back to keyword search if needed: ${stringifyAppActionError(error)}`,
      };
    }
  }

  if (!hasAppActionApi(sdk)) {
    return {
      indexStatus,
      searchResult: await fallbackKeywordSearch(
        sdk,
        queries,
        limitPerQuery,
        cmaOverride,
      ),
    };
  }

  try {
    return {
      indexStatus,
      searchResult: await invokeAppAction<
        {
          mode: "semantic" | "keyword" | "hybrid";
          queries: string[];
          limitPerQuery: number;
        },
        SemanticSearchResult
      >(sdk as any, "semantic.search", {
        mode: searchMode,
        queries,
        limitPerQuery,
      }),
    };
  } catch (error) {
    const searchResult = await fallbackKeywordSearch(
      sdk,
      queries,
      limitPerQuery,
      cmaOverride,
    );

    return {
      indexStatus,
      searchResult: {
        ...searchResult,
        warnings: [
          ...searchResult.warnings,
          `${searchMode} search App Action failed; fell back to keyword search: ${stringifyAppActionError(error)}`,
        ],
      },
    };
  }
}

export function describeBackendHttpFailure(
  status: number,
  statusText: string,
  detail: string,
): string {
  const normalizedDetail = detail.trim();

  if (
    status === 503 &&
    normalizedDetail.toLowerCase().includes("tunnel unavailable")
  ) {
    return "Backend tunnel is unavailable (503). Restart your tunnel and update mastraBaseUrl if the URL changed.";
  }

  if (status === 511 || normalizedDetail.includes("Network Authentication Required")) {
    return "Tunnel gateway requires authentication (511). Use a fresh tunnel URL and verify it from your browser before running.";
  }

  if (status === 404) {
    return "Backend endpoint was not found (404). Ensure mastraBaseUrl points to the Mastra service that exposes /chat/stream.";
  }

  return `Backend request failed (${status} ${statusText || "Unknown"}): ${normalizedDetail || "No response body."}`;
}

export async function preflightMastraBackend(
  baseUrl: string,
  timeoutMs = 6000,
): Promise<BackendPreflightResult> {
  const healthUrl = new URL("/health", baseUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      signal: controller.signal,
      headers: buildMastraRequestHeaders(baseUrl, {
        Accept: "application/json, text/plain;q=0.9,*/*;q=0.8",
      }),
    });
    const detail = await response.text().catch(() => "");

    if (response.ok) {
      return {
        ok: true,
        checkedUrl: healthUrl,
      };
    }

    if (response.status === 503 && detail.toLowerCase().includes("tunnel unavailable")) {
      return {
        ok: false,
        checkedUrl: healthUrl,
        code: "tunnel_unavailable",
        status: response.status,
        detail,
        message:
          "Tunnel is unavailable (503). Restart your tunnel and update mastraBaseUrl if the URL changed.",
      };
    }

    if (response.status === 511 || detail.includes("Network Authentication Required")) {
      return {
        ok: false,
        checkedUrl: healthUrl,
        code: "network_auth_required",
        status: response.status,
        detail,
        message:
          "Tunnel gateway requires authentication (511). Open the tunnel URL in your browser once or rotate to a new tunnel URL.",
      };
    }

    return {
      ok: false,
      checkedUrl: healthUrl,
      code: "http_error",
      status: response.status,
      detail,
      message: describeBackendHttpFailure(response.status, response.statusText, detail),
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        checkedUrl: healthUrl,
        code: "timeout",
        message: `Backend health check timed out after ${timeoutMs}ms.`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      checkedUrl: healthUrl,
      code: "backend_unreachable",
      detail: message,
      message: `Backend is unreachable: ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fallbackKeywordSearch(
  sdk: SdkLike,
  queries: string[],
  limitPerQuery: number,
  cmaOverride?: KeywordSearchClientOverride,
): Promise<SemanticSearchResult> {
  const cma = (cmaOverride ?? createCmaClient(sdk)) as any;
  const allEntryIds = new Set<string>();
  const queryHits: SemanticSearchResult["queryHits"] = [];
  const warnings: string[] = [];

  for (const query of normalizeSearchQueries(queries, SEARCH_QUERY_CAP)) {
    try {
      const response = await cma.entry.getMany({
        query,
        limit: limitPerQuery,
      });

      const ids = (response?.items ?? [])
        .map((item: any) => item?.sys?.id)
        .filter((id: unknown): id is string => typeof id === "string")
        .slice(0, limitPerQuery);
      ids.forEach((id: string) => allEntryIds.add(id));
      queryHits.push({ query, entryIds: ids });
    } catch (error) {
      const warning = error instanceof Error ? error.message : String(error);
      warnings.push(`Keyword fallback failed for "${query}": ${warning}`);
      queryHits.push({
        query,
        entryIds: [],
        warning,
      });
    }
  }

  return {
    entryIds: [...allEntryIds],
    queryHits,
    warnings,
  };
}
