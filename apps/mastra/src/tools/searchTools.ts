import { createTool } from "@mastra/core/tools";
import { generateObject } from "ai";
import type { ChatExecutionContext, EntrySearchFilters } from "@contentful-rename/shared";
import {
  chatExecutionContextSchema,
  entrySearchFiltersSchema,
  extractSearchFiltersToolInputSchema,
  extractSearchFiltersToolOutputSchema,
} from "@contentful-rename/shared";

import { getOpenAIModel } from "../lib/model";

const EXTRACT_SEARCH_FILTERS_SYSTEM_PROMPT = `You convert a Contentful search request into structured entry search filters.

Rules:
- Output only filters that are explicitly supported.
- Resolve relative dates against the provided currentDate and output YYYY-MM-DD values.
- Use content type ids only, never friendly names.
- Prefer updatedAt ranges when the request says updated or changed, createdAt ranges when it says created, and publishedAt ranges when it says published.
- queryText should contain the main subject text to search for, not the full instruction sentence.
- If allowedContentTypes is non-empty, use only ids from that list.`;

function getChatContext(context: any) {
  return chatExecutionContextSchema.parse(context?.requestContext?.all ?? {});
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeContentTypeId(contentTypeId: string) {
  return contentTypeId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

function detectAllowedContentTypes(userQuery: string, allowedContentTypes: string[]) {
  const query = userQuery.toLowerCase();
  return allowedContentTypes.filter((contentTypeId) => {
    const normalized = normalizeContentTypeId(contentTypeId);
    return (
      query.includes(contentTypeId.toLowerCase()) ||
      query.includes(normalized) ||
      query.includes(`${normalized}s`)
    );
  });
}

function detectExplicitContentTypeIds(userQuery: string) {
  const match = userQuery.match(
    /\bcontent types?\s+([a-zA-Z0-9_,\s-]+?)(?:\babout\b|\bfor\b|$)/i,
  );
  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(/,|\band\b/i)
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveDateField(userQuery: string) {
  const query = userQuery.toLowerCase();
  if (/\bpublished\b/.test(query)) {
    return "publishedAt";
  }
  if (/\bcreated\b/.test(query)) {
    return "createdAt";
  }
  return "updatedAt";
}

function extractStatus(userQuery: string): EntrySearchFilters["status"] | undefined {
  const query = userQuery.toLowerCase();
  if (/\barchived\b/.test(query)) {
    return "archived";
  }
  if (/\bdrafts?\b/.test(query)) {
    return "draft";
  }
  if (/\bpublished\b/.test(query)) {
    return "published";
  }
  return undefined;
}

function extractLimit(userQuery: string) {
  const match = userQuery.match(/\b(?:top|first|limit)\s+(\d{1,3})\b/i);
  if (!match) {
    return 20;
  }

  return Math.max(1, Math.min(Number(match[1]), 100));
}

function extractQueryText(userQuery: string) {
  const quoted = userQuery.match(/"([^"]+)"/);
  if (quoted?.[1]) {
    return quoted[1].trim();
  }

  const aboutMatch = userQuery.match(/\babout\s+(.+)$/i);
  if (aboutMatch?.[1]) {
    return aboutMatch[1]
      .replace(/\b(updated|changed|created|published)\b.+$/i, "")
      .replace(/\blast\s+week\b.*$/i, "")
      .replace(/\btoday\b.*$/i, "")
      .replace(/\byesterday\b.*$/i, "")
      .replace(/\bthis\s+week\b.*$/i, "")
      .replace(/\bcontent types?\b.+$/i, "")
      .trim()
      .replace(/[.,]+$/, "");
  }

  return undefined;
}

function extractDateRange(userQuery: string, currentDate: string) {
  const query = userQuery.toLowerCase();
  if (query.includes("last week")) {
    return {
      from: addDays(currentDate, -7),
      to: currentDate,
    };
  }

  if (query.includes("yesterday")) {
    const yesterday = addDays(currentDate, -1);
    return {
      from: yesterday,
      to: yesterday,
    };
  }

  if (query.includes("today")) {
    return {
      from: currentDate,
      to: currentDate,
    };
  }

  if (query.includes("this week")) {
    const current = new Date(`${currentDate}T00:00:00.000Z`);
    const dayOfWeek = current.getUTCDay();
    const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    return {
      from: addDays(currentDate, offset),
      to: currentDate,
    };
  }

  return null;
}

function clipToAllowedContentTypes(
  filters: EntrySearchFilters,
  allowedContentTypes: string[],
) {
  if (allowedContentTypes.length === 0 || filters.contentTypeIds.length === 0) {
    return {
      filters,
      warnings: [] as string[],
    };
  }

  const clipped = filters.contentTypeIds.filter((contentTypeId) =>
    allowedContentTypes.includes(contentTypeId),
  );
  const warnings =
    clipped.length === filters.contentTypeIds.length
      ? []
      : ["Removed content types that are not allowed in this app installation."];

  return {
    filters: {
      ...filters,
      contentTypeIds: clipped,
    },
    warnings,
  };
}

function buildHeuristicFilters(
  userQuery: string,
  chatContext: ChatExecutionContext,
) {
  const dateField = resolveDateField(userQuery);
  const dateRange = extractDateRange(userQuery, chatContext.currentDate);
  const explicitContentTypeIds = detectExplicitContentTypeIds(userQuery);
  const inferredAllowedContentTypes = detectAllowedContentTypes(
    userQuery,
    chatContext.allowedContentTypes,
  );
  const extractedContentTypeIds = [
    ...new Set([...explicitContentTypeIds, ...inferredAllowedContentTypes]),
  ];

  const filters: Record<string, unknown> = {
    queryText: extractQueryText(userQuery),
    contentTypeIds: extractedContentTypeIds,
    status: extractStatus(userQuery),
    limit: extractLimit(userQuery),
  };

  if (dateRange) {
    filters[`${dateField}From`] = dateRange.from;
    filters[`${dateField}To`] = dateRange.to;
  }

  const parsed = entrySearchFiltersSchema.parse(filters);
  const clipped = clipToAllowedContentTypes(parsed, chatContext.allowedContentTypes);

  return extractSearchFiltersToolOutputSchema.parse({
    filters: clipped.filters,
    warnings: clipped.warnings,
  });
}

export const extractSearchFiltersTool = createTool({
  id: "extract-search-filters",
  description:
    "Convert a free-form Contentful search request into structured entry search filters. Use this before searchEntriesClient.",
  inputSchema: extractSearchFiltersToolInputSchema,
  outputSchema: extractSearchFiltersToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    const chatContext = getChatContext(context);

    if (!process.env.OPENAI_API_KEY) {
      return buildHeuristicFilters(inputData.userQuery, chatContext);
    }

    try {
      const result = await generateObject({
        model: getOpenAIModel(),
        schema: extractSearchFiltersToolOutputSchema,
        system: EXTRACT_SEARCH_FILTERS_SYSTEM_PROMPT,
        prompt: JSON.stringify({
          userQuery: inputData.userQuery,
          currentDate: chatContext.currentDate,
          timeZone: chatContext.timeZone,
          allowedContentTypes: chatContext.allowedContentTypes,
        }),
      });
      const clipped = clipToAllowedContentTypes(
        entrySearchFiltersSchema.parse(result.object.filters),
        chatContext.allowedContentTypes,
      );

      return extractSearchFiltersToolOutputSchema.parse({
        filters: clipped.filters,
        warnings: [...(result.object.warnings ?? []), ...clipped.warnings],
      });
    } catch {
      return buildHeuristicFilters(inputData.userQuery, chatContext);
    }
  },
});
