import { createTool } from "@mastra/core/tools";
import {
  chatExecutionContextSchema,
  createChatDebugError,
  getContentTypeToolInputSchema,
  getContentTypeToolOutputSchema,
  getEntryToolInputSchema,
  getEntryToolOutputSchema,
  getLocalesToolInputSchema,
  getLocalesToolOutputSchema,
  listContentTypesToolInputSchema,
  listContentTypesToolOutputSchema,
  listEntriesToolInputSchema,
  listEntriesToolOutputSchema,
  readEntriesToolInputSchema,
  readEntriesToolOutputSchema,
  serializeChatDebugError,
  updateEntryAndPublishToolInputSchema,
  updateEntryAndPublishToolOutputSchema,
} from "@contentful-rename/shared";
import type { ZodTypeAny } from "zod";
import { z } from "zod";

import { executeRemoteGeneralContentTool } from "../lib/contentGateway/remoteMcpGateway";
import { resolveGeneralContentToolExecution } from "../lib/contentGateway/resolveGeneralContentToolExecution";
import type { GeneralContentToolName } from "../lib/contentGateway/types";

const getEntryRequestSchema = z.object({
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

function disabledToolError(toolName: string, phase: string, message: string) {
  return new Error(
    serializeChatDebugError(
      createChatDebugError(new Error(message), {
        code: "tool_disabled",
        phase: phase as any,
        toolName,
      }),
    ),
  );
}

function clientFallbackInputError(toolName: string, phase: string, message: string) {
  return new Error(
    serializeChatDebugError(
      createChatDebugError(new Error(message), {
        code: "mcp_session_unavailable",
        phase: phase as any,
        toolName,
      }),
    ),
  );
}

function buildHybridGeneralContentTool<
  Name extends GeneralContentToolName,
  RequestInput,
>({
  id,
  toolName,
  phase,
  description,
  requestSchema,
  suspendSchema,
  outputSchema,
  prepareSuspendInput,
  prepareRemoteInput,
}: {
  id: string;
  toolName: Name;
  phase: string;
  description: string;
  requestSchema: ZodTypeAny;
  suspendSchema: ZodTypeAny;
  outputSchema: ZodTypeAny;
  prepareSuspendInput: (
    input: RequestInput,
    chatContext: ReturnType<typeof getChatContext>,
  ) => Record<string, unknown>;
  prepareRemoteInput?: (
    input: RequestInput,
    chatContext: ReturnType<typeof getChatContext>,
  ) => Record<string, unknown>;
}) {
  return createTool({
    id,
    description,
    inputSchema: requestSchema,
    outputSchema,
    suspendSchema,
    resumeSchema: outputSchema,
    requestContextSchema: chatExecutionContextSchema,
    execute: async (inputData, context) => {
      if (context.agent?.resumeData) {
        return outputSchema.parse(context.agent.resumeData);
      }

      const chatContext = getChatContext(context);
      const requestInput = requestSchema.parse(inputData) as RequestInput;
      let decision;

      try {
        decision = resolveGeneralContentToolExecution(toolName, chatContext);
      } catch (error) {
        throw disabledToolError(
          toolName,
          phase,
          error instanceof Error ? error.message : String(error),
        );
      }

      const preparedSuspendInput = prepareSuspendInput(requestInput, chatContext);
      const preparedRemoteInput = prepareRemoteInput
        ? prepareRemoteInput(requestInput, chatContext)
        : preparedSuspendInput;

      if (decision.mode === "remote-mcp") {
        const sessionId = decision.sessionStatus?.sessionId;
        if (!sessionId) {
          throw clientFallbackInputError(
            toolName,
            phase,
            "Remote MCP mode was selected but no session id is available.",
          );
        }

        return outputSchema.parse(
          await executeRemoteGeneralContentTool(
            toolName,
            preparedRemoteInput,
            chatContext,
            sessionId,
          ),
        );
      }

      if (!context.agent) {
        throw missingAgentError(
          "Agent context is required for client SDK fallback.",
          phase,
          toolName,
        );
      }

      await context.agent.suspend(suspendSchema.parse(preparedSuspendInput));
      return undefined as never;
    },
  });
}

export const listContentTypesTool = buildHybridGeneralContentTool({
  id: "list-content-types",
  toolName: "listContentTypes",
  phase: "listing-content-types",
  description:
    "List Contentful content types, using remote Contentful MCP when available and falling back to the current app session when needed.",
  requestSchema: listContentTypesToolInputSchema,
  suspendSchema: listContentTypesToolInputSchema,
  outputSchema: listContentTypesToolOutputSchema,
  prepareSuspendInput: (input) => listContentTypesToolInputSchema.parse(input),
});

export const getContentTypeTool = buildHybridGeneralContentTool({
  id: "get-content-type",
  toolName: "getContentType",
  phase: "loading-content-type",
  description:
    "Load one specific Contentful content type, preferring remote Contentful MCP and falling back to the current app session when needed.",
  requestSchema: getContentTypeToolInputSchema,
  suspendSchema: getContentTypeToolInputSchema,
  outputSchema: getContentTypeToolOutputSchema,
  prepareSuspendInput: (input) => getContentTypeToolInputSchema.parse(input),
});

export const listEntriesTool = buildHybridGeneralContentTool({
  id: "list-entries",
  toolName: "listEntries",
  phase: "searching-entries",
  description:
    "List Contentful entries using structured filters, preferring remote Contentful MCP and falling back to the current app session when needed.",
  requestSchema: listEntriesToolInputSchema,
  suspendSchema: listEntriesToolInputSchema,
  outputSchema: listEntriesToolOutputSchema,
  prepareSuspendInput: (input) => listEntriesToolInputSchema.parse(input),
});

export const getEntryTool = buildHybridGeneralContentTool({
  id: "get-entry",
  toolName: "getEntry",
  phase: "loading-entry-details",
  description:
    "Load a specific Contentful entry and its content type metadata, preferring remote Contentful MCP and falling back to the current app session when needed.",
  requestSchema: getEntryRequestSchema,
  suspendSchema: getEntryToolInputSchema,
  outputSchema: getEntryToolOutputSchema,
  prepareSuspendInput: (input, chatContext) => {
    const parsed = getEntryRequestSchema.parse(input);
    return getEntryToolInputSchema.parse({
      entryId: parsed.entryId,
      locale: parsed.locale ?? chatContext.defaultLocale,
      includeContentTypeFields: parsed.includeContentTypeFields,
    });
  },
});

export const getLocalesTool = buildHybridGeneralContentTool({
  id: "get-locales",
  toolName: "getLocales",
  phase: "listing-locales",
  description:
    "List Contentful locales, preferring remote Contentful MCP and falling back to the current app session when needed.",
  requestSchema: getLocalesToolInputSchema,
  suspendSchema: getLocalesToolInputSchema,
  outputSchema: getLocalesToolOutputSchema,
  prepareSuspendInput: (input) => getLocalesToolInputSchema.parse(input),
});

// Legacy suspended client tools stay available for compatibility with older traces and tests.
export const listContentTypesClientTool = listContentTypesTool;
export const getEntryDetailsClientTool = getEntryTool;
export const getLocalesClientTool = getLocalesTool;
export const searchEntriesClientTool = listEntriesTool;

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

    if (context.agent.resumeData) {
      return readEntriesToolOutputSchema.parse(context.agent.resumeData);
    }

    const chatContext = getChatContext(context);
    const parsed = readEntriesRequestSchema.parse(inputData);

    await context.agent.suspend(
      readEntriesToolInputSchema.parse({
        entryIds: parsed.entryIds,
        locales:
          parsed.locales && parsed.locales.length > 0
            ? parsed.locales
            : [chatContext.defaultLocale],
      }),
    );

    return undefined as never;
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
