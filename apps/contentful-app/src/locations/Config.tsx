import { useEffect, useState } from "react";
import { useSDK } from "@contentful/react-apps-toolkit";

import type {
  AppInstallationParameters,
  McpEnvironmentSetupStatus,
  McpSessionStatus,
} from "@contentful-rename/shared";
import { appInstallationParametersSchema } from "@contentful-rename/shared";

import {
  disconnectContentfulMcpSession,
  fetchMcpEnvironmentSetupStatus,
  fetchMcpSessionStatus,
  startContentfulMcpAuthorization,
} from "../lib/contentfulClient";

const DEFAULT_PARAMETERS: AppInstallationParameters = {
  mastraBaseUrl: "https://your-mastra-project.example.com",
  allowedContentTypes: [],
  maxDiscoveryQueries: 5,
  maxCandidatesPerRun: 30,
  defaultDryRun: true,
  contentOpsProvider: "hybrid",
  generalContentToolAvailability: {
    listContentTypes: true,
    getContentType: true,
    listEntries: true,
    getEntry: true,
    getLocales: true,
    updateEntry: false,
    publishEntry: false,
  },
  mcpAutoFallbackToClientSdk: true,
  toolAvailability: {
    semanticSearch: true,
    entrySearch: true,
    preApplyValidation: true,
  },
};

function resolveInitialParameters(
  rawInstallationParameters: unknown,
): AppInstallationParameters {
  const candidate = {
    ...DEFAULT_PARAMETERS,
    ...(rawInstallationParameters && typeof rawInstallationParameters === "object"
      ? (rawInstallationParameters as Record<string, unknown>)
      : {}),
  };

  const parsed = appInstallationParametersSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  return DEFAULT_PARAMETERS;
}

function sectionCardStyle() {
  return {
    border: "1px solid #d4d4d8",
    borderRadius: 16,
    padding: 18,
    background: "#ffffff",
    display: "grid",
    gap: 12,
  } as const;
}

