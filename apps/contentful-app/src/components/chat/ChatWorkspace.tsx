import { useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport } from "ai";
import {
  AIChatArtifactMessage,
  AIChatConversation,
  AIChatConversationEmptyState,
  AIChatHistory,
  AIChatInput,
  AIChatMessage,
  AIChatMessageList,
  AIChatReasoning,
  AIChatSidePanel,
} from "@contentful/f36-ai-components";
import type {
  AgentSurfaceContext,
  ApplyResult,
  CandidateEntrySnapshot,
  ProposedChange,
  RenameRunInput,
  SemanticEnsureIndexResult,
  SemanticSearchResult,
} from "@contentful-rename/shared";
import {
  describeBackendHttpFailure,
  buildApplyOperations,
  fetchEntrySnapshots,
  fallbackKeywordSearch,
  getInstallationParameters,
  hasAppActionApi,
  invokeAppAction,
  preflightMastraBackend,
  applyOperations,
} from "../../lib/contentfulClient";
import { buildChatApiUrl, parseAssistantText } from "../../lib/chatTransport";
import QuickStartArtifact from "./QuickStartArtifact";
import ReviewPanel from "../review/ReviewPanel";

type ChatWorkspaceProps = {
  sdk: any;
  surfaceContext: AgentSurfaceContext;
  showReviewPanel: boolean;
};

