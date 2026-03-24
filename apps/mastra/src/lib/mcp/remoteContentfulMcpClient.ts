import { randomUUID } from "node:crypto";

import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  type OAuthClientInformationMixed,
  type OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  type OAuthClientProvider,
  UnauthorizedError,
  auth,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  type McpStoredBlob,
  getMcpSession,
  savePendingMcpSession,
  updateMcpSession,
} from "./sessionStore";

type DiscoveryState = Awaited<
  ReturnType<NonNullable<OAuthClientProvider["discoveryState"]>>
>;

type StoredProviderState = NonNullable<McpStoredBlob["oauth"]>;

function resolveServerUrl() {
  return process.env.CONTENTFUL_MCP_SERVER_URL?.trim() || "https://mcp.contentful.com/mcp";
}

export function resolvePublicAppBaseUrl(requestUrl?: string) {
  const configured = process.env.PUBLIC_APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  if (requestUrl) {
    return new URL(requestUrl).origin;
  }

  return "http://localhost:4111";
}

export function buildRedirectUrl(publicAppBaseUrl: string) {
  return `${publicAppBaseUrl}/mcp/connect/callback`;
}

export function buildClientMetadataUrl(publicAppBaseUrl: string) {
  return `${publicAppBaseUrl}/mcp/client-metadata`;
}

