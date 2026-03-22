import { createTool } from "@mastra/core/tools";
import {
  chatExecutionContextSchema,
  createChatDebugError,
  getEntryDetailsToolInputSchema,
  getEntryDetailsToolOutputSchema,
  getLocalesToolInputSchema,
  getLocalesToolOutputSchema,
  listContentTypesToolInputSchema,
  listContentTypesToolOutputSchema,
  readEntriesToolInputSchema,
  readEntriesToolOutputSchema,
  searchEntriesToolInputSchema,
  searchEntriesToolOutputSchema,
  serializeChatDebugError,
  updateEntryAndPublishToolInputSchema,
  updateEntryAndPublishToolOutputSchema,
} from "@contentful-rename/shared";
import { z } from "zod";

const getEntryDetailsRequestSchema = z.object({
  entryId: z.string().min(1),
  locale: z.string().min(1).optional(),
  includeContentTypeFields: z.boolean().default(true),
});

const readEntriesRequestSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1).max(20),
  locales: z.array(z.string().min(1)).min(1).max(10).optional(),
});

function getChatContext(context: any) {
  return chatExecutionContextSchema.parse(context?.requestContext?.all ?? {});
}

function missingAgentError(message: string, phase: string, toolName: string) {
  return new Error(
    serializeChatDebugError(
      createChatDebugError(new Error(message), {
        code: "agent_context_missing",
        phase: phase as any,
        toolName,
      }),
    ),
  );
}

export const listContentTypesClientTool = createTool({
  id: "list-content-types-client",
  description:
    "List Contentful content types or inspect specific content type ids using the current app session.",
  inputSchema: listContentTypesToolInputSchema,
  outputSchema: listContentTypesToolOutputSchema,
  suspendSchema: listContentTypesToolInputSchema,
  resumeSchema: listContentTypesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw missingAgentError(
        "Agent context is required for listing content types.",
        "listing-content-types",
        "listContentTypesClient",
      );
    }

    if (!context.agent.resumeData) {
      await context.agent.suspend(listContentTypesToolInputSchema.parse(inputData));
      return undefined as never;
    }

    return listContentTypesToolOutputSchema.parse(context.agent.resumeData);
  },
});

export const getEntryDetailsClientTool = createTool({
  id: "get-entry-details-client",
  description:
    "Load a specific Contentful entry together with its content type metadata using the current app session.",
  inputSchema: getEntryDetailsRequestSchema,
  outputSchema: getEntryDetailsToolOutputSchema,
  suspendSchema: getEntryDetailsToolInputSchema,
  resumeSchema: getEntryDetailsToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw missingAgentError(
        "Agent context is required for loading entry details.",
        "loading-entry-details",
        "getEntryDetailsClient",
      );
    }

    if (!context.agent.resumeData) {
      const chatContext = getChatContext(context);

      await context.agent.suspend(
        getEntryDetailsToolInputSchema.parse({
          entryId: inputData.entryId,
          locale: inputData.locale ?? chatContext.defaultLocale,
          includeContentTypeFields: inputData.includeContentTypeFields,
        }),
      );
      return undefined as never;
    }

    return getEntryDetailsToolOutputSchema.parse(context.agent.resumeData);
  },
});

export const readEntriesClientTool = createTool({
  id: "read-entries-client",
  description:
    "Read one or more Contentful entries using the current app session.",
  inputSchema: readEntriesRequestSchema,
  outputSchema: readEntriesToolOutputSchema,
  suspendSchema: readEntriesToolInputSchema,
  resumeSchema: readEntriesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw missingAgentError(
        "Agent context is required for reading entries.",
        "reading-entries",
        "readEntriesClient",
      );
    }

    if (!context.agent.resumeData) {
      const chatContext = getChatContext(context);

      await context.agent.suspend(
        readEntriesToolInputSchema.parse({
          entryIds: inputData.entryIds,
          locales:
            inputData.locales && inputData.locales.length > 0
              ? inputData.locales
              : [chatContext.defaultLocale],
        }),
      );
      return undefined as never;
    }

    return readEntriesToolOutputSchema.parse(context.agent.resumeData);
  },
});

export const getLocalesClientTool = createTool({
  id: "get-locales-client",
  description:
    "List Contentful locales using the current app session.",
  inputSchema: getLocalesToolInputSchema,
  outputSchema: getLocalesToolOutputSchema,
  suspendSchema: getLocalesToolInputSchema,
  resumeSchema: getLocalesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw missingAgentError(
        "Agent context is required for listing locales.",
        "listing-locales",
        "getLocalesClient",
      );
    }

    if (!context.agent.resumeData) {
      await context.agent.suspend(getLocalesToolInputSchema.parse(inputData));
      return undefined as never;
    }

    return getLocalesToolOutputSchema.parse(context.agent.resumeData);
  },
});

export const searchEntriesClientTool = createTool({
  id: "search-entries-client",
  description:
    "Search Contentful entries using structured filters and the current app session. Use this only after filters are already structured.",
  inputSchema: searchEntriesToolInputSchema,
  outputSchema: searchEntriesToolOutputSchema,
  suspendSchema: searchEntriesToolInputSchema,
  resumeSchema: searchEntriesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw missingAgentError(
        "Agent context is required for entry search.",
        "searching-entries",
        "searchEntriesClient",
      );
    }

    if (!context.agent.resumeData) {
      const chatContext = getChatContext(context);
      if (!chatContext.toolAvailability.entrySearch) {
        throw new Error(
          serializeChatDebugError(
            createChatDebugError(
              new Error("Entry search is disabled in the current app configuration."),
              {
                code: "entry_search_disabled",
                phase: "searching-entries",
                toolName: "searchEntriesClient",
              },
            ),
          ),
        );
      }

      await context.agent.suspend(searchEntriesToolInputSchema.parse(inputData));
      return undefined as never;
    }

    return searchEntriesToolOutputSchema.parse(context.agent.resumeData);
  },
});

export const updateEntryAndPublishClientTool = createTool({
  id: "update-entry-and-publish-client",
  description:
    "Update a Contentful entry and publish it through the current app session.",
  inputSchema: updateEntryAndPublishToolInputSchema,
  outputSchema: updateEntryAndPublishToolOutputSchema,
  suspendSchema: updateEntryAndPublishToolInputSchema,
  resumeSchema: updateEntryAndPublishToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw missingAgentError(
        "Agent context is required for publishing entry updates.",
        "publishing-entry-updates",
        "updateEntryAndPublishClient",
      );
    }

    if (!context.agent.resumeData) {
      await context.agent.suspend(
        updateEntryAndPublishToolInputSchema.parse(inputData),
      );
      return undefined as never;
    }

    return updateEntryAndPublishToolOutputSchema.parse(context.agent.resumeData);
  },
});
