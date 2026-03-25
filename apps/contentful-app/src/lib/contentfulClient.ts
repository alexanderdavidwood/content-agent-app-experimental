import * as contentfulManagement from "contentful-management";

import type {
  AgentSurfaceContext,
  ApplyApprovedChangesToolInput,
  ApplyApprovedChangesToolOutput,
  ApplyOperation,
  ApplyResult,
  CandidateEntrySnapshot,
  CandidateFieldSnapshot,
  ContentEntryRecord,
  ContentTypeFieldSummary,
  ContentTypeSummary,
  DiscoverCandidatesToolInput,
  DiscoverCandidatesToolOutput,
  EntrySearchFilters,
  GetContentTypeToolInput,
  GetContentTypeToolOutput,
  GetEntryToolInput,
  GetEntryToolOutput,
  GetEntryDetailsToolInput,
  GetEntryDetailsToolOutput,
  GetLocalesToolOutput,
  ListContentTypesToolInput,
  ListContentTypesToolOutput,
  ListEntriesToolInput,
  ListEntriesToolOutput,
  McpEnvironmentSetupStatus,
  McpSessionStatus,
  ProposedChange,
  ReadEntriesToolInput,
  ReadEntriesToolOutput,
  RenameRunInput,
  RichTextNode,
  SearchEntriesToolInput,
  SearchEntriesToolOutput,
  SemanticEnsureIndexResult,
  SemanticSearchResult,
  UpdateEntryAndPublishToolInput,
  UpdateEntryAndPublishToolOutput,
  ValidateApprovedChangesToolInput,
  ValidateApprovedChangesToolOutput,
  ValidationIssue,
} from "@contentful-rename/shared";
import {
  CONTENTFUL_SUPPORTED_FIELD_TYPES,
  appInstallationParametersSchema,
  extractRichTextSegments,
  getContentTypeToolOutputSchema,
  getEntryToolOutputSchema,
  getEntryDetailsToolOutputSchema,
  getLocalesToolOutputSchema,
  listContentTypesToolOutputSchema,
  listEntriesToolOutputSchema,
  mcpEnvironmentSetupStatusSchema,
  mcpSessionStatusSchema,
  readEntriesToolOutputSchema,
  searchEntriesToolOutputSchema,
  updateEntryAndPublishToolOutputSchema,
  validateApprovedChangesToolOutputSchema,
} from "@contentful-rename/shared";

import { applyProposedRichTextChange, groupOperationsByEntry } from "./richTextPatch";
import {
  buildSearchQueries,
  normalizeSearchQueries,
  SEARCH_QUERY_CAP,
} from "./searchQueries";

type EntryLike = {
  sys: {
    id: string;
    version: number;
    createdAt?: string;
    updatedAt: string;
    publishedAt?: string;
    publishedVersion?: number;
    archivedAt?: string;
    contentType: {
      sys: {
        id: string;
      };
    };
  };
  fields: Record<string, Record<string, unknown>>;
};

type ContentTypeLike = {
  sys?: {
    id?: string;
  };
  name?: string;
  description?: string;
  displayField?: string;
  fields: Array<{
    id: string;
    name?: string;
    type: string;
    required?: boolean;
    localized?: boolean;
    disabled?: boolean;
    omitted?: boolean;
    linkType?: string;
    items?: {
      type?: string;
      linkType?: string;
    };
  }>;
};