export function buildClientMetadataDocument(publicAppBaseUrl: string) {
  return {
    client_name: "Content Update Agent",
    redirect_uris: [buildRedirectUrl(publicAppBaseUrl)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    scope: "mcp:tools",
  };
}

function computeExpiresAt(tokens: OAuthTokens | undefined) {
  if (!tokens?.expires_in || !Number.isFinite(tokens.expires_in)) {
    return undefined;
  }

  return new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString();
}

class StoredOAuthProvider implements OAuthClientProvider {
  clientMetadataUrl?: string;
  private readonly redirectHandler?: (url: URL) => void;
  private readonly publicAppBaseUrl: string;
  private readonly sessionId: string;

  constructor(input: {
    sessionId: string;
    publicAppBaseUrl: string;
    onRedirect?: (url: URL) => void;
  }) {
    this.publicAppBaseUrl = input.publicAppBaseUrl;
    this.sessionId = input.sessionId;
    this.redirectHandler = input.onRedirect;
    this.clientMetadataUrl = buildClientMetadataUrl(this.publicAppBaseUrl);
  }

  get redirectUrl() {
    return buildRedirectUrl(this.publicAppBaseUrl);
  }

  get clientMetadata() {
    return buildClientMetadataDocument(this.publicAppBaseUrl);
  }

  async state() {
    const session = await this.requireSession();
    if (session.blob.oauth?.state) {
      return session.blob.oauth.state;
    }

    const nextState = randomUUID();
    await this.saveOauthPatch({
      state: nextState,
    });
    return nextState;
  }

  async clientInformation() {
    const session = await this.requireSession();
    return session.blob.oauth?.clientInformation as
      | OAuthClientInformationMixed
      | undefined;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed) {
    await this.saveOauthPatch({
      clientInformation,
    });
  }

  async tokens() {
    const session = await this.requireSession();
    return session.blob.oauth?.tokens as OAuthTokens | undefined;
  }

  async saveTokens(tokens: OAuthTokens) {
    await this.saveOauthPatch({
      tokens,
    });
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    if (!this.redirectHandler) {
      throw new Error("OAuth redirect handler is not configured.");
    }

    this.redirectHandler(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string) {
    await this.saveOauthPatch({
      codeVerifier,
    });
  }

  async codeVerifier() {
    const session = await this.requireSession();
    const codeVerifier = session.blob.oauth?.codeVerifier;
    if (!codeVerifier) {
      throw new Error("No PKCE code verifier stored for the current MCP session.");
    }

    return codeVerifier;
  }

  async saveDiscoveryState(state: DiscoveryState) {
    await this.saveOauthPatch({
      discoveryState: state,
    });
  }

  async discoveryState() {
    const session = await this.requireSession();
    return session.blob.oauth?.discoveryState as DiscoveryState;
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ) {
    const session = await this.requireSession();
    const current = session.blob.oauth ?? {};
    const next = { ...current };

    if (scope === "all" || scope === "client") {
      delete next.clientInformation;
    }
    if (scope === "all" || scope === "tokens") {
      delete next.tokens;
    }
    if (scope === "all" || scope === "verifier") {
      delete next.codeVerifier;
      delete next.state;
    }
    if (scope === "all" || scope === "discovery") {
      delete next.discoveryState;
    }

    await updateMcpSession(this.sessionId, {
      blob: {
        ...session.blob,
        oauth: next,
      },
    });
  }

  private async requireSession() {
    const session = await getMcpSession(this.sessionId);
    if (!session) {
      throw new Error(`Unknown MCP session ${this.sessionId}`);
    }

    return session;
  }

  private async saveOauthPatch(patch: Partial<StoredProviderState>) {
    const session = await this.requireSession();
    await updateMcpSession(this.sessionId, {
      blob: {
        ...session.blob,
        oauth: {
          ...(session.blob.oauth ?? {}),
          ...patch,
        },
      },
    });
  }
}

function extractToolResultData(result: unknown) {
  const parsed = CallToolResultSchema.parse(result);
  if (parsed.structuredContent) {
    return parsed.structuredContent;
  }

  const textPart = parsed.content.find((part) => part.type === "text");
  if (!textPart) {
    return null;
  }

  try {
    return JSON.parse(textPart.text);
  } catch {
    return textPart.text;
  }
}

async function connectClient(input: {
  sessionId: string;
  publicAppBaseUrl: string;
}) {
  const provider = new StoredOAuthProvider({
    sessionId: input.sessionId,
    publicAppBaseUrl: input.publicAppBaseUrl,
  });
  const session = await getMcpSession(input.sessionId);
  const transport = new StreamableHTTPClientTransport(
    new URL(resolveServerUrl()),
    {
      authProvider: provider,
      ...(session?.blob.transportSessionId
        ? { sessionId: session.blob.transportSessionId }
        : {}),
    },
  );
  const client = new McpClient(
    {
      name: "content-update-agent",
      version: "0.1.0",
    },
    {
      capabilities: {},
    },
  );
  await client.connect(transport);

  return {
    client,
    transport,
    provider,
  };
}

export async function beginContentfulMcpAuthorization(input: {
  sessionId?: string;
  publicAppBaseUrl?: string;
  requestUrl?: string;
  uiOrigin?: string;
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
}): Promise<{
  sessionId: string;
  redirectUrl: URL;
  publicAppBaseUrl: string;
}> {
  const sessionId = input.sessionId ?? randomUUID();
  const publicAppBaseUrl = resolvePublicAppBaseUrl(
    input.publicAppBaseUrl ?? input.requestUrl,
  );

  await savePendingMcpSession({
    sessionId,
    spaceId: input.spaceId,
    environmentId: input.environmentId,
    organizationId: input.organizationId,
    contentfulUserId: input.contentfulUserId,
    blob: {
      uiOrigin: input.uiOrigin,
    },
  });

  let redirectUrl: URL | null = null;
  const provider = new StoredOAuthProvider({
    sessionId,
    publicAppBaseUrl,
    onRedirect: (url) => {
      redirectUrl = url;
    },
  });

  const result = await auth(provider, {
    serverUrl: resolveServerUrl(),
  });

  if (result !== "REDIRECT" || !redirectUrl) {
    throw new Error("Contentful MCP authorization did not produce a redirect URL.");
  }

  return {
    sessionId,
    redirectUrl,
    publicAppBaseUrl,
  };
}

export async function completeContentfulMcpAuthorization(input: {
  sessionId: string;
  authorizationCode: string;
  expectedState?: string;
  publicAppBaseUrl?: string;
  requestUrl?: string;
}) {
  const pendingSession = await getMcpSession(input.sessionId);
  if (!pendingSession) {
    throw new Error(`Unknown MCP session ${input.sessionId}`);
  }

  const savedState = pendingSession.blob.oauth?.state;
  if (input.expectedState && savedState && input.expectedState !== savedState) {
    throw new Error("OAuth state mismatch for Contentful MCP authorization.");
  }

  const publicAppBaseUrl = resolvePublicAppBaseUrl(
    input.publicAppBaseUrl ?? input.requestUrl,
  );
  const provider = new StoredOAuthProvider({
    sessionId: input.sessionId,
    publicAppBaseUrl,
  });

  await auth(provider, {
    serverUrl: resolveServerUrl(),
    authorizationCode: input.authorizationCode,
  });

  const { client, transport } = await connectClient({
    sessionId: input.sessionId,
    publicAppBaseUrl,
  });

  const toolList = await client.listTools();
  const availableTools = toolList.tools.map((tool) => tool.name);
  let initialContext: unknown = null;

  if (availableTools.includes("get_initial_context")) {
    initialContext = extractToolResultData(
      await client.callTool({
        name: "get_initial_context",
        arguments: {},
      }),
    );
  }

  const tokens = await provider.tokens();
  const session = await getMcpSession(input.sessionId);
  if (!session) {
    throw new Error(`Unknown MCP session ${input.sessionId}`);
  }

  await updateMcpSession(input.sessionId, {
    status: "connected",
    connectedAt: new Date().toISOString(),
    expiresAt: computeExpiresAt(tokens),
    availableTools,
    initialContext,
    lastError: null,
    blob: {
      ...(session.blob ?? {}),
      oauth: {
        ...(session.blob.oauth ?? {}),
        tokens,
      },
      transportSessionId: transport.sessionId,
      availableTools,
      initialContext,
    },
  });

  await transport.close();

  return {
    sessionId: input.sessionId,
    availableTools,
    initialContext,
  };
}

export async function callContentfulMcpTool(input: {
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  publicAppBaseUrl?: string;
}) {
  const { client, transport } = await connectClient({
    sessionId: input.sessionId,
    publicAppBaseUrl: resolvePublicAppBaseUrl(input.publicAppBaseUrl),
  });

  try {
    const result = await client.callTool({
      name: input.toolName,
      arguments: input.args,
    });
    return extractToolResultData(result);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      await updateMcpSession(input.sessionId, {
        status: "expired",
        lastError: error.message,
      });
    } else if (error instanceof StreamableHTTPError) {
      await updateMcpSession(input.sessionId, {
        lastError: error.message,
      });
    }

    throw error;
  } finally {
    await transport.close().catch(() => undefined);
  }
}
