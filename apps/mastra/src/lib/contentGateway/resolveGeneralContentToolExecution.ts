import type {
  ChatExecutionContext,
  GeneralContentToolAvailability,
  McpSessionStatus,
} from "@contentful-rename/shared";

import { hasClientSdkFallback } from "./clientSdkFallbackGateway";
import type {
  GeneralContentExecutionDecision,
  GeneralContentToolName,
} from "./types";
import { REMOTE_MCP_TOOL_NAME_BY_GENERAL_TOOL } from "./types";

function isToolEnabled(
  availability: GeneralContentToolAvailability,
  toolName: GeneralContentToolName,
) {
  return availability[toolName];
}

function isSessionUsable(sessionStatus: McpSessionStatus | null) {
  return sessionStatus?.state === "connected";
}

export function resolveGeneralContentToolExecution(
  toolName: GeneralContentToolName,
  chatContext: ChatExecutionContext,
  sessionStatus: McpSessionStatus | null = chatContext.mcpSession ?? null,
): GeneralContentExecutionDecision {
  if (!isToolEnabled(chatContext.generalContentToolAvailability, toolName)) {
    throw new Error(
      `Tool "${toolName}" is disabled in the current app configuration.`,
    );
  }

  if (chatContext.contentOpsProvider === "client-sdk") {
    return {
      mode: "client-sdk",
      reason: "Configured to use the client SDK provider.",
      sessionStatus,
    };
  }

  const remoteToolName = REMOTE_MCP_TOOL_NAME_BY_GENERAL_TOOL[toolName];
  const availableViaMcp = Boolean(
    isSessionUsable(sessionStatus) &&
      sessionStatus?.availableTools.includes(remoteToolName),
  );

  if (availableViaMcp) {
    return {
      mode: "remote-mcp",
      reason: "Remote Contentful MCP session is connected and exposes the tool.",
      sessionStatus,
    };
  }

  const fallbackAllowed =
    chatContext.contentOpsProvider === "hybrid" &&
    chatContext.mcpAutoFallbackToClientSdk &&
    hasClientSdkFallback(toolName);

  if (fallbackAllowed) {
    return {
      mode: "client-sdk",
      reason:
        sessionStatus?.state === "admin_setup_required"
          ? "Remote MCP is connected but blocked by upstream configuration; falling back to the client SDK."
          : "Remote MCP is unavailable for this tool; falling back to the client SDK.",
      sessionStatus,
    };
  }

  if (!isSessionUsable(sessionStatus)) {
    throw new Error(
      `Tool "${toolName}" requires a connected Contentful MCP session.`,
    );
  }

  throw new Error(
    `Tool "${toolName}" is not available from the current Contentful MCP session.`,
  );
}