type LocaleLike = {
  code: string;
  name: string;
  default?: boolean;
  fallbackCode?: string | null;
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

type CmaClientLike = {
  contentType: {
    get(args: { contentTypeId: string }): Promise<ContentTypeLike>;
    getMany?(args: unknown): Promise<{ items?: ContentTypeLike[] }>;
  };
  entry: {
    get(args: { entryId: string }): Promise<EntryLike>;
    getMany?(args: unknown): Promise<{ items?: EntryLike[]; total?: number }>;
    update(
      args: { entryId: string },
      payload: { fields: Record<string, Record<string, unknown>>; sys: { version: number } },
    ): Promise<EntryLike>;
    publish(args: { entryId: string }, payload: EntryLike): Promise<EntryLike>;
  };
  locale?: {
    getMany?(args: unknown): Promise<{ items?: LocaleLike[] }>;
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
  contentOpsProvider: "hybrid",
  generalContentToolAvailability: {
    listContentTypes: true,
    getContentType: true,
    listEntries: true,
    getEntry: true,
    getLocales: true,
    updateEntry: false,
    publishEntry: false,
  },
  mcpAutoFallbackToClientSdk: true,
  toolAvailability: {
    semanticSearch: true,
    entrySearch: true,
    preApplyValidation: true,
  },
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

function resolveBrowserOrigin() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.location?.origin ?? null;
}

export function describeMastraConnectionFailure(
  baseUrl: string,
  error: unknown,
) {
  const detail = error instanceof Error ? error.message : String(error);
  const browserOrigin = resolveBrowserOrigin();

  if (detail === "Failed to fetch" && browserOrigin) {
    try {
      const backendOrigin = new URL(baseUrl).origin;
      if (backendOrigin !== browserOrigin) {
        const corsHint = browserOrigin.endsWith(".ctfcloud.net")
          ? `Check backend CORS for ${browserOrigin}. Contentful-hosted app bundles run from their own ctfcloud.net origin, so ALLOWED_ORIGIN or ALLOWED_ORIGIN_EU must include that exact origin instead of app.contentful.com.`
          : `Check backend CORS for ${browserOrigin}. ALLOWED_ORIGIN or ALLOWED_ORIGIN_EU must include the exact app origin making the request.`;
        return `Backend request was blocked before a response. ${corsHint}`;
      }
    } catch {
      // Fall through to the generic network error.
    }
  }

  return `Backend is unreachable: ${detail}`;
}

async function fetchMastraEndpoint(
  baseUrl: string,
  input: string,
  init: RequestInit,
) {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new Error(describeMastraConnectionFailure(baseUrl, error));
  }
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
  if (sdk.cma) {
    return sdk.cma as any;
  }

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

function isNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = (error as { status?: number }).status;
  if (status === 404) {
    return true;
  }

  const name = String((error as { name?: unknown }).name ?? "");
  const message = String((error as { message?: unknown }).message ?? "");

  return /not.?found/i.test(name) || /not.?found/i.test(message);
}

function isVersionMismatchError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = (error as { status?: number }).status;
  const message = String((error as { message?: unknown }).message ?? "");

  return status === 409 || message.includes("VersionMismatch");
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function buildContentTypeFieldSummary(field: ContentTypeLike["fields"][number]): ContentTypeFieldSummary {
  return {
    fieldId: field.id,
    name: field.name ?? field.id,
    type: field.type,
    required: field.required ?? false,
    localized: field.localized ?? false,
    disabled: field.disabled ?? false,
    omitted: field.omitted ?? false,
    linkType: field.linkType,
    itemsType: field.items?.type,
    itemsLinkType: field.items?.linkType,
  };
}

function toContentTypeSummary(
  contentType: ContentTypeLike,
  includeFields: boolean,
): ContentTypeSummary {
  return {
    contentTypeId: contentType.sys?.id ?? "",
    name: contentType.name ?? contentType.sys?.id ?? "Unknown content type",
    description: contentType.description || undefined,
    displayField: contentType.displayField || undefined,
    fieldCount: contentType.fields.length,
    fields: includeFields
      ? contentType.fields.map((field) => buildContentTypeFieldSummary(field))
      : undefined,
  };
}

function filterEntryFields(
  fields: Record<string, Record<string, unknown>>,
  locales: string[],
) {
  if (locales.length === 0) {
    return fields;
  }

  return Object.fromEntries(
    Object.entries(fields).flatMap(([fieldId, localizedValues]) => {
      const nextValues = Object.fromEntries(
        Object.entries(localizedValues).filter(([locale]) => locales.includes(locale)),
      );

      return Object.keys(nextValues).length > 0 ? [[fieldId, nextValues]] : [];
    }),
  );
}

function toContentEntryRecord(
  entry: EntryLike,
  locales: string[],
): ContentEntryRecord {
  return {
    entryId: entry.sys.id,
    contentTypeId: entry.sys.contentType.sys.id,
    version: entry.sys.version,
    createdAt: entry.sys.createdAt,
    updatedAt: entry.sys.updatedAt,
    publishedAt: entry.sys.publishedAt,
    publishedVersion: entry.sys.publishedVersion,
    archivedAt: entry.sys.archivedAt,
    fields: filterEntryFields(entry.fields ?? {}, locales),
  };
}

function ensureRequestedFieldsExist(
  updates: UpdateEntryAndPublishToolInput["updates"],
  contentType: ContentTypeLike,
) {
  const knownFieldIds = new Set(contentType.fields.map((field) => field.id));
  const seenTargets = new Set<string>();

  for (const update of updates) {
    if (!knownFieldIds.has(update.fieldId)) {
      throw new Error(
        `Field "${update.fieldId}" does not exist on content type "${contentType.sys?.id ?? "unknown"}".`,
      );
    }

    const targetKey = `${update.fieldId}:${update.locale}`;
    if (seenTargets.has(targetKey)) {
      throw new Error(
        `Duplicate update target "${update.fieldId}" for locale "${update.locale}".`,
      );
    }

    seenTargets.add(targetKey);
  }
}

function buildUpdatedFields(
  entry: EntryLike,
  updates: UpdateEntryAndPublishToolInput["updates"],
) {
  const nextFields = structuredClone(entry.fields ?? {});

  for (const update of updates) {
    nextFields[update.fieldId] = nextFields[update.fieldId] ?? {};
    nextFields[update.fieldId][update.locale] = update.value;
  }

  return nextFields;
}

export async function listContentTypes(
  sdk: SdkLike,
  input: Partial<ListContentTypesToolInput> = {},
  cmaOverride?: CmaClientLike,
): Promise<ListContentTypesToolOutput> {
  const cma = cmaOverride ?? (createCmaClient(sdk) as unknown as CmaClientLike);
  const parsedInput = {
    contentTypeIds: uniqueStrings(input.contentTypeIds ?? []),
    includeFields: input.includeFields ?? false,
    limit: input.limit ?? 20,
  } satisfies ListContentTypesToolInput;
  const requestedContentTypeIds = parsedInput.contentTypeIds;

  if (requestedContentTypeIds.length === 0) {
    const response = await cma.contentType.getMany?.({
      limit: parsedInput.limit,
      query: {
        limit: parsedInput.limit,
        order: "name",
      },
    });
    const contentTypes = (response?.items ?? []).map((contentType) =>
      toContentTypeSummary(contentType, parsedInput.includeFields),
    );

    return listContentTypesToolOutputSchema.parse({
      requestedContentTypeIds,
      contentTypes,
      missingContentTypeIds: [],
    });
  }

  const contentTypes: ContentTypeSummary[] = [];
  const missingContentTypeIds: string[] = [];

  for (const contentTypeId of requestedContentTypeIds) {
    try {
      const contentType = await cma.contentType.get({ contentTypeId });
      contentTypes.push(toContentTypeSummary(contentType, parsedInput.includeFields));
    } catch (error) {
      if (isNotFoundError(error)) {
        missingContentTypeIds.push(contentTypeId);
        continue;
      }

      throw error;
    }
  }

  return listContentTypesToolOutputSchema.parse({
    requestedContentTypeIds,
    contentTypes,
    missingContentTypeIds,
  });
}

export async function getContentType(
  sdk: SdkLike,
  input: GetContentTypeToolInput,
  cmaOverride?: CmaClientLike,
): Promise<GetContentTypeToolOutput> {
  const result = await listContentTypes(
    sdk,
    {
      contentTypeIds: [input.contentTypeId],
      includeFields: input.includeFields,
      limit: 1,
    },
    cmaOverride,
  );

  const contentType = result.contentTypes[0];
  if (!contentType) {
    throw new Error(`Content type "${input.contentTypeId}" was not found.`);
  }

  return getContentTypeToolOutputSchema.parse(contentType);
}

export async function getEntryDetailsWithContentType(
  sdk: SdkLike,
  input: GetEntryDetailsToolInput,
  cmaOverride?: CmaClientLike,
): Promise<GetEntryDetailsToolOutput> {
  const cma = cmaOverride ?? (createCmaClient(sdk) as unknown as CmaClientLike);
  const entry = await cma.entry.get({ entryId: input.entryId });
  const contentType = await cma.contentType.get({
    contentTypeId: entry.sys.contentType.sys.id,
  });

  return getEntryDetailsToolOutputSchema.parse({
    entry: toContentEntryRecord(entry, [input.locale]),
    contentType: toContentTypeSummary(contentType, input.includeContentTypeFields),
    locale: input.locale,
  });
}

export async function getEntry(
  sdk: SdkLike,
  input: GetEntryToolInput,
  cmaOverride?: CmaClientLike,
): Promise<GetEntryToolOutput> {
  return getEntryToolOutputSchema.parse(
    await getEntryDetailsWithContentType(sdk, input, cmaOverride),
  );
}

export async function readEntries(
  sdk: SdkLike,
  input: { entryIds: string[]; locales?: string[] },
  cmaOverride?: CmaClientLike,
): Promise<ReadEntriesToolOutput> {
  const cma = cmaOverride ?? (createCmaClient(sdk) as unknown as CmaClientLike);
  const requestedEntryIds = uniqueStrings(input.entryIds);
  const locales = uniqueStrings(input.locales ?? []);
  const entries: ContentEntryRecord[] = [];
  const missingEntryIds: string[] = [];

  if (requestedEntryIds.length === 0) {
    return readEntriesToolOutputSchema.parse({
      requestedEntryIds,
      locales,
      entries,
      missingEntryIds,
    });
  }

  if (cma.entry.getMany) {
    const response = await cma.entry.getMany({
      query: {
        "sys.id[in]": requestedEntryIds.join(","),
        limit: requestedEntryIds.length,
      },
    });
    const items = (response?.items ?? []) as EntryLike[];
    const entryById = new Map(items.map((item) => [item.sys.id, item] as const));

    for (const entryId of requestedEntryIds) {
      const entry = entryById.get(entryId);
      if (entry) {
        entries.push(toContentEntryRecord(entry, locales));
      } else {
        missingEntryIds.push(entryId);
      }
    }

    return readEntriesToolOutputSchema.parse({
      requestedEntryIds,
      locales,
      entries,
      missingEntryIds,
    });
  }

  for (const entryId of requestedEntryIds) {
    try {
      const entry = await cma.entry.get({ entryId });
      entries.push(toContentEntryRecord(entry, locales));
    } catch (error) {
      if (isNotFoundError(error)) {
        missingEntryIds.push(entryId);
        continue;
      }

      throw error;
    }
  }

  return readEntriesToolOutputSchema.parse({
    requestedEntryIds,
    locales,
    entries,
    missingEntryIds,
  });
}

export async function updateEntryAndPublish(
  sdk: SdkLike,
  input: UpdateEntryAndPublishToolInput,
  cmaOverride?: CmaClientLike,
): Promise<UpdateEntryAndPublishToolOutput> {
  const cma = cmaOverride ?? (createCmaClient(sdk) as unknown as CmaClientLike);

  let entry = await cma.entry.get({ entryId: input.entryId });
  const contentTypeId = entry.sys.contentType.sys.id;

  if (
    input.expectedContentTypeId &&
    input.expectedContentTypeId !== contentTypeId
  ) {
    return updateEntryAndPublishToolOutputSchema.parse({
      entryId: input.entryId,
      contentTypeId,
      status: "CONFLICT",
      version: entry.sys.version,
      updatedAt: entry.sys.updatedAt,
      message: `Expected content type "${input.expectedContentTypeId}" but found "${contentTypeId}".`,
    });
  }

  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== entry.sys.version
  ) {
    return updateEntryAndPublishToolOutputSchema.parse({
      entryId: input.entryId,
      contentTypeId,
      status: "CONFLICT",
      version: entry.sys.version,
      updatedAt: entry.sys.updatedAt,
      message: `Expected entry version ${input.expectedVersion} but found ${entry.sys.version}.`,
    });
  }

  const contentType = await cma.contentType.get({ contentTypeId });
  ensureRequestedFieldsExist(input.updates, contentType);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const updatedEntry = await cma.entry.update(
        { entryId: input.entryId },
        {
          fields: buildUpdatedFields(entry, input.updates),
          sys: {
            version: entry.sys.version,
          },
        },
      );

      try {
        const publishedEntry = await cma.entry.publish(
          { entryId: input.entryId },
          updatedEntry,
        );

        return updateEntryAndPublishToolOutputSchema.parse({
          entryId: input.entryId,
          contentTypeId,
          status: "PUBLISHED",
          version: publishedEntry.sys.version,
          publishedVersion: publishedEntry.sys.publishedVersion,
          updatedAt: publishedEntry.sys.updatedAt,
          publishedAt: publishedEntry.sys.publishedAt,
        });
      } catch (publishError) {
        return updateEntryAndPublishToolOutputSchema.parse({
          entryId: input.entryId,
          contentTypeId,
          status: "UPDATED_NOT_PUBLISHED",
          version: updatedEntry.sys.version,
          publishedVersion: updatedEntry.sys.publishedVersion,
          updatedAt: updatedEntry.sys.updatedAt,
          publishedAt: updatedEntry.sys.publishedAt,
          message:
            publishError instanceof Error
              ? publishError.message
              : String(publishError),
        });
      }
    } catch (error) {
      if (
        attempt === 0 &&
        input.expectedVersion === undefined &&
        isVersionMismatchError(error)
      ) {
        entry = await cma.entry.get({ entryId: input.entryId });
        continue;
      }

      return updateEntryAndPublishToolOutputSchema.parse({
        entryId: input.entryId,
        contentTypeId,
        status: isVersionMismatchError(error) ? "CONFLICT" : "FAILED",
        version: entry.sys.version,
        updatedAt: entry.sys.updatedAt,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return updateEntryAndPublishToolOutputSchema.parse({
    entryId: input.entryId,
    contentTypeId,
    status: "FAILED",
    version: entry.sys.version,
    updatedAt: entry.sys.updatedAt,
    message: "Failed to update and publish the entry.",
  });
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
    searchMode: "hybrid",
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

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildNameVariants(name: string) {
  const trimmed = name.trim();
  const variants = new Set<string>([
    trimmed,
    `${trimmed}s`,
    `${trimmed}'s`,
    `${trimmed}’s`,
    trimmed.replace(/\s+/g, "-"),
    trimmed.replace(/-/g, " "),
  ]);

  return [...variants].filter(Boolean);
}

function candidateContainsVariant(candidate: CandidateEntrySnapshot, variants: string[]) {
  return candidate.fields.some((field) => {
    const values: string[] = [];
    if (typeof field.rawValue === "string") {
      values.push(field.rawValue);
    }

    for (const segment of field.segments) {
      values.push(segment.text);
    }

    return values.some((value) =>
      variants.some((variant) => new RegExp(escapeRegex(variant), "i").test(value)),
    );
  });
}

function startOfDayIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

function endOfDayIso(date: string) {
  return `${date}T23:59:59.999Z`;
}

function buildEntrySearchQuery(filters: EntrySearchFilters) {
  const query: Record<string, unknown> = {
    order: "-sys.updatedAt",
    limit: filters.limit,
  };

  if (filters.queryText) {
    query.query = filters.queryText;
  }

  if (filters.contentTypeIds.length === 1) {
    query.content_type = filters.contentTypeIds[0];
  } else if (filters.contentTypeIds.length > 1) {
    query["sys.contentType.sys.id[in]"] = filters.contentTypeIds.join(",");
  }

  if (filters.status === "published") {
    query["sys.publishedAt[exists]"] = "true";
    query["sys.archivedAt[exists]"] = "false";
  }

  if (filters.status === "draft") {
    query["sys.publishedAt[exists]"] = "false";
    query["sys.archivedAt[exists]"] = "false";
  }

  if (filters.status === "archived") {
    query["sys.archivedAt[exists]"] = "true";
  }

  if (filters.createdAtFrom) {
    query["sys.createdAt[gte]"] = startOfDayIso(filters.createdAtFrom);
  }

  if (filters.createdAtTo) {
    query["sys.createdAt[lte]"] = endOfDayIso(filters.createdAtTo);
  }

  if (filters.updatedAtFrom) {
    query["sys.updatedAt[gte]"] = startOfDayIso(filters.updatedAtFrom);
  }

  if (filters.updatedAtTo) {
    query["sys.updatedAt[lte]"] = endOfDayIso(filters.updatedAtTo);
  }

  if (filters.publishedAtFrom) {
    query["sys.publishedAt[gte]"] = startOfDayIso(filters.publishedAtFrom);
  }

  if (filters.publishedAtTo) {
    query["sys.publishedAt[lte]"] = endOfDayIso(filters.publishedAtTo);
  }

  return query;
}

function resolveStringFieldValue(
  entry: EntryLike,
  displayFieldId: string | undefined,
  locale: string,
) {
  if (!displayFieldId) {
    return undefined;
  }

  const value = entry.fields[displayFieldId]?.[locale];
  return typeof value === "string" ? value : undefined;
}

export async function discoverRenameCandidates(
  sdk: SdkLike,
  toolInput: DiscoverCandidatesToolInput,
  options: {
    maxDiscoveryQueries?: number;
    semanticSearchEnabled?: boolean;
  } = {},
): Promise<DiscoverCandidatesToolOutput> {
  const renameInput = toolInput.input;
  const searchQueries = buildSearchQueries({
    discoveryQueries: toolInput.discoveryPlan.queries,
    oldProductName: renameInput.oldProductName,
    maxDiscoveryQueries: options.maxDiscoveryQueries,
  });
  const { indexStatus, searchResult } = await performCandidateSearch(sdk, {
    defaultLocale: renameInput.defaultLocale,
    searchMode: renameInput.searchMode,
    queries: searchQueries,
    limitPerQuery: Math.min(toolInput.maxCandidatesPerRun, 10),
    semanticSearchEnabled: options.semanticSearchEnabled,
  });
  const snapshots = await fetchEntrySnapshots(
    sdk,
    searchResult.entryIds.slice(0, toolInput.maxCandidatesPerRun),
    renameInput.defaultLocale,
    renameInput.contentTypeIds,
  );
  const variants = buildNameVariants(renameInput.oldProductName);
  const lexicalMatches = snapshots.filter((candidate) =>
    candidateContainsVariant(candidate, variants),
  );

  return {
    runId: toolInput.runId,
    indexStatus,
    searchResult,
    candidateSnapshots:
      lexicalMatches.length > 0
        ? lexicalMatches
        : snapshots.slice(0, toolInput.maxCandidatesPerRun),
  };
}

export async function applyApprovedChanges(
  sdk: SdkLike,
  toolInput: ApplyApprovedChangesToolInput,
): Promise<ApplyApprovedChangesToolOutput> {
  const approvals = Object.fromEntries(
    toolInput.approvals.map((approval) => [
      approval.changeId,
      {
        approved: approval.approved,
        editedText: approval.editedText,
      },
    ]),
  );
  const operations = buildApplyOperations(
    toolInput.candidateSnapshots,
    toolInput.proposedChanges,
    approvals,
  );
  const results = await applyOperations(sdk, operations);

  return {
    runId: toolInput.runId,
    results,
  };
}

export async function getLocales(
  sdk: SdkLike,
): Promise<GetLocalesToolOutput> {
  const cma = createCmaClient(sdk) as any;
  const response = await cma.locale.getMany({
    query: {
      limit: 1000,
      order: "name",
    },
  });

  return getLocalesToolOutputSchema.parse({
    locales: (response?.items ?? []).map((locale: LocaleLike) => ({
      code: locale.code,
      name: locale.name,
      fallbackCode: locale.fallbackCode ?? undefined,
      default: Boolean(locale.default),
    })),
  });
}

export async function searchEntries(
  sdk: SdkLike,
  filters: SearchEntriesToolInput,
  options: {
    defaultLocale: string;
  },
): Promise<SearchEntriesToolOutput> {
  const cma = createCmaClient(sdk) as any;
  const response = await cma.entry.getMany({
    query: buildEntrySearchQuery(filters),
  });
  const items = (response?.items ?? []) as EntryLike[];
  const contentTypeIds = [...new Set(items.map((item) => item.sys.contentType.sys.id))];
  const contentTypes = await Promise.all(
    contentTypeIds.map(async (contentTypeId) => [
      contentTypeId,
      (await cma.contentType.get({ contentTypeId })) as ContentTypeLike,
    ] as const),
  );
  const contentTypeMap = new Map<string, ContentTypeLike>(contentTypes);

  return searchEntriesToolOutputSchema.parse({
    filters,
    total:
      typeof response?.total === "number" && Number.isFinite(response.total)
        ? response.total
        : undefined,
    entries: items.map((entry) => {
      const contentType = contentTypeMap.get(entry.sys.contentType.sys.id);
      const displayFieldId = contentType?.displayField;

      return {
        entryId: entry.sys.id,
        contentTypeId: entry.sys.contentType.sys.id,
        version: entry.sys.version,
        updatedAt: entry.sys.updatedAt,
        publishedAt: entry.sys.publishedAt,
        displayFieldId,
        displayFieldValue: resolveStringFieldValue(
          entry,
          displayFieldId,
          options.defaultLocale,
        ),
      };
    }),
    warnings: [],
  });
}

export async function listEntries(
  sdk: SdkLike,
  input: ListEntriesToolInput,
  options: {
    defaultLocale: string;
  },
): Promise<ListEntriesToolOutput> {
  return listEntriesToolOutputSchema.parse(
    await searchEntries(sdk, input, options),
  );
}

export async function validateApprovedChanges(
  sdk: SdkLike,
  toolInput: ValidateApprovedChangesToolInput,
): Promise<ValidateApprovedChangesToolOutput> {
  const approvals = Object.fromEntries(
    toolInput.approvals.map((approval) => [
      approval.changeId,
      {
        approved: approval.approved,
        editedText: approval.editedText,
      },
    ]),
  );
  const operations = buildApplyOperations(
    toolInput.candidateSnapshots,
    toolInput.proposedChanges,
    approvals,
  );
  const blockingIssues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (operations.length === 0) {
    warnings.push({
      code: "no_operations",
      severity: "warning",
      message: "No approved changes produced apply operations.",
    });
  }

  const approvedChangeIds = new Set(
    toolInput.approvals.filter((approval) => approval.approved).map((approval) => approval.changeId),
  );
  for (const change of toolInput.proposedChanges) {
    if (approvedChangeIds.has(change.changeId) && change.riskFlags.length > 0) {
      warnings.push({
        code: "risk_flag_present",
        severity: "warning",
        message: `Approved change ${change.changeId} still has risk flags: ${change.riskFlags.join(", ")}.`,
        entryId: change.entryId,
        fieldId: change.fieldId,
        locale: change.locale,
      });
    }
  }

  const operationTargets = new Set<string>();
  for (const operation of operations) {
    const key = [
      operation.entryId,
      operation.fieldId,
      operation.locale,
      operation.segmentId ?? "",
    ].join(":");

    if (operationTargets.has(key)) {
      blockingIssues.push({
        code: "duplicate_operation_target",
        severity: "blocking",
        message: "Multiple approved changes target the same entry field and locale.",
        entryId: operation.entryId,
        fieldId: operation.fieldId,
        locale: operation.locale,
      });
      continue;
    }

    operationTargets.add(key);
  }

  const locales = await getLocales(sdk);
  const localeCodes = new Set(locales.locales.map((locale) => locale.code));
  const touchedEntryIds = [...new Set(operations.map((operation) => operation.entryId))];
  const currentEntries =
    touchedEntryIds.length === 0
      ? { entries: [] as ContentEntryRecord[] }
      : await readEntries(sdk, {
          entryIds: touchedEntryIds,
        }).catch(() => ({ entries: [] as ContentEntryRecord[] }));
  const currentEntryMap = new Map(
    currentEntries.entries.map((entry) => [entry.entryId, entry] as const),
  );
  const snapshotVersionMap = new Map(
    toolInput.candidateSnapshots.map((snapshot) => [snapshot.entryId, snapshot.version] as const),
  );

  const touchedContentTypeIds = [
    ...new Set(currentEntries.entries.map((entry) => entry.contentTypeId)),
  ];
  const cma = createCmaClient(sdk) as any;
  const contentTypePairs = await Promise.all(
    touchedContentTypeIds.map(async (contentTypeId) => [
      contentTypeId,
      (await cma.contentType.get({ contentTypeId })) as ContentTypeLike,
    ] as const),
  );
  const contentTypeMap = new Map<string, ContentTypeLike>(contentTypePairs);

  for (const operation of operations) {
    const currentEntry = currentEntryMap.get(operation.entryId);
    if (!currentEntry) {
      blockingIssues.push({
        code: "entry_missing",
        severity: "blocking",
        message: "The entry no longer exists or is no longer accessible.",
        entryId: operation.entryId,
      });
      continue;
    }

    const expectedVersion = snapshotVersionMap.get(operation.entryId);
    if (
      typeof expectedVersion === "number" &&
      currentEntry.version !== expectedVersion
    ) {
      blockingIssues.push({
        code: "version_mismatch",
        severity: "blocking",
        message: `Entry version changed from ${expectedVersion} to ${currentEntry.version}.`,
        entryId: operation.entryId,
      });
    }

    if (!localeCodes.has(operation.locale)) {
      blockingIssues.push({
        code: "locale_missing",
        severity: "blocking",
        message: `Locale ${operation.locale} is not available in this space.`,
        entryId: operation.entryId,
        fieldId: operation.fieldId,
        locale: operation.locale,
      });
      continue;
    }

    const contentType = contentTypeMap.get(currentEntry.contentTypeId);
    const field = contentType?.fields.find(
      (candidate: ContentTypeLike["fields"][number]) =>
        candidate.id === operation.fieldId,
    );

    if (!field) {
      blockingIssues.push({
        code: "field_missing",
        severity: "blocking",
        message: `Field ${operation.fieldId} is not defined on content type ${currentEntry.contentTypeId}.`,
        entryId: operation.entryId,
        fieldId: operation.fieldId,
        locale: operation.locale,
      });
      continue;
    }

    if (
      !CONTENTFUL_SUPPORTED_FIELD_TYPES.includes(
        field.type as (typeof CONTENTFUL_SUPPORTED_FIELD_TYPES)[number],
      )
    ) {
      blockingIssues.push({
        code: "unsupported_field_type",
        severity: "blocking",
        message: `Field ${operation.fieldId} uses unsupported type ${field.type}.`,
        entryId: operation.entryId,
        fieldId: operation.fieldId,
        locale: operation.locale,
      });
    }
  }

  return validateApprovedChangesToolOutputSchema.parse({
    runId: toolInput.runId,
    canApply: operations.length > 0 && blockingIssues.length === 0,
    operations,
    blockingIssues,
    warnings,
  });
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
    semanticSearchEnabled?: boolean;
  },
  cmaOverride?: KeywordSearchClientOverride,
): Promise<{
  indexStatus: SemanticEnsureIndexResult | null;
  searchResult: SemanticSearchResult;
}> {
  const {
    defaultLocale,
    searchMode,
    queries,
    limitPerQuery,
    semanticSearchEnabled = true,
  } = input;
  let indexStatus: SemanticEnsureIndexResult | null = null;

  if (!semanticSearchEnabled) {
    const searchResult = await fallbackKeywordSearch(
      sdk,
      queries,
      limitPerQuery,
      cmaOverride,
    );

    return {
      indexStatus: null,
      searchResult: {
        ...searchResult,
        warnings:
          searchMode === "keyword"
            ? searchResult.warnings
            : [
                `Semantic search is disabled in app configuration; using keyword search instead of ${searchMode}.`,
                ...searchResult.warnings,
              ],
      },
    };
  }

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
    if (searchMode !== "keyword") {
      indexStatus = {
        status: "UNSUPPORTED",
        locale: defaultLocale,
        warning:
          "Semantic App Action API is unavailable in this Contentful SDK context; using keyword search.",
      };
    }

    const searchResult = await fallbackKeywordSearch(
      sdk,
      queries,
      limitPerQuery,
      cmaOverride,
    );

    return {
      indexStatus,
      searchResult:
        searchMode === "keyword"
          ? searchResult
          : {
              ...searchResult,
              warnings: [
                "Semantic App Action API is unavailable in this Contentful SDK context; using keyword search.",
                ...searchResult.warnings,
              ],
            },
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

    return {
      ok: false,
      checkedUrl: healthUrl,
      code: "backend_unreachable",
      detail: error instanceof Error ? error.message : String(error),
      message: describeMastraConnectionFailure(baseUrl, error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

type McpStatusRequest = {
  provider: "client-sdk" | "remote-mcp" | "hybrid";
  mcpAutoFallbackToClientSdk: boolean;
  generalContentToolAvailability: {
    listContentTypes: boolean;
    getContentType: boolean;
    listEntries: boolean;
    getEntry: boolean;
    getLocales: boolean;
    updateEntry: boolean;
    publishEntry: boolean;
  };
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
};

type McpConnectStartRequest = {
  provider: "client-sdk" | "remote-mcp" | "hybrid";
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
};

function buildMcpStatusUrl(
  baseUrl: string,
  path: string,
  request: McpStatusRequest,
) {
  const url = new URL(path, baseUrl);
  url.searchParams.set("provider", request.provider);
  url.searchParams.set(
    "mcpAutoFallbackToClientSdk",
    String(request.mcpAutoFallbackToClientSdk),
  );

  if (request.spaceId) {
    url.searchParams.set("spaceId", request.spaceId);
  }
  if (request.environmentId) {
    url.searchParams.set("environmentId", request.environmentId);
  }
  if (request.organizationId) {
    url.searchParams.set("organizationId", request.organizationId);
  }
  if (request.contentfulUserId) {
    url.searchParams.set("contentfulUserId", request.contentfulUserId);
  }

  for (const [key, value] of Object.entries(request.generalContentToolAvailability)) {
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

export async function fetchMcpSessionStatus(
  baseUrl: string,
  request: McpStatusRequest,
): Promise<McpSessionStatus> {
  const response = await fetchMastraEndpoint(
    baseUrl,
    buildMcpStatusUrl(baseUrl, "/mcp/session", request),
    {
      method: "GET",
      credentials: "include",
      headers: buildMastraRequestHeaders(baseUrl, {
        Accept: "application/json",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load MCP session status (${response.status}).`);
  }

  return mcpSessionStatusSchema.parse(await response.json());
}

export async function fetchMcpEnvironmentSetupStatus(
  baseUrl: string,
  request: McpStatusRequest,
): Promise<McpEnvironmentSetupStatus> {
  const response = await fetchMastraEndpoint(
    baseUrl,
    buildMcpStatusUrl(baseUrl, "/mcp/environment-setup", request),
    {
      method: "GET",
      credentials: "include",
      headers: buildMastraRequestHeaders(baseUrl, {
        Accept: "application/json",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to load MCP environment setup status (${response.status}).`,
    );
  }

  return mcpEnvironmentSetupStatusSchema.parse(await response.json());
}

export async function startContentfulMcpAuthorization(
  baseUrl: string,
  request: McpConnectStartRequest,
): Promise<{
  sessionId: string;
  redirectUrl: string;
}> {
  const response = await fetchMastraEndpoint(
    baseUrl,
    new URL("/mcp/connect/start", baseUrl).toString(),
    {
      method: "POST",
      credentials: "include",
      headers: buildMastraRequestHeaders(baseUrl, {
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Failed to start Contentful MCP authorization (${response.status}): ${detail || response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    sessionId: string;
    redirectUrl: string;
  };

  return payload;
}

export async function disconnectContentfulMcpSession(
  baseUrl: string,
  request: McpStatusRequest,
): Promise<McpSessionStatus> {
  const response = await fetchMastraEndpoint(
    baseUrl,
    buildMcpStatusUrl(baseUrl, "/mcp/disconnect", request),
    {
      method: "POST",
      credentials: "include",
      headers: buildMastraRequestHeaders(baseUrl, {
        Accept: "application/json",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to disconnect Contentful MCP (${response.status}).`);
  }

  return mcpSessionStatusSchema.parse(await response.json());
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
