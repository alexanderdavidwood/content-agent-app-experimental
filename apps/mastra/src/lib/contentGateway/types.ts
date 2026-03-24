import type {
  ChatExecutionContext,
  ContentEntryRecord,
  ContentTypeSummary,
  GetEntryToolOutput,
  GetLocalesToolOutput,
  ListContentTypesToolOutput,
  ListEntriesToolOutput,
  McpSessionStatus,
} from "@contentful-rename/shared";

export const GENERAL_CONTENT_TOOL_NAMES = [
  "listContentTypes",
  "getContentType",
  "listEntries",
  "getEntry",
  "getLocales",
] as const;

export type GeneralContentToolName = (typeof GENERAL_CONTENT_TOOL_NAMES)[number];

export const REMOTE_MCP_TOOL_NAME_BY_GENERAL_TOOL: Record<
  GeneralContentToolName,
  string
> = {
  listContentTypes: "list_content_types",
  getContentType: "get_content_type",
  listEntries: "search_entries",
  getEntry: "get_entry",
  getLocales: "list_locales",
};

export type GeneralContentToolOutputByName = {
  listContentTypes: ListContentTypesToolOutput;
  getContentType: ContentTypeSummary;
  listEntries: ListEntriesToolOutput;
  getEntry: GetEntryToolOutput;
  getLocales: GetLocalesToolOutput;
};

export type GeneralContentExecutionDecision = {
  mode: "remote-mcp" | "client-sdk";
  reason: string;
  sessionStatus: McpSessionStatus | null;
};

export type GeneralContentToolContext = {
  chatContext: ChatExecutionContext;
  sessionStatus: McpSessionStatus | null;
};

export type RemoteToolInvocationInput = {
  toolName: GeneralContentToolName;
  args: Record<string, unknown>;
  sessionId: string;
};

export type RemoteToolNormalizer<Name extends GeneralContentToolName> = (
  value: unknown,
  chatContext: ChatExecutionContext,
) => GeneralContentToolOutputByName[Name];

export type ContentTypeItemLike = {
  id?: string;
  name?: string;
  description?: string;
  displayField?: string;
  fields?: Array<{
    id?: string;
    name?: string;
    type?: string;
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
  sys?: {
    id?: string;
  };
};

export type EntryItemLike = {
  sys?: {
    id?: string;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
    publishedAt?: string;
    publishedVersion?: number;
    archivedAt?: string;
    contentType?: {
      sys?: {
        id?: string;
      };
    };
  };
  fields?: ContentEntryRecord["fields"];
};
