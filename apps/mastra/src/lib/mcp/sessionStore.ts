import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { createClient, type Client } from "@libsql/client";

export type McpStoredBlob = {
  uiOrigin?: string;
  oauth?: {
    state?: string;
    codeVerifier?: string;
    clientInformation?: unknown;
    tokens?: {
      access_token: string;
      token_type: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
      [key: string]: unknown;
    };
    discoveryState?: unknown;
  };
  transportSessionId?: string;
  availableTools?: string[];
  initialContext?: unknown;
};

export type StoredMcpSession = {
  sessionId: string;
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
  status: string;
  connectedAt?: string;
  expiresAt?: string;
  availableTools: string[];
  initialContext?: unknown;
  lastError?: string;
  blob: McpStoredBlob;
};

function envFlag(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function resolveStorageUrl() {
  return (
    process.env.MASTRA_STORAGE_URL?.trim() ||
    "file:./.mastra/contentful-rename.db"
  );
}

function resolveStorageAuthToken() {
  return (
    process.env.MASTRA_STORAGE_AUTH_TOKEN?.trim() ||
    process.env.TURSO_AUTH_TOKEN?.trim() ||
    process.env.DATABASE_AUTH_TOKEN?.trim()
  );
}

function resolveEncryptionKey() {
  const configured = process.env.MCP_SESSION_ENCRYPTION_KEY?.trim();
  if (configured) {
    return createHash("sha256").update(configured).digest();
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("MCP_SESSION_ENCRYPTION_KEY is required in production.");
  }

  return createHash("sha256")
    .update("content-update-agent-dev-mcp-session-key")
    .digest();
}

function encryptJson(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function decryptJson<T>(encrypted: string | null | undefined): T {
  if (!encrypted) {
    return {} as T;
  }

  const [ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored MCP session blob is malformed.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    resolveEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}

let sharedClient: Client | null = null;
let schemaReady: Promise<void> | null = null;

function getClient() {
  if (sharedClient) {
    return sharedClient;
  }

  const url = resolveStorageUrl();
  const authToken = resolveStorageAuthToken();
  sharedClient = createClient({
    url,
    ...(authToken ? { authToken } : {}),
  });
  return sharedClient;
}

async function ensureSchema() {
  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    const client = getClient();
    await client.execute(`
      CREATE TABLE IF NOT EXISTS contentful_mcp_sessions (
        session_id TEXT PRIMARY KEY,
        space_id TEXT,
        environment_id TEXT,
        organization_id TEXT,
        contentful_user_id TEXT,
        encrypted_mcp_session_blob TEXT NOT NULL,
        status TEXT NOT NULL,
        connected_at TEXT,
        expires_at TEXT,
        last_initial_context_json TEXT,
        last_capabilities_json TEXT,
        last_error TEXT,
        updated_at TEXT NOT NULL
      )
    `);
  })();

  return schemaReady;
}

function rowToSession(row: Record<string, unknown>): StoredMcpSession {
  return {
    sessionId: String(row.session_id),
    spaceId:
      typeof row.space_id === "string" && row.space_id.length > 0
        ? row.space_id
        : undefined,
    environmentId:
      typeof row.environment_id === "string" && row.environment_id.length > 0
        ? row.environment_id
        : undefined,
    organizationId:
      typeof row.organization_id === "string" && row.organization_id.length > 0
        ? row.organization_id
        : undefined,
    contentfulUserId:
      typeof row.contentful_user_id === "string" &&
      row.contentful_user_id.length > 0
        ? row.contentful_user_id
        : undefined,
    status: String(row.status),
    connectedAt:
      typeof row.connected_at === "string" && row.connected_at.length > 0
        ? row.connected_at
        : undefined,
    expiresAt:
      typeof row.expires_at === "string" && row.expires_at.length > 0
        ? row.expires_at
        : undefined,
    availableTools:
      typeof row.last_capabilities_json === "string" && row.last_capabilities_json
        ? JSON.parse(row.last_capabilities_json)
        : [],
    initialContext:
      typeof row.last_initial_context_json === "string" &&
      row.last_initial_context_json
        ? JSON.parse(row.last_initial_context_json)
        : undefined,
    lastError:
      typeof row.last_error === "string" && row.last_error.length > 0
        ? row.last_error
        : undefined,
    blob: decryptJson<McpStoredBlob>(String(row.encrypted_mcp_session_blob)),
  };
}

export async function savePendingMcpSession(input: {
  sessionId: string;
  spaceId?: string;
  environmentId?: string;
  organizationId?: string;
  contentfulUserId?: string;
  blob?: McpStoredBlob;
}) {
  await ensureSchema();
  const client = getClient();
  const updatedAt = new Date().toISOString();

  await client.execute({
    sql: `
      INSERT INTO contentful_mcp_sessions (
        session_id,
        space_id,
        environment_id,
        organization_id,
        contentful_user_id,
        encrypted_mcp_session_blob,
        status,
        connected_at,
        expires_at,
        last_initial_context_json,
        last_capabilities_json,
        last_error,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        space_id = excluded.space_id,
        environment_id = excluded.environment_id,
        organization_id = excluded.organization_id,
        contentful_user_id = excluded.contentful_user_id,
        encrypted_mcp_session_blob = excluded.encrypted_mcp_session_blob,
        status = excluded.status,
        last_capabilities_json = excluded.last_capabilities_json,
        updated_at = excluded.updated_at
    `,
    args: [
      input.sessionId,
      input.spaceId ?? null,
      input.environmentId ?? null,
      input.organizationId ?? null,
      input.contentfulUserId ?? null,
      encryptJson(input.blob ?? {}),
      "pending_auth",
      JSON.stringify([]),
      updatedAt,
    ],
  });
}

export async function getMcpSession(sessionId: string) {
  await ensureSchema();
  const client = getClient();
  const result = await client.execute({
    sql: `
      SELECT
        session_id,
        space_id,
        environment_id,
        organization_id,
        contentful_user_id,
        encrypted_mcp_session_blob,
        status,
        connected_at,
        expires_at,
        last_initial_context_json,
        last_capabilities_json,
        last_error
      FROM contentful_mcp_sessions
      WHERE session_id = ?
      LIMIT 1
    `,
    args: [sessionId],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export async function updateMcpSession(
  sessionId: string,
  patch: {
    spaceId?: string;
    environmentId?: string;
    organizationId?: string;
    contentfulUserId?: string;
    status?: string;
    connectedAt?: string | null;
    expiresAt?: string | null;
    availableTools?: string[];
    initialContext?: unknown;
    lastError?: string | null;
    blob?: McpStoredBlob;
  },
) {
  const current = await getMcpSession(sessionId);
  if (!current) {
    throw new Error(`Unknown MCP session: ${sessionId}`);
  }

  const nextBlob = patch.blob ?? current.blob;
  const nextAvailableTools = patch.availableTools ?? current.availableTools;
  const nextInitialContext =
    patch.initialContext === undefined
      ? current.initialContext
      : patch.initialContext;
  const updatedAt = new Date().toISOString();
  const client = getClient();

  await client.execute({
    sql: `
      UPDATE contentful_mcp_sessions
      SET
        space_id = ?,
        environment_id = ?,
        organization_id = ?,
        contentful_user_id = ?,
        encrypted_mcp_session_blob = ?,
        status = ?,
        connected_at = ?,
        expires_at = ?,
        last_initial_context_json = ?,
        last_capabilities_json = ?,
        last_error = ?,
        updated_at = ?
      WHERE session_id = ?
    `,
    args: [
      patch.spaceId ?? current.spaceId ?? null,
      patch.environmentId ?? current.environmentId ?? null,
      patch.organizationId ?? current.organizationId ?? null,
      patch.contentfulUserId ?? current.contentfulUserId ?? null,
      encryptJson(nextBlob),
      patch.status ?? current.status,
      patch.connectedAt === undefined
        ? current.connectedAt ?? null
        : patch.connectedAt,
      patch.expiresAt === undefined ? current.expiresAt ?? null : patch.expiresAt,
      nextInitialContext === undefined ? null : JSON.stringify(nextInitialContext),
      JSON.stringify(nextAvailableTools),
      patch.lastError === undefined ? current.lastError ?? null : patch.lastError,
      updatedAt,
      sessionId,
    ],
  });

  return getMcpSession(sessionId);
}

export async function deleteMcpSession(sessionId: string) {
  await ensureSchema();
  const client = getClient();
  await client.execute({
    sql: "DELETE FROM contentful_mcp_sessions WHERE session_id = ?",
    args: [sessionId],
  });
}
