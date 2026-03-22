import { createTool } from "@mastra/core/tools";
import {
  createChatDebugError,
  serializeChatDebugError,
  type ChatExecutionContext,
  getEntryDetailsToolInputSchema,
  getEntryDetailsToolOutputSchema,
  listContentTypesToolInputSchema,
  listContentTypesToolOutputSchema,
  readEntriesToolInputSchema,
  readEntriesToolOutputSchema,
  updateEntryAndPublishToolInputSchema,
  updateEntryAndPublishToolOutputSchema,
  chatExecutionContextSchema,
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

function requireAgentContext(toolName: string, phase: ChatExecutionContextPhase) {
  return serializeChatDebugError(
    createChatDebugError(new Error(`Agent context is required for ${toolName}.`), {
      code: "agent_context_missing",
      phase,
      toolName,
    }),
  );
}

type ChatExecutionContextPhase =
  | "listing-content-types"
  | "loading-entry-details"
  | "reading-entries"
  | "publishing-entry-updates";

export const listContentTypesClientTool = createTool({
  id: "list-content-types-client",
  description:
    "List Contentful content types or look up specific content type ids using the current Contentful app permissions.",
  inputSchema: listContentTypesToolInputSchema,
  outputSchema: listContentTypesToolOutputSchema,
  suspendSchema: listContentTypesToolInputSchema,
  resumeSchema: listContentTypesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw new Error(
        requireAgentContext("listContentTypesClient", "listing-content-types"),
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
    "Load a Contentful entry with its content type metadata using the current Contentful app permissions.",
  inputSchema: getEntryDetailsRequestSchema,
  outputSchema: getEntryDetailsToolOutputSchema,
  suspendSchema: getEntryDetailsToolInputSchema,
  resumeSchema: getEntryDetailsToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw new Error(
        requireAgentContext("getEntryDetailsClient", "loading-entry-details"),
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
    "Read one or more Contentful entries using the current Contentful app permissions.",
  inputSchema: readEntriesRequestSchema,
  outputSchema: readEntriesToolOutputSchema,
  suspendSchema: readEntriesToolInputSchema,
  resumeSchema: readEntriesToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw new Error(
        requireAgentContext("readEntriesClient", "reading-entries"),
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

export const updateEntryAndPublishClientTool = createTool({
  id: "update-entry-and-publish-client",
  description:
    "Update a Contentful entry and publish it through the current Contentful app session.",
  inputSchema: updateEntryAndPublishToolInputSchema,
  outputSchema: updateEntryAndPublishToolOutputSchema,
  suspendSchema: updateEntryAndPublishToolInputSchema,
  resumeSchema: updateEntryAndPublishToolOutputSchema,
  requestContextSchema: chatExecutionContextSchema,
  execute: async (inputData, context) => {
    if (!context.agent) {
      throw new Error(
        requireAgentContext(
          "updateEntryAndPublishClient",
          "publishing-entry-updates",
        ),
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
