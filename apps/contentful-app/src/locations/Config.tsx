import { useEffect, useState } from "react";
import { useSDK } from "@contentful/react-apps-toolkit";

import type { AppInstallationParameters } from "@contentful-rename/shared";
import { appInstallationParametersSchema } from "@contentful-rename/shared";

const DEFAULT_PARAMETERS: AppInstallationParameters = {
  mastraBaseUrl: "https://your-mastra-project.example.com",
  allowedContentTypes: [],
  maxDiscoveryQueries: 5,
  maxCandidatesPerRun: 30,
  defaultDryRun: true,
  toolAvailability: {
    semanticSearch: true,
  },
};

function resolveInitialParameters(rawInstallationParameters: unknown): AppInstallationParameters {
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

  // Keep config UI usable even if previously saved installation params are invalid.
  return DEFAULT_PARAMETERS;
}

export default function Config() {
  const sdk = useSDK<any>();
  const [parameters, setParameters] = useState<AppInstallationParameters>(() =>
    resolveInitialParameters(sdk.parameters.installation),
  );

  useEffect(() => {
    return sdk.app.onConfigure(async () => ({
      parameters,
      targetState: await sdk.app.getCurrentState(),
    }));
  }, [parameters, sdk]);

  useEffect(() => {
    sdk.app.setReady();
  }, [sdk]);

  return (
    <main style={{ padding: 24, maxWidth: 720, fontFamily: "system-ui, sans-serif" }}>
      <h1>Product Rename Agent configuration</h1>
      <p>
        Set the Mastra backend URL and constrain which content types the rename
        workflow is allowed to scan. You can also disable semantic search if
        the app should stay in keyword-only mode.
      </p>

      <form style={{ display: "grid", gap: 16 }}>
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
          <legend>Tool availability</legend>
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
          <p style={{ margin: 0, color: "#57534e" }}>
            When disabled, the agent is limited to keyword search even if a
            request asks for semantic or hybrid search.
          </p>
        </fieldset>
      </form>
    </main>
  );
}
