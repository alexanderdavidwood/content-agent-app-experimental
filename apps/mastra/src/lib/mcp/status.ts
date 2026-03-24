import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import type {
  ChatExecutionContext,
  ContentOpsProvider,
  GeneralContentToolAvailability,
  McpEnvironmentSetupStatus,
  McpSessionStatus,
} from "@contentful-rename/shared";
import {
  mcpEnvironmentSetupStatusSchema,
  mcpSessionStatusSchema,
} from "@contentful-rename/shared";

import { hasClientSdkFallback } from "../contentGateway/clientSdkFallbackGateway";
import { getMcpSession, type StoredMcpSession } from "./sessionStore";
import {
  GENERAL_CONTENT_TOOL_NAMES,
  REMOTE_MCP_TOOL_NAME_BY_GENERAL_TOOL,
  type GeneralContentToolName,
} from "../contentGateway/types";

export const MCP_SESSION_COOKIE_NAME = "contentful_mcp_sid";

const requiredEnvironmentCategories = [
  {
    category: "content types",
    access: "read-only" as const,
    tools: ["list_content_types", "get_content_type"],
  },
  {
    category: "entries",
    access: "read-only" as const,
    tools: ["search_entries", "get_entry"],
  },
  {
    category: "locales",
    access: "read-only" as const,
    tools: ["list_locales"],
  },
] as const;

function resolveAppSessionSecret() {
  const configured = process.env.APP_SESSION_SECRET?.trim();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SESSION_SECRET is required in production.");
  }

  return createHash("sha256")
    .update("content-update-agent-dev-app-session-secret")
    .digest("hex");
}

function isSecureRequest(requestUrl?: string) {
  const configuredBase = process.env.PUBLIC_APP_BASE_URL?.trim();
  const candidate = configuredBase || requestUrl;

  return Boolean(candidate && /^https:\/\//i.test(candidate));
}

function cookieOptions(requestUrl?: string) {
  const secure = isSecureRequest(requestUrl);

  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("None" as const) : ("Lax" as const),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

function signCookieValue(value: string) {
  return createHmac("sha256", resolveAppSessionSecret())
    .update(value)
    .digest("base64url");
}

function encodeSignedCookieValue(value: string) {
  const signature = signCookieValue(value);
  return encodeURIComponent(`${value}.${signature}`);
}

function decodeSignedCookieValue(value: string | undefined) {
  if (!value) {
    return null;
  }

  const decoded = decodeURIComponent(value);
  const separatorIndex = decoded.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const unsignedValue = decoded.slice(0, separatorIndex);
  const signature = decoded.slice(separatorIndex + 1);
  const expectedSignature = signCookieValue(unsignedValue);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  return unsignedValue;
}

function parseCookieHeader(header: string | undefined) {
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        if (separatorIndex < 0) {
          return [part, ""];
        }

        return [part.slice(0, separatorIndex), part.slice(separatorIndex + 1)];
      }),
  );
}

function buildSetCookieValue(
  name: string,
  value: string,
  options: ReturnType<typeof cookieOptions>,
) {
  return [
    `${name}=${value}`,
    `Max-Age=${options.maxAge}`,
    "HttpOnly",
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
    ...(options.secure ? ["Secure"] : []),
  ].join("; ");
}

function matchesExpectedScope(
  session: StoredMcpSession,
  expected: {
    spaceId?: string;
    environmentId?: string;
    organizationId?: string;
    contentfulUserId?: string;
  },
) {
  return (
    (!expected.spaceId || expected.spaceId === session.spaceId) &&
    (!expected.environmentId || expected.environmentId === session.environmentId) &&
    (!expected.organizationId || expected.organizationId === session.organizationId) &&
    (!expected.contentfulUserId ||
      expected.contentfulUserId === session.contentfulUserId)
  );
}

function computeEffectiveTools(input: {
  provider: ContentOpsProvider;
  generalContentToolAvailability: GeneralContentToolAvailability;
  mcpAutoFallbackToClientSdk: boolean;
  session: StoredMcpSession | null;
}) {
  return GENERAL_CONTENT_TOOL_NAMES.map((toolName) => {
    const enabledInAppConfig = input.generalContentToolAvailability[toolName];
    const availableViaMcp = Boolean(
      input.session?.availableTools.includes(
        REMOTE_MCP_TOOL_NAME_BY_GENERAL_TOOL[toolName],
      ),
    );
    const fallbackAvailable = hasClientSdkFallback(toolName);

    let status:
      | "enabled"
      | "disabled_in_app"
      | "mcp_unavailable"
      | "blocked_upstream"
      | "fallback_only" = "enabled";
    let reason: string | undefined;

    if (!enabledInAppConfig) {
      status = "disabled_in_app";
      reason = "Disabled in this app installation.";
    } else if (input.provider === "client-sdk") {
      status = "fallback_only";
      reason = "Configured to use the client SDK provider.";
    } else if (availableViaMcp && input.session?.status === "connected") {
      status = "enabled";
      reason = "Available from the connected Contentful MCP session.";
    } else if (
      input.provider === "hybrid" &&
      input.mcpAutoFallbackToClientSdk &&
      fallbackAvailable
    ) {
      status = "fallback_only";
      reason =
        input.session?.status === "connected"
          ? "Blocked upstream in Contentful MCP; client SDK fallback remains available."
          : "Contentful MCP is unavailable; client SDK fallback remains available.";
    } else if (input.session?.status === "connected") {
      status = "blocked_upstream";
      reason = "The current Contentful MCP session does not expose this tool.";
    } else {
      status = "mcp_unavailable";
      reason = "No connected Contentful MCP session is available.";
    }

    return {
      toolName,
      enabledInAppConfig,
      availableViaMcp,
      fallbackAvailable,
      status,
      reason,
    };
  });
}

