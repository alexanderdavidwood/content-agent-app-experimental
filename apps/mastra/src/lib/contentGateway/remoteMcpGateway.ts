import type {
  ChatExecutionContext,
  ContentEntryRecord,
  ContentTypeSummary,
  GeneralContentToolAvailability,
  GetContentTypeToolInput,
  GetContentTypeToolOutput,
  GetEntryToolInput,
  GetEntryToolOutput,
  GetLocalesToolOutput,
  ListContentTypesToolInput,
  ListContentTypesToolOutput,
  ListEntriesToolInput,
  ListEntriesToolOutput,
} from "@contentful-rename/shared";
import {
  getContentTypeToolOutputSchema,
  getEntryToolOutputSchema,
  getLocalesToolOutputSchema,
  listContentTypesToolOutputSchema,
  listEntriesToolOutputSchema,
} from "@contentful-rename/shared";

import { callContentfulMcpTool } from "../mcp/remoteContentfulMcpClient";
import type {
  ContentTypeItemLike,
  EntryItemLike,
  GeneralContentToolName,
  GeneralContentToolOutputByName,
} from "./types";

function requireContentScope(chatContext: ChatExecutionContext) {
  if (!chatContext.spaceId || !chatContext.environmentId) {
    throw new Error(
      "Remote Contentful MCP tools require the current spaceId and environmentId.",
    );
  }

  return {
    spaceId: chatContext.spaceId,
    environmentId: chatContext.environmentId,
  };
}

function startOfDayIso(date: string) {
  return `${date}T00:00:00.000Z`;
}

function endOfDayIso(date: string) {
  return `${date}T23:59:59.999Z`;
}

