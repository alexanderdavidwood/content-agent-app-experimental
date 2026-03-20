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
  buildApplyOperations,
  fetchEntrySnapshots,
  getInstallationParameters,
  invokeAppAction,
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
  const [runId, setRunId] = useState<string | null>(null);

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
    const normalized: RenameRunInput = {
      ...nextInput,
      contentTypeIds:
        nextInput.contentTypeIds.length > 0
          ? nextInput.contentTypeIds
          : parameters.allowedContentTypes,
      defaultLocale,
      surfaceContext,
    };

    setRunInput(normalized);
    setApplyResults([]);
    setProposedChanges([]);
    setCandidateSnapshots([]);
    setApprovals({});

    const ensureIndex = await invokeAppAction<
      { locale: string; createIfMissing: boolean },
      SemanticEnsureIndexResult
    >(sdk, "semantic.ensureIndex", {
      locale: defaultLocale,
      createIfMissing: true,
    });
    setIndexStatus(ensureIndex);

    const prompt = `Prepare a product rename scan for "${normalized.oldProductName}" -> "${normalized.newProductName}" in locale ${defaultLocale}.`;

    await sendMessage({
      text: prompt,
      metadata: {
        runInput: normalized,
      },
    } as any);

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
      throw new Error(`Failed to create run: ${discoveryResponse.statusText}`);
    }

    const runPayload = await discoveryResponse.json();
    setRunId(runPayload.runId);

    const semanticResponse = await invokeAppAction<
      { queries: string[]; limitPerQuery: number },
      SemanticSearchResult
    >(sdk, "semantic.search", {
      queries: runPayload.discoveryPlan.queries,
      limitPerQuery: Math.min(parameters.maxCandidatesPerRun, 10),
    });

    setSearchResult(semanticResponse);

    const snapshots = await fetchEntrySnapshots(
      sdk,
      semanticResponse.entryIds.slice(0, parameters.maxCandidatesPerRun),
      normalized.defaultLocale,
      normalized.contentTypeIds,
    );

    setCandidateSnapshots(snapshots);

    const proposalResponse = await fetch(
      new URL(`/api/runs/${runPayload.runId}/proposals`, parameters.mastraBaseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: normalized,
          candidates: snapshots,
        }),
      },
    );

    if (!proposalResponse.ok) {
      throw new Error(`Failed to build proposals: ${proposalResponse.statusText}`);
    }

    const proposalPayload = await proposalResponse.json();
    setProposedChanges(proposalPayload.proposedChanges);

    setMessages((current) => [
      ...current,
      {
        id: `summary-${runPayload.runId}`,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: `Found ${snapshots.length} candidate entries and proposed ${proposalPayload.proposedChanges.length} changes. Review them before applying.`,
          },
        ],
      },
    ]);
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
            <AIChatArtifactMessage title="Semantic scan summary">
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
