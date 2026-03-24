import type { RenameRunPhase } from "@contentful-rename/shared";
import {
  applyApprovedChangesToolInputSchema,
  applyApprovedChangesToolOutputSchema,
  discoverCandidatesToolInputSchema,
  discoverCandidatesToolOutputSchema,
  getContentTypeToolInputSchema,
  getContentTypeToolOutputSchema,
  getEntryToolInputSchema,
  getEntryToolOutputSchema,
  getEntryDetailsToolInputSchema,
  getEntryDetailsToolOutputSchema,
  getLocalesToolInputSchema,
  getLocalesToolOutputSchema,
  listContentTypesToolInputSchema,
  listContentTypesToolOutputSchema,
  listEntriesToolInputSchema,
  listEntriesToolOutputSchema,
  readEntriesToolInputSchema,
  readEntriesToolOutputSchema,
  reviewProposalsToolInputSchema,
  reviewProposalsToolOutputSchema,
  searchEntriesToolInputSchema,
  searchEntriesToolOutputSchema,
  updateEntryAndPublishToolInputSchema,
  updateEntryAndPublishToolOutputSchema,
  validateApprovedChangesToolInputSchema,
  validateApprovedChangesToolOutputSchema,
} from "@contentful-rename/shared";

import type { RenameChatTools, RenameChatRequestBody } from "./chatTypes";
import {
  applyApprovedChanges,
  discoverRenameCandidates,
  getContentType,
  getEntry,
  getEntryDetailsWithContentType,
  getLocales,
  listContentTypes,
  listEntries,
  readEntries,
  searchEntries,
  updateEntryAndPublish,
  validateApprovedChanges,
} from "./contentfulClient";

type SuspendedClientToolName = Exclude<
  keyof RenameChatTools,
  "draftProposals" | "extractSearchFilters"
>;

type SuspendedClientToolDefinition<Name extends SuspendedClientToolName> = {
  toolName: Name;
  mode: "auto" | "manual";
  phase: RenameRunPhase;
  pendingTitle: string;
  pendingBody: string;
  parseInput: (value: unknown) => RenameChatTools[Name]["input"];
  parseOutput: (value: unknown) => RenameChatTools[Name]["output"];
  execute?: (
    sdk: any,
    input: RenameChatTools[Name]["input"],
    requestContext: RenameChatRequestBody["requestContext"],
  ) => Promise<RenameChatTools[Name]["output"]>;
};