function computeSessionState(session: StoredMcpSession | null, missingTools: string[]) {
  if (!session) {
    return "disconnected" as const;
  }

  if (session.status === "expired") {
    return "expired" as const;
  }

  if (session.status === "error") {
    return "error" as const;
  }

  if (session.status !== "connected") {
    return "disconnected" as const;
  }

  if (missingTools.length > 0) {
    return "admin_setup_required" as const;
  }

  return "connected" as const;
}

function requiredRemoteToolNames() {
  return requiredEnvironmentCategories.flatMap((category) => category.tools);
}

export async function readMcpSessionIdFromCookie(c: Context) {
  const cookies = parseCookieHeader(c.req.header("Cookie"));
  return decodeSignedCookieValue(cookies[MCP_SESSION_COOKIE_NAME]);
}

export async function writeMcpSessionCookie(
  c: Context,
  sessionId: string,
  requestUrl?: string,
) {
  c.header(
    "Set-Cookie",
    buildSetCookieValue(
      MCP_SESSION_COOKIE_NAME,
      encodeSignedCookieValue(sessionId),
      cookieOptions(requestUrl),
    ),
    {
      append: true,
    },
  );
}

export function clearMcpSessionCookie(c: Context, requestUrl?: string) {
  c.header(
    "Set-Cookie",
    buildSetCookieValue(
      MCP_SESSION_COOKIE_NAME,
      "",
      {
        ...cookieOptions(requestUrl),
        maxAge: 0,
      },
    ),
    {
      append: true,
    },
  );
}

export async function getScopedMcpSession(input: {
  sessionId?: string | null;
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
}) {
  if (!input.sessionId) {
    return null;
  }

  const session = await getMcpSession(input.sessionId);
  if (!session) {
    return null;
  }

  return matchesExpectedScope(session, input) ? session : null;
}

export async function buildMcpSessionStatus(input: {
  provider: ContentOpsProvider;
  generalContentToolAvailability: GeneralContentToolAvailability;
  mcpAutoFallbackToClientSdk: boolean;
  sessionId?: string | null;
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
}): Promise<McpSessionStatus> {
  const session = await getScopedMcpSession(input);
  const missingTools =
    session?.status === "connected"
      ? requiredRemoteToolNames().filter(
          (toolName) => !session.availableTools.includes(toolName),
        )
      : [];

  return mcpSessionStatusSchema.parse({
    provider: input.provider,
    state: computeSessionState(session, missingTools),
    sessionId: session?.sessionId,
    sessionCookieId: session?.sessionId,
    connectedAt: session?.connectedAt,
    expiresAt: session?.expiresAt,
    spaceId: session?.spaceId ?? input.spaceId,
    environmentId: session?.environmentId ?? input.environmentId,
    contentfulUserId: session?.contentfulUserId ?? input.contentfulUserId,
    availableTools: session?.availableTools ?? [],
    effectiveTools: computeEffectiveTools({
      provider: input.provider,
      generalContentToolAvailability: input.generalContentToolAvailability,
      mcpAutoFallbackToClientSdk: input.mcpAutoFallbackToClientSdk,
      session,
    }),
    lastError: session?.lastError,
  });
}

export async function buildMcpEnvironmentSetupStatus(input: {
  provider: ContentOpsProvider;
  sessionId?: string | null;
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
}): Promise<McpEnvironmentSetupStatus> {
  const session = await getScopedMcpSession(input);
  const missingTools = session
    ? requiredRemoteToolNames().filter(
        (toolName) => !session.availableTools.includes(toolName),
      )
    : requiredRemoteToolNames();

  return mcpEnvironmentSetupStatusSchema.parse({
    provider: input.provider,
    state:
      input.provider === "client-sdk"
        ? "ready"
        : !session
          ? "missing_session"
          : missingTools.length > 0
            ? "admin_setup_required"
            : "ready",
    spaceId: input.spaceId ?? session?.spaceId,
    environmentId: input.environmentId ?? session?.environmentId,
    requiredCategories: requiredEnvironmentCategories.map((category) => ({
      category: category.category,
      access: category.access,
    })),
    availableTools: session?.availableTools ?? [],
    missingTools,
    message:
      input.provider === "client-sdk"
        ? "Remote MCP is disabled for this installation."
        : !session
          ? "Connect a Contentful MCP session to inspect the current environment."
          : missingTools.length > 0
            ? "The current environment is missing one or more required read-only MCP tools."
            : "The current environment exposes the required read-only MCP tools.",
  });
}

export function buildChatContextWithSession(
  chatContext: ChatExecutionContext,
  sessionStatus: McpSessionStatus,
) {
  return {
    ...chatContext,
    mcpSession: sessionStatus,
  };
}