function buildEntrySearchQuery(filters: ListEntriesToolInput) {
  const query: Record<string, string> = {
    order: "-sys.updatedAt",
    limit: String(filters.limit),
  };

  if (filters.queryText) {
    query.query = filters.queryText;
  }

  if (filters.contentTypeIds.length === 1) {
    query.content_type = filters.contentTypeIds[0]!;
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

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function getListFromValue(value: unknown, keys: string[]) {
  if (Array.isArray(value)) {
    return value;
  }

  const record = getRecord(value);
  if (!record) {
    return [];
  }

  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function getNestedRecord(
  value: Record<string, unknown> | null,
  key: string,
) {
  const candidate = value?.[key];
  return candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeContentTypeSummary(
  raw: unknown,
  includeFields: boolean,
): ContentTypeSummary {
  const record = getRecord(raw);
  const sys = getNestedRecord(record, "sys");
  const rawFields = Array.isArray(record?.fields) ? record.fields : [];

  return {
    contentTypeId:
      asString(record?.contentTypeId) ??
      asString(record?.id) ??
      asString(sys?.id) ??
      "",
    name:
      asString(record?.name) ??
      asString(record?.contentTypeId) ??
      asString(record?.id) ??
      "Unknown content type",
    description: asString(record?.description),
    displayField: asString(record?.displayField),
    fieldCount:
      asNumber(record?.fieldCount) ??
      (Array.isArray(rawFields) ? rawFields.length : 0),
    fields: includeFields
      ? rawFields.map((field) => {
          const candidate = getRecord(field);
          const items = getNestedRecord(candidate, "items");

          return {
            fieldId: asString(candidate?.fieldId) ?? asString(candidate?.id) ?? "",
            name:
              asString(candidate?.name) ??
              asString(candidate?.fieldId) ??
              asString(candidate?.id) ??
              "Unnamed field",
            type: asString(candidate?.type) ?? "Unknown",
            required: Boolean(candidate?.required),
            localized: Boolean(candidate?.localized),
            disabled: Boolean(candidate?.disabled),
            omitted: Boolean(candidate?.omitted),
            linkType: asString(candidate?.linkType),
            itemsType: asString(items?.type),
            itemsLinkType: asString(items?.linkType),
          };
        })
      : undefined,
  };
}

function filterEntryFields(
  fields: Record<string, Record<string, unknown>>,
  locale: string,
) {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([fieldId, localizedValues]) => {
      const value = localizedValues[locale];
      return value === undefined ? [] : [[fieldId, { [locale]: value }]];
    }),
  );
}

function normalizeEntryRecord(
  raw: unknown,
  locale?: string,
): ContentEntryRecord {
  const record = getRecord(raw);
  const sys = getNestedRecord(record, "sys");
  const contentType = getNestedRecord(sys, "contentType");
  const contentTypeSys = getNestedRecord(contentType, "sys");
  const rawFields =
    record?.fields && typeof record.fields === "object"
      ? (record.fields as Record<string, Record<string, unknown>>)
      : {};

  return {
    entryId: asString(record?.entryId) ?? asString(sys?.id) ?? "",
    contentTypeId:
      asString(record?.contentTypeId) ??
      asString(contentTypeSys?.id) ??
      "",
    version: asNumber(record?.version) ?? asNumber(sys?.version) ?? 0,
    createdAt: asString(record?.createdAt) ?? asString(sys?.createdAt),
    updatedAt:
      asString(record?.updatedAt) ?? asString(sys?.updatedAt) ?? new Date(0).toISOString(),
    publishedAt: asString(record?.publishedAt) ?? asString(sys?.publishedAt),
    publishedVersion:
      asNumber(record?.publishedVersion) ?? asNumber(sys?.publishedVersion),
    archivedAt: asString(record?.archivedAt) ?? asString(sys?.archivedAt),
    fields: locale ? filterEntryFields(rawFields, locale) : rawFields,
  };
}

function inferDisplayFieldValue(
  item: Record<string, unknown> | null,
  defaultLocale: string,
) {
  const explicitDisplayFieldValue = asString(item?.displayFieldValue);
  if (explicitDisplayFieldValue) {
    return explicitDisplayFieldValue;
  }

  const fields =
    item?.fields && typeof item.fields === "object"
      ? (item.fields as Record<string, Record<string, unknown>>)
      : {};

  for (const fieldId of ["title", "name", "internalName"]) {
    const value = fields[fieldId]?.[defaultLocale];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return asString(item?.title) ?? asString(item?.name);
}

async function listContentTypesRemote(
  input: ListContentTypesToolInput,
  chatContext: ChatExecutionContext,
  sessionId: string,
) {
  const { spaceId, environmentId } = requireContentScope(chatContext);
  const raw = await callContentfulMcpTool({
    sessionId,
    toolName: "list_content_types",
    args: {
      spaceId,
      environmentId,
      contentTypeIds: input.contentTypeIds,
      include: 0,
      limit: input.limit,
    },
  });

  const contentTypes = getListFromValue(raw, [
    "contentTypes",
    "items",
    "content_types",
  ]).map((item) => normalizeContentTypeSummary(item, input.includeFields));

  const foundIds = new Set(contentTypes.map((item) => item.contentTypeId));
  const missingContentTypeIds = input.contentTypeIds.filter(
    (contentTypeId) => !foundIds.has(contentTypeId),
  );

  return listContentTypesToolOutputSchema.parse({
    requestedContentTypeIds: input.contentTypeIds,
    contentTypes,
    missingContentTypeIds,
  });
}

async function getContentTypeRemote(
  input: GetContentTypeToolInput,
  chatContext: ChatExecutionContext,
  sessionId: string,
) {
  const { spaceId, environmentId } = requireContentScope(chatContext);
  const raw = await callContentfulMcpTool({
    sessionId,
    toolName: "get_content_type",
    args: {
      spaceId,
      environmentId,
      contentTypeId: input.contentTypeId,
    },
  });

  return getContentTypeToolOutputSchema.parse(
    normalizeContentTypeSummary(raw, input.includeFields),
  );
}

async function listEntriesRemote(
  input: ListEntriesToolInput,
  chatContext: ChatExecutionContext,
  sessionId: string,
) {
  const { spaceId, environmentId } = requireContentScope(chatContext);
  const raw = await callContentfulMcpTool({
    sessionId,
    toolName: "search_entries",
    args: {
      spaceId,
      environmentId,
      query: buildEntrySearchQuery(input),
    },
  });

  const record = getRecord(raw);
  const items = getListFromValue(raw, ["entries", "items", "results"]);
  const entries = items.map((item) => {
    const candidate = getRecord(item);
    const sys = getNestedRecord(candidate, "sys");
    const contentType = getNestedRecord(sys, "contentType");
    const contentTypeSys = getNestedRecord(contentType, "sys");

    return {
      entryId: asString(candidate?.entryId) ?? asString(sys?.id) ?? "",
      contentTypeId:
        asString(candidate?.contentTypeId) ??
        asString(contentTypeSys?.id) ??
        "",
      version: asNumber(candidate?.version) ?? asNumber(sys?.version) ?? 0,
      updatedAt:
        asString(candidate?.updatedAt) ??
        asString(sys?.updatedAt) ??
        new Date(0).toISOString(),
      publishedAt: asString(candidate?.publishedAt) ?? asString(sys?.publishedAt),
      displayFieldId:
        asString(candidate?.displayFieldId) ??
        asString(candidate?.displayField) ??
        undefined,
      displayFieldValue: inferDisplayFieldValue(candidate, chatContext.defaultLocale),
    };
  });

  return listEntriesToolOutputSchema.parse({
    filters: input,
    total:
      asNumber(record?.total) ??
      asNumber(record?.count) ??
      (entries.length > 0 ? entries.length : undefined),
    entries,
    warnings: [],
  });
}

async function getEntryRemote(
  input: GetEntryToolInput,
  chatContext: ChatExecutionContext,
  sessionId: string,
) {
  const { spaceId, environmentId } = requireContentScope(chatContext);
  const locale = input.locale ?? chatContext.defaultLocale;
  const rawEntry = await callContentfulMcpTool({
    sessionId,
    toolName: "get_entry",
    args: {
      spaceId,
      environmentId,
      entryId: input.entryId,
    },
  });
  const entry = normalizeEntryRecord(rawEntry, locale);
  const contentType = await getContentTypeRemote(
    {
      contentTypeId: entry.contentTypeId,
      includeFields: input.includeContentTypeFields,
    },
    chatContext,
    sessionId,
  );

  return getEntryToolOutputSchema.parse({
    entry,
    contentType,
    locale,
  });
}

async function getLocalesRemote(
  chatContext: ChatExecutionContext,
  sessionId: string,
) {
  const { spaceId, environmentId } = requireContentScope(chatContext);
  const raw = await callContentfulMcpTool({
    sessionId,
    toolName: "list_locales",
    args: {
      spaceId,
      environmentId,
      limit: 1000,
    },
  });

  const locales = getListFromValue(raw, ["locales", "items"]).map((item) => {
    const record = getRecord(item);

    return {
      code: asString(record?.code) ?? "",
      name: asString(record?.name) ?? "",
      fallbackCode: asString(record?.fallbackCode),
      default: Boolean(record?.default),
    };
  });

  return getLocalesToolOutputSchema.parse({
    locales,
  });
}

export async function executeRemoteGeneralContentTool<
  Name extends GeneralContentToolName,
>(
  toolName: Name,
  input: Record<string, unknown>,
  chatContext: ChatExecutionContext,
  sessionId: string,
): Promise<GeneralContentToolOutputByName[Name]> {
  switch (toolName) {
    case "listContentTypes":
      return (await listContentTypesRemote(
        input as ListContentTypesToolInput,
        chatContext,
        sessionId,
      )) as GeneralContentToolOutputByName[Name];
    case "getContentType":
      return (await getContentTypeRemote(
        input as GetContentTypeToolInput,
        chatContext,
        sessionId,
      )) as GeneralContentToolOutputByName[Name];
    case "listEntries":
      return (await listEntriesRemote(
        input as ListEntriesToolInput,
        chatContext,
        sessionId,
      )) as GeneralContentToolOutputByName[Name];
    case "getEntry":
      return (await getEntryRemote(
        input as GetEntryToolInput,
        chatContext,
        sessionId,
      )) as GeneralContentToolOutputByName[Name];
    case "getLocales":
      return (await getLocalesRemote(
        chatContext,
        sessionId,
      )) as GeneralContentToolOutputByName[Name];
    default:
      throw new Error(`Unsupported remote general content tool: ${toolName}`);
  }
}