export const suspendedClientToolRegistry: {
  [Name in SuspendedClientToolName]: SuspendedClientToolDefinition<Name>;
} = {
  listContentTypes: {
    toolName: "listContentTypes",
    mode: "auto",
    phase: "listing-content-types",
    pendingTitle: "Listing content types",
    pendingBody: "Loading content types and field summaries from Contentful.",
    parseInput: (value) => listContentTypesToolInputSchema.parse(value),
    parseOutput: (value) => listContentTypesToolOutputSchema.parse(value),
    execute: async (sdk, input) => listContentTypes(sdk, input),
  },
  getContentType: {
    toolName: "getContentType",
    mode: "auto",
    phase: "listing-content-types",
    pendingTitle: "Loading content type",
    pendingBody: "Loading the requested content type definition from Contentful.",
    parseInput: (value) => getContentTypeToolInputSchema.parse(value),
    parseOutput: (value) => getContentTypeToolOutputSchema.parse(value),
    execute: async (sdk, input) => getContentType(sdk, input),
  },
  listEntries: {
    toolName: "listEntries",
    mode: "auto",
    phase: "searching-entries",
    pendingTitle: "Searching entries",
    pendingBody: "Running a structured entry search in Contentful.",
    parseInput: (value) => listEntriesToolInputSchema.parse(value),
    parseOutput: (value) => listEntriesToolOutputSchema.parse(value),
    execute: async (sdk, input, requestContext) =>
      listEntries(sdk, input, {
        defaultLocale: requestContext.defaultLocale,
      }),
  },
  getEntry: {
    toolName: "getEntry",
    mode: "auto",
    phase: "loading-entry-details",
    pendingTitle: "Loading entry details",
    pendingBody: "Reading the entry and its content type metadata from Contentful.",
    parseInput: (value) => getEntryToolInputSchema.parse(value),
    parseOutput: (value) => getEntryToolOutputSchema.parse(value),
    execute: async (sdk, input) => getEntry(sdk, input),
  },
  getLocales: {
    toolName: "getLocales",
    mode: "auto",
    phase: "listing-locales",
    pendingTitle: "Listing locales",
    pendingBody: "Loading available locales and fallback settings from Contentful.",
    parseInput: (value) => getLocalesToolInputSchema.parse(value),
    parseOutput: (value) => getLocalesToolOutputSchema.parse(value),
    execute: async (sdk) => getLocales(sdk),
  },
  listContentTypesClient: {
    toolName: "listContentTypesClient",
    mode: "auto",
    phase: "listing-content-types",
    pendingTitle: "Listing content types",
    pendingBody: "Loading content types and field summaries from Contentful.",
    parseInput: (value) => listContentTypesToolInputSchema.parse(value),
    parseOutput: (value) => listContentTypesToolOutputSchema.parse(value),
    execute: async (sdk, input) => listContentTypes(sdk, input),
  },
  getEntryDetailsClient: {
    toolName: "getEntryDetailsClient",
    mode: "auto",
    phase: "loading-entry-details",
    pendingTitle: "Loading entry details",
    pendingBody: "Reading the entry and its content type metadata from Contentful.",
    parseInput: (value) => getEntryDetailsToolInputSchema.parse(value),
    parseOutput: (value) => getEntryDetailsToolOutputSchema.parse(value),
    execute: async (sdk, input) => getEntryDetailsWithContentType(sdk, input),
  },
  readEntriesClient: {
    toolName: "readEntriesClient",
    mode: "auto",
    phase: "reading-entries",
    pendingTitle: "Reading entries",
    pendingBody: "Loading entry fields from Contentful for closer inspection.",
    parseInput: (value) => readEntriesToolInputSchema.parse(value),
    parseOutput: (value) => readEntriesToolOutputSchema.parse(value),
    execute: async (sdk, input) => readEntries(sdk, input),
  },
  getLocalesClient: {
    toolName: "getLocalesClient",
    mode: "auto",
    phase: "listing-locales",
    pendingTitle: "Listing locales",
    pendingBody: "Loading available locales and fallback settings from Contentful.",
    parseInput: (value) => getLocalesToolInputSchema.parse(value),
    parseOutput: (value) => getLocalesToolOutputSchema.parse(value),
    execute: async (sdk) => getLocales(sdk),
  },
  searchEntriesClient: {
    toolName: "searchEntriesClient",
    mode: "auto",
    phase: "searching-entries",
    pendingTitle: "Searching entries",
    pendingBody: "Running a structured entry search in Contentful.",
    parseInput: (value) => searchEntriesToolInputSchema.parse(value),
    parseOutput: (value) => searchEntriesToolOutputSchema.parse(value),
    execute: async (sdk, input, requestContext) =>
      searchEntries(sdk, input, {
        defaultLocale: requestContext.defaultLocale,
      }),
  },
  updateEntryAndPublishClient: {
    toolName: "updateEntryAndPublishClient",
    mode: "auto",
    phase: "publishing-entry-updates",
    pendingTitle: "Publishing entry updates",
    pendingBody: "Updating the requested entry and publishing the new version.",
    parseInput: (value) => updateEntryAndPublishToolInputSchema.parse(value),
    parseOutput: (value) => updateEntryAndPublishToolOutputSchema.parse(value),
    execute: async (sdk, input) => updateEntryAndPublish(sdk, input),
  },
  discoverCandidatesClient: {
    toolName: "discoverCandidatesClient",
    mode: "auto",
    phase: "searching-contentful",
    pendingTitle: "Searching Contentful",
    pendingBody: "Looking up rename candidates and preparing entry snapshots.",
    parseInput: (value) => discoverCandidatesToolInputSchema.parse(value),
    parseOutput: (value) => discoverCandidatesToolOutputSchema.parse(value),
    execute: async (sdk, input, requestContext) =>
      discoverRenameCandidates(sdk, input, {
        maxDiscoveryQueries: requestContext.maxDiscoveryQueries,
        semanticSearchEnabled: requestContext.toolAvailability.semanticSearch,
      }),
  },
  reviewProposalsClient: {
    toolName: "reviewProposalsClient",
    mode: "manual",
    phase: "reviewing-proposed-changes",
    pendingTitle: "Review proposed changes",
    pendingBody: "Waiting for a human reviewer to approve or edit the proposed changes.",
    parseInput: (value) => reviewProposalsToolInputSchema.parse(value),
    parseOutput: (value) => reviewProposalsToolOutputSchema.parse(value),
  },
  applyApprovedChangesClient: {
    toolName: "applyApprovedChangesClient",
    mode: "auto",
    phase: "applying-approved-changes",
    pendingTitle: "Applying approved changes",
    pendingBody: "Writing approved updates back to Contentful.",
    parseInput: (value) => applyApprovedChangesToolInputSchema.parse(value),
    parseOutput: (value) => applyApprovedChangesToolOutputSchema.parse(value),
    execute: async (sdk, input) => applyApprovedChanges(sdk, input),
  },
  validateApprovedChangesClient: {
    toolName: "validateApprovedChangesClient",
    mode: "auto",
    phase: "validating-approved-changes",
    pendingTitle: "Validating approved changes",
    pendingBody: "Checking entry versions, fields, locales, and supported patch targets before apply.",
    parseInput: (value) => validateApprovedChangesToolInputSchema.parse(value),
    parseOutput: (value) => validateApprovedChangesToolOutputSchema.parse(value),
    execute: async (sdk, input) => validateApprovedChanges(sdk, input),
  },
};

export function getSuspendedClientToolDefinition(toolName: string | null) {
  if (!toolName) {
    return null;
  }

  return suspendedClientToolRegistry[
    toolName as SuspendedClientToolName
  ] ?? null;
}

export function getAutoResumeClientToolDefinition(toolName: string | null) {
  const definition = getSuspendedClientToolDefinition(toolName);
  return definition?.mode === "auto" ? definition : null;
}