export default function ChatWorkspace({
  sdk,
  surfaceContext,
  showReviewPanel,
}: ChatWorkspaceProps) {
  function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildNameVariants(name: string) {
    const trimmed = name.trim();
    const variants = new Set<string>([
      trimmed,
      `${trimmed}s`,
      `${trimmed}'s`,
      `${trimmed}’s`,
      trimmed.replace(/\s+/g, "-"),
      trimmed.replace(/-/g, " "),
    ]);
    return [...variants].filter(Boolean);
  }

  function candidateContainsVariant(
    candidate: CandidateEntrySnapshot,
    variants: string[],
  ) {
    return candidate.fields.some((field) => {
      const values: string[] = [];
      if (typeof field.rawValue === "string") {
        values.push(field.rawValue);
      }
      for (const segment of field.segments) {
        values.push(segment.text);
      }

      return values.some((value) =>
        variants.some((variant) =>
          new RegExp(escapeRegex(variant), "i").test(value),
        ),
      );
    });
  }

  const parameters = getInstallationParameters(sdk);
  const defaultLocale = sdk.locales?.default ?? "en-US";
  const [input, setInput] = useState("");
  const [runInput, setRunInput] = useState<RenameRunInput | null>(null);
  const [candidateSnapshots, setCandidateSnapshots] = useState<
    CandidateEntrySnapshot[]
  >([]);
  const [proposedChanges, setProposedChanges] = useState<ProposedChange[]>([]);
  const [approvals, setApprovals] = useState<
    Record<string, { approved: boolean; editedText?: string }>
  >({});
  const [applyResults, setApplyResults] = useState<ApplyResult[]>([]);
  const [indexStatus, setIndexStatus] =
    useState<SemanticEnsureIndexResult | null>(null);
  const [searchResult, setSearchResult] = useState<SemanticSearchResult | null>(
    null,
  );
  const [isApplying, setIsApplying] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [lastAttemptInput, setLastAttemptInput] = useState<RenameRunInput | null>(
    null,
  );

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new TextStreamChatTransport({
      api: buildChatApiUrl(parameters.mastraBaseUrl),
    }),
  });

  useEffect(() => {
    if (runInput && messages.length === 0) {
      setMessages([
        {
          id: "system-welcome",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Ready to scan the ${runInput.defaultLocale} locale for "${runInput.oldProductName}" and propose replacements for "${runInput.newProductName}".`,
            },
          ],
        },
      ]);
    }
  }, [messages.length, runInput, setMessages]);

  async function startRenameRun(nextInput: RenameRunInput) {
    setIsStartingRun(true);
    try {
      const normalized: RenameRunInput = {
        ...nextInput,
        searchMode: nextInput.searchMode ?? "semantic",
        contentTypeIds:
          nextInput.contentTypeIds.length > 0
            ? nextInput.contentTypeIds
            : parameters.allowedContentTypes,
        defaultLocale,
        surfaceContext,
      };
      setLastAttemptInput(normalized);

      const preflight = await preflightMastraBackend(parameters.mastraBaseUrl);
      if (!preflight.ok) {
        throw new Error(
          `${preflight.message} (checked: ${preflight.checkedUrl})`,
        );
      }

      setRunInput(normalized);
      setApplyResults([]);
      setProposedChanges([]);
      setCandidateSnapshots([]);
      setApprovals({});
      setIndexStatus(null);
      setSearchResult(null);
      setRunError(null);

      if (normalized.searchMode !== "keyword" && hasAppActionApi(sdk)) {
        const ensureIndex = await invokeAppAction<
          { locale: string; createIfMissing: boolean },
          SemanticEnsureIndexResult
        >(sdk, "semantic.ensureIndex", {
          locale: defaultLocale,
          createIfMissing: true,
        });
        setIndexStatus(ensureIndex);
      }

      const prompt = `Prepare a ${normalized.searchMode} product rename scan for "${normalized.oldProductName}" -> "${normalized.newProductName}" in locale ${defaultLocale}.`;

      const discoveryResponse = await fetch(
        new URL("/api/runs", parameters.mastraBaseUrl),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(normalized),
        },
      );

      if (!discoveryResponse.ok) {
        const detail = await discoveryResponse.text().catch(() => "");
        throw new Error(
          describeBackendHttpFailure(
            discoveryResponse.status,
            discoveryResponse.statusText,
            detail,
          ),
        );
      }

      const runPayload = await discoveryResponse.json();
      setRunId(runPayload.runId);
      const searchQueries = [
        ...(runPayload.discoveryPlan?.queries ?? []),
        ...(runPayload.discoveryPlan?.aliases ?? []),
        normalized.oldProductName,
      ]
        .map((query: string) => query.trim())
        .filter(Boolean)
        .filter(
          (query: string, index: number, list: string[]) =>
            list.findIndex(
              (candidate) => candidate.toLowerCase() === query.toLowerCase(),
            ) === index,
        )
        .slice(0, 10);

      const semanticResponse = hasAppActionApi(sdk)
        ? await invokeAppAction<
            {
              mode: "semantic" | "keyword" | "hybrid";
              queries: string[];
              limitPerQuery: number;
            },
            SemanticSearchResult
          >(sdk, "semantic.search", {
            mode: normalized.searchMode,
            queries: searchQueries,
            limitPerQuery: Math.min(parameters.maxCandidatesPerRun, 10),
          })
        : await fallbackKeywordSearch(
            sdk,
            searchQueries,
            Math.min(parameters.maxCandidatesPerRun, 10),
          );

      setSearchResult(semanticResponse);

      const snapshots = await fetchEntrySnapshots(
        sdk,
        semanticResponse.entryIds.slice(0, parameters.maxCandidatesPerRun),
        normalized.defaultLocale,
        normalized.contentTypeIds,
      );
      const variants = buildNameVariants(normalized.oldProductName);
      const lexicalMatches = snapshots.filter((candidate) =>
        candidateContainsVariant(candidate, variants),
      );
      const selectedSnapshots =
        lexicalMatches.length > 0
          ? lexicalMatches
          : snapshots.slice(0, parameters.maxCandidatesPerRun);

      setCandidateSnapshots(selectedSnapshots);

      const proposalResponse = await fetch(
        new URL(`/api/runs/${runPayload.runId}/proposals`, parameters.mastraBaseUrl),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: normalized,
            candidates: selectedSnapshots,
          }),
        },
      );

      if (!proposalResponse.ok) {
        throw new Error(`Failed to build proposals: ${proposalResponse.statusText}`);
      }

      const proposalPayload = await proposalResponse.json();
      setProposedChanges(proposalPayload.proposedChanges);

      void sendMessage({
        text: prompt,
        metadata: {
          runInput: normalized,
        },
      } as any).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setRunError((current) =>
          current ??
          `Run completed, but assistant chat streaming failed: ${message}`,
        );
      });

      setMessages((current) => [
        ...current,
        {
          id: `summary-${runPayload.runId}`,
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Found ${selectedSnapshots.length} candidate entries and proposed ${proposalPayload.proposedChanges.length} changes. Review them before applying.`,
            },
          ],
        },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunError(message);
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          parts: [
            {
              type: "text",
              text: `Run setup failed: ${message}`,
            },
          ],
        },
      ]);
    } finally {
      setIsStartingRun(false);
    }
  }

  async function applyApprovedChanges() {
    if (!runInput || !runId) {
      return;
    }

    setIsApplying(true);
    try {
      const approvedChanges = proposedChanges
        .map((change) => ({
          changeId: change.changeId,
          approved: approvals[change.changeId]?.approved ?? false,
          editedText: approvals[change.changeId]?.editedText,
        }))
        .filter((change) => change.approved);

      const approvalResponse = await fetch(
        new URL(`/api/runs/${runId}/approve`, parameters.mastraBaseUrl),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            approvals: approvedChanges,
          }),
        },
      );

      if (!approvalResponse.ok) {
        throw new Error(`Failed to resume run: ${approvalResponse.statusText}`);
      }

      const approvalPayload = await approvalResponse.json();
      const operations = buildApplyOperations(
        candidateSnapshots,
        approvalPayload.proposedChanges ?? proposedChanges,
        approvals,
      );

      const results = await applyOperations(sdk, operations);
      setApplyResults(results);

      await fetch(new URL(`/api/runs/${runId}/report`, parameters.mastraBaseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: runInput,
          results,
        }),
      });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <main
      style={{
        padding: 24,
        display: "grid",
        gridTemplateColumns: showReviewPanel ? "minmax(0, 1.8fr) minmax(320px, 1fr)" : "1fr",
        gap: 24,
        alignItems: "start",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <AIChatConversation>
        <AIChatMessageList>
          {messages.length === 0 ? (
            <AIChatConversationEmptyState title="Rename a product across content">
              Use the structured start card below or ask the assistant to help you
              frame the rename request.
            </AIChatConversationEmptyState>
          ) : null}

          {messages.map((message) => (
            <AIChatMessage key={message.id} author={message.role === "user" ? "user" : "assistant"}>
              {parseAssistantText(message)}
            </AIChatMessage>
          ))}

          <AIChatArtifactMessage title="Quick start">
            <QuickStartArtifact defaultLocale={defaultLocale} onStart={startRenameRun} />
          </AIChatArtifactMessage>

          {indexStatus ? (
            <AIChatArtifactMessage title="Semantic index status">
              <p style={{ margin: 0 }}>
                {indexStatus.status} for locale {indexStatus.locale}
              </p>
              {indexStatus.warning ? <p style={{ margin: "8px 0 0" }}>{indexStatus.warning}</p> : null}
            </AIChatArtifactMessage>
          ) : null}

          {searchResult ? (
            <AIChatArtifactMessage title={`${runInput?.searchMode ?? "semantic"} scan summary`}>
              <p style={{ margin: 0 }}>
                Candidate entries: {searchResult.entryIds.length}
              </p>
              {searchResult.warnings.map((warning) => (
                <p key={warning} style={{ margin: "8px 0 0" }}>
                  {warning}
                </p>
              ))}
            </AIChatArtifactMessage>
          ) : null}

          {runError ? (
            <AIChatArtifactMessage title="Run error">
              <p style={{ margin: 0 }}>{runError}</p>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={isStartingRun}
                  onClick={() => {
                    if (lastAttemptInput) {
                      void startRenameRun(lastAttemptInput);
                    }
                  }}
                >
                  {isStartingRun ? "Retrying..." : "Retry run setup"}
                </button>
                <button
                  type="button"
                  disabled={isStartingRun}
                  onClick={async () => {
                    setRunError(null);
                    const preflight = await preflightMastraBackend(
                      parameters.mastraBaseUrl,
                    );
                    if (!preflight.ok) {
                      setRunError(
                        `${preflight.message} (checked: ${preflight.checkedUrl})`,
                      );
                      return;
                    }

                    setMessages((current) => [
                      ...current,
                      {
                        id: `preflight-ok-${Date.now()}`,
                        role: "assistant",
                        parts: [
                          {
                            type: "text",
                            text: `Backend reachable at ${preflight.checkedUrl}.`,
                          },
                        ],
                      },
                    ]);
                  }}
                >
                  Recheck backend
                </button>
              </div>
            </AIChatArtifactMessage>
          ) : null}

          {status !== "ready" ? (
            <AIChatReasoning title="Assistant activity">
              The chat backend is {status}.
            </AIChatReasoning>
          ) : null}
        </AIChatMessageList>

        <AIChatInput
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onSubmit={(event) => {
            event.preventDefault();
            if (!input.trim()) {
              return;
            }

            void sendMessage({ text: input } as any);
            setInput("");
          }}
          placeholder="Ask for help refining the rename request or reviewing risks."
        >
          <span>Run state: {runId ?? "not started"}</span>
        </AIChatInput>
      </AIChatConversation>

      <AIChatSidePanel title="Run history">
        <AIChatHistory>
          <p style={{ margin: 0 }}>
            Surface: {surfaceContext.surface}
            {surfaceContext.entryId ? ` / Entry ${surfaceContext.entryId}` : ""}
          </p>
          <p style={{ margin: 0 }}>
            Proposed changes: {proposedChanges.length}
          </p>
          <p style={{ margin: 0 }}>
            Approved changes:{" "}
            {
              Object.values(approvals).filter((approval) => approval.approved)
                .length
            }
          </p>
        </AIChatHistory>

        {showReviewPanel ? (
          <ReviewPanel
            changes={proposedChanges}
            approvals={approvals}
            applyResults={applyResults}
            isApplying={isApplying}
            onChangeApproval={(changeId, nextApproval) =>
              setApprovals((current) => ({
                ...current,
                [changeId]: nextApproval,
              }))
            }
            onApply={applyApprovedChanges}
          />
        ) : (
          <p style={{ margin: 0 }}>
            For bulk review, open the Page location for this app and continue the
            run there.
          </p>
        )}
      </AIChatSidePanel>
    </main>
  );
}