export default function Config() {
  const sdk = useSDK<any>();
  const [parameters, setParameters] = useState<AppInstallationParameters>(() =>
    resolveInitialParameters(sdk.parameters.installation),
  );
  const organizationId = sdk.ids?.organization;
  const spaceId = sdk.ids?.space;
  const environmentId = sdk.ids?.environmentAlias ?? sdk.ids?.environment ?? "master";
  const contentfulUserId =
    sdk.user?.sys?.id ?? sdk.user?.id ?? sdk.user?.spaceMembership?.sys?.id;
  const [mcpSessionStatus, setMcpSessionStatus] = useState<McpSessionStatus | null>(
    null,
  );
  const [setupStatus, setSetupStatus] = useState<McpEnvironmentSetupStatus | null>(
    null,
  );
  const [setupError, setSetupError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"connect" | "disconnect" | null>(
    null,
  );
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    return sdk.app.onConfigure(async () => ({
      parameters,
      targetState: await sdk.app.getCurrentState(),
    }));
  }, [parameters, sdk]);

  useEffect(() => {
    sdk.app.setReady();
  }, [sdk]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const [session, setup] = await Promise.all([
          fetchMcpSessionStatus(parameters.mastraBaseUrl, {
            provider: parameters.contentOpsProvider,
            mcpAutoFallbackToClientSdk: parameters.mcpAutoFallbackToClientSdk,
            generalContentToolAvailability: parameters.generalContentToolAvailability,
            spaceId,
            environmentId,
            organizationId,
            contentfulUserId,
          }),
          fetchMcpEnvironmentSetupStatus(parameters.mastraBaseUrl, {
            provider: parameters.contentOpsProvider,
            mcpAutoFallbackToClientSdk: parameters.mcpAutoFallbackToClientSdk,
            generalContentToolAvailability: parameters.generalContentToolAvailability,
            spaceId,
            environmentId,
            organizationId,
            contentfulUserId,
          }),
        ]);

        if (!cancelled) {
          setMcpSessionStatus(session);
          setSetupStatus(setup);
          setSetupError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setSetupError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    contentfulUserId,
    environmentId,
    organizationId,
    parameters.contentOpsProvider,
    parameters.generalContentToolAvailability.getContentType,
    parameters.generalContentToolAvailability.getEntry,
    parameters.generalContentToolAvailability.getLocales,
    parameters.generalContentToolAvailability.listContentTypes,
    parameters.generalContentToolAvailability.listEntries,
    parameters.generalContentToolAvailability.publishEntry,
    parameters.generalContentToolAvailability.updateEntry,
    parameters.mastraBaseUrl,
    parameters.mcpAutoFallbackToClientSdk,
    refreshNonce,
    spaceId,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const onMessage = (event: MessageEvent) => {
      const payload =
        event.data && typeof event.data === "object"
          ? (event.data as { type?: string; status?: string; message?: string })
          : null;
      if (payload?.type !== "contentful-mcp-connected") {
        return;
      }

      setBusyAction(null);
      if (payload.status === "error") {
        setSetupError(payload.message ?? "Contentful MCP connection failed.");
      }
      setRefreshNonce((current) => current + 1);
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function handleConnectMcp() {
    setBusyAction("connect");
    setSetupError(null);

    const popup =
      typeof window !== "undefined"
        ? window.open("", "contentful-mcp-connect", "width=640,height=820")
        : null;

    try {
      const result = await startContentfulMcpAuthorization(
        parameters.mastraBaseUrl,
        {
          provider: parameters.contentOpsProvider,
          spaceId,
          environmentId,
          organizationId,
          contentfulUserId,
        },
      );

      if (popup) {
        popup.location.href = result.redirectUrl;
        popup.focus();
      } else if (typeof window !== "undefined") {
        window.open(result.redirectUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      popup?.close();
      setBusyAction(null);
      setSetupError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleDisconnectMcp() {
    setBusyAction("disconnect");
    setSetupError(null);

    try {
      const session = await disconnectContentfulMcpSession(
        parameters.mastraBaseUrl,
        {
          provider: parameters.contentOpsProvider,
          mcpAutoFallbackToClientSdk: parameters.mcpAutoFallbackToClientSdk,
          generalContentToolAvailability: parameters.generalContentToolAvailability,
          spaceId,
          environmentId,
          organizationId,
          contentfulUserId,
        },
      );
      setMcpSessionStatus(session);
      setRefreshNonce((current) => current + 1);
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 920,
        margin: "0 auto",
        fontFamily:
          '"Space Grotesk", "Avenir Next", "Segoe UI", sans-serif',
        display: "grid",
        gap: 18,
        background:
          "linear-gradient(180deg, rgba(244,244,245,0.95) 0%, rgba(255,255,255,1) 100%)",
      }}
    >
      <header style={{ display: "grid", gap: 10 }}>
        <h1 style={{ margin: 0 }}>Product Rename Agent configuration</h1>
        <p style={{ margin: 0, color: "#3f3f46", lineHeight: 1.5 }}>
          Configure the rename workflow, select how general read-only content
          tools are executed, and verify the current environment is ready for
          the remote Contentful MCP server.
        </p>
      </header>

      <section style={sectionCardStyle()}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Backend</h2>
        <label style={{ display: "grid", gap: 8 }}>
          <span>Mastra base URL</span>
          <input
            value={parameters.mastraBaseUrl}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                mastraBaseUrl: event.target.value,
              }))
            }
          />
        </label>
        <label style={{ display: "grid", gap: 8 }}>
          <span>Allowed content types</span>
          <input
            value={parameters.allowedContentTypes.join(", ")}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                allowedContentTypes: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              }))
            }
          />
        </label>
      </section>

      <section style={sectionCardStyle()}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Content Operations</h2>
        <label style={{ display: "grid", gap: 8 }}>
          <span>Content operations provider</span>
          <select
            value={parameters.contentOpsProvider}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                contentOpsProvider: event.target.value as AppInstallationParameters["contentOpsProvider"],
              }))
            }
          >
            <option value="hybrid">Hybrid</option>
            <option value="remote-mcp">Remote Contentful MCP</option>
            <option value="client-sdk">Client SDK only</option>
          </select>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={parameters.mcpAutoFallbackToClientSdk}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                mcpAutoFallbackToClientSdk: event.target.checked,
              }))
            }
          />
          <span>Automatic SDK fallback when MCP is unavailable</span>
        </label>
        <fieldset style={{ display: "grid", gap: 10 }}>
          <legend>General content tool allow-list</legend>
          {[
            ["listContentTypes", "List content types"],
            ["getContentType", "Get content type"],
            ["listEntries", "List entries"],
            ["getEntry", "Get entry"],
            ["getLocales", "Get locales"],
          ].map(([toolKey, label]) => (
            <label
              key={toolKey}
              style={{ display: "flex", gap: 8, alignItems: "center" }}
            >
              <input
                type="checkbox"
                checked={
                  parameters.generalContentToolAvailability[
                    toolKey as keyof AppInstallationParameters["generalContentToolAvailability"]
                  ] as boolean
                }
                onChange={(event) =>
                  setParameters((current) => ({
                    ...current,
                    generalContentToolAvailability: {
                      ...current.generalContentToolAvailability,
                      [toolKey]: event.target.checked,
                    },
                  }))
                }
              />
              <span>{label}</span>
            </label>
          ))}
          <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.65 }}>
            <input type="checkbox" checked={false} disabled />
            <span>Update entry (phase 2)</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.65 }}>
            <input type="checkbox" checked={false} disabled />
            <span>Publish entry (phase 2)</span>
          </label>
        </fieldset>
      </section>

      <section style={sectionCardStyle()}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Rename Workflow</h2>
        <label style={{ display: "grid", gap: 8 }}>
          <span>Maximum discovery queries</span>
          <input
            type="number"
            min={1}
            max={5}
            value={parameters.maxDiscoveryQueries}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                maxDiscoveryQueries: Number(event.target.value),
              }))
            }
          />
        </label>
        <label style={{ display: "grid", gap: 8 }}>
          <span>Maximum candidates per run</span>
          <input
            type="number"
            min={1}
            max={100}
            value={parameters.maxCandidatesPerRun}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                maxCandidatesPerRun: Number(event.target.value),
              }))
            }
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={parameters.defaultDryRun}
            onChange={(event) =>
              setParameters((current) => ({
                ...current,
                defaultDryRun: event.target.checked,
              }))
            }
          />
          <span>Default to dry-run mode</span>
        </label>
        <fieldset style={{ display: "grid", gap: 12 }}>
          <legend>Rename-specific tool availability</legend>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={parameters.toolAvailability.semanticSearch}
              onChange={(event) =>
                setParameters((current) => ({
                  ...current,
                  toolAvailability: {
                    ...current.toolAvailability,
                    semanticSearch: event.target.checked,
                  },
                }))
              }
            />
            <span>Enable semantic search</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={parameters.toolAvailability.entrySearch}
              onChange={(event) =>
                setParameters((current) => ({
                  ...current,
                  toolAvailability: {
                    ...current.toolAvailability,
                    entrySearch: event.target.checked,
                  },
                }))
              }
            />
            <span>Enable structured entry search</span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={parameters.toolAvailability.preApplyValidation}
              onChange={(event) =>
                setParameters((current) => ({
                  ...current,
                  toolAvailability: {
                    ...current.toolAvailability,
                    preApplyValidation: event.target.checked,
                  },
                }))
              }
            />
            <span>Enable pre-apply validation</span>
          </label>
        </fieldset>
      </section>

      <section style={sectionCardStyle()}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Admin Setup</h2>
        <p style={{ margin: 0, color: "#3f3f46", lineHeight: 1.5 }}>
          For phase 1, enable the upstream Contentful MCP categories for content
          types, entries, and locales as read-only. This app currently manages
          only the installation-level allow-list. Managing upstream MCP
          configuration from inside the app is a backlog item.
        </p>
        <p style={{ margin: 0 }}>
          Space: <strong>{spaceId ?? "unknown"}</strong> · Environment:{" "}
          <strong>{environmentId}</strong>
        </p>
        <p style={{ margin: 0 }}>
          Session status:{" "}
          <strong>{mcpSessionStatus?.state ?? "disconnected"}</strong>
        </p>
        <p style={{ margin: 0 }}>
          Environment setup: <strong>{setupStatus?.state ?? "unknown"}</strong>
        </p>
        {setupStatus?.missingTools.length ? (
          <p style={{ margin: 0, color: "#a16207" }}>
            Missing tools: {setupStatus.missingTools.join(", ")}
          </p>
        ) : null}
        {setupError ? (
          <p style={{ margin: 0, color: "#991b1b" }}>{setupError}</p>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void handleConnectMcp()}
            disabled={
              busyAction !== null || parameters.contentOpsProvider === "client-sdk"
            }
          >
            {busyAction === "connect" ? "Connecting..." : "Connect Contentful MCP"}
          </button>
          <button
            type="button"
            onClick={() => void handleDisconnectMcp()}
            disabled={busyAction !== null || !mcpSessionStatus?.sessionId}
          >
            {busyAction === "disconnect" ? "Disconnecting..." : "Disconnect MCP"}
          </button>
          <button
            type="button"
            onClick={() => setRefreshNonce((current) => current + 1)}
          >
            Refresh status
          </button>
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#3f3f46" }}>
          <li>content types: read-only</li>
          <li>entries: read-only</li>
          <li>locales: read-only</li>
        </ul>
        <p style={{ margin: 0 }}>
          Docs:{" "}
          <a
            href="https://www.contentful.com/developers/docs/tools/mcp-server/"
            target="_blank"
            rel="noreferrer"
          >
            Contentful MCP server
          </a>
        </p>
      </section>
    </main>
  );
}
