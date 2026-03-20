import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  AIChatArtifactMessage,
  AIChatConversation,
  AIChatHistory,
  AIChatInput,
  AIChatMessage,
  AIChatMessageList,
  AIChatReasoning,
  AIChatSidePanel,
} from "@contentful/f36-ai-components";
import type {
  AgentSurfaceContext,
  ApplyApprovedChangesToolInput,
  ApplyApprovedChangesToolOutput,
  DiscoverCandidatesToolInput,
  DiscoverCandidatesToolOutput,
  ReviewProposalsToolInput,
  SemanticSearchResult,
} from "@contentful-rename/shared";

import {
  applyOperations,
  buildApplyOperations,
  fallbackKeywordSearch,
  fetchEntrySnapshots,
  getInstallationParameters,
  hasAppActionApi,
  invokeAppAction,
} from "../../lib/contentfulClient";
import {
  approveSafeChanges,
  buildReviewDraft,
  buildReviewOutput,
  buildWelcomeMessage,
  countApproved,
  getLatestSuspendedToolCall,
  getLatestToolPart,
  getMessageText,
  getToolError,
  parseApplyApprovedChangesOutput,
  parseDiscoverCandidatesOutput,
  type ReviewDraftMap,
} from "../../lib/chatRuntime";
import { createRenameChatTransport } from "../../lib/chatTransport";
import {
  type RenameChatRequestBody,
  renameChatDataPartSchemas,
  toolCallSuspendedDataSchema,
  type RenameChatMessage,
} from "../../lib/chatTypes";
import { buildSearchQueries } from "../../lib/searchQueries";

type ChatWorkspaceProps = {
  sdk: any;
  surfaceContext: AgentSurfaceContext;
};

type ReviewHandlers = {
  approveAllSafe: () => void;
  applyApproved: () => Promise<void>;
  cancelReview: () => Promise<void>;
  updateChange: (
    changeId: string,
    next: Partial<ReviewDraftMap[string]>,
  ) => void;
};

type ClientActionError = {
  toolCallId: string;
  toolName: string;
  message: string;
};

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

function candidateContainsVariant(candidate: any, variants: string[]) {
  return candidate.fields.some((field: any) => {
    const values: string[] = [];
    if (typeof field.rawValue === "string") {
      values.push(field.rawValue);
    }
    for (const segment of field.segments) {
      values.push(segment.text);
    }

    return values.some((value) =>
      variants.some((variant) => new RegExp(escapeRegex(variant), "i").test(value)),
    );
  });
}

function buildChatSessionKey(surfaceContext: AgentSurfaceContext) {
  const scope =
    surfaceContext.surface === "page"
      ? `${surfaceContext.surface}:${surfaceContext.entryId ?? "global"}`
      : `${surfaceContext.surface}:${surfaceContext.contentTypeId ?? "global"}`;
  return `contentful-rename-chat:${scope}`;
}

function loadChatMemory(storageKey: string) {
  if (typeof window === "undefined") {
    return {
      thread: `thread-${storageKey}`,
      resource: `resource-${storageKey}`,
    };
  }

  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return {
      thread: existing,
      resource: existing,
    };
  }

  const next =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `chat-${Date.now()}`;
  window.localStorage.setItem(storageKey, next);
  return {
    thread: next,
    resource: next,
  };
}

function clientActionLabel(toolName: string | null) {
  switch (toolName) {
    case "discoverCandidatesClient":
      return "Searching Contentful";
    case "applyApprovedChangesClient":
      return "Applying approved changes";
    default:
      return "Waiting";
  }
}

function suspendedToolFromMessage(message: RenameChatMessage | undefined) {
  if (!message || message.role !== "assistant") {
    return null;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    if (part.type === "data-toolCallSuspended") {
      return toolCallSuspendedDataSchema.parse((part as any).data);
    }
  }

  return null;
}

function ProposalCard({
  change,
  draft,
  onChange,
}: {
  change: ReviewProposalsToolInput["proposedChanges"][number];
  draft: ReviewDraftMap[string];
  onChange: ReviewHandlers["updateChange"];
}) {
  return (
    <article
      style={{
        border: "1px solid #e4e4e7",
        borderRadius: 18,
        padding: 16,
        display: "grid",
        gap: 12,
        background: "#ffffff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <strong>
          {change.entryId} / {change.fieldId}
        </strong>
        <span>{Math.round(change.confidence * 100)}% confidence</span>
      </div>
      <p style={{ margin: 0 }}>{change.reason}</p>
      {change.riskFlags.length > 0 ? (
        <p style={{ margin: 0, color: "#a16207" }}>
          Risk flags: {change.riskFlags.join(", ")}
        </p>
      ) : null}
      <label style={{ display: "grid", gap: 6 }}>
        <span>Original</span>
        <textarea
          readOnly
          value={change.originalText}
          style={{
            minHeight: 88,
            borderRadius: 12,
            border: "1px solid #d4d4d8",
            padding: 12,
            font: "inherit",
            background: "#fafafa",
          }}
        />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span>Replacement</span>
        <textarea
          readOnly={!draft.isEditing}
          value={draft.editedText}
          onChange={(event) =>
            onChange(change.changeId, { editedText: event.target.value })
          }
          style={{
            minHeight: 88,
            borderRadius: 12,
            border: "1px solid #d4d4d8",
            padding: 12,
            font: "inherit",
            background: draft.isEditing ? "#ffffff" : "#fafafa",
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => onChange(change.changeId, { approved: true })}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onChange(change.changeId, { approved: false })}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={() =>
            onChange(change.changeId, { isEditing: !draft.isEditing })
          }
        >
          {draft.isEditing ? "Done editing" : "Edit"}
        </button>
      </div>
    </article>
  );
}

function ReviewToolCard({
  toolInput,
  draft,
  handlers,
}: {
  toolInput: ReviewProposalsToolInput;
  draft: ReviewDraftMap;
  handlers: ReviewHandlers;
}) {
  const approvedCount = countApproved(draft);

  return (
    <AIChatArtifactMessage title="Review proposed changes">
      <div style={{ display: "grid", gap: 16 }}>
        <p style={{ margin: 0 }}>
          Review each recommendation, edit the replacement text if needed, then
          apply the approved changes.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={handlers.approveAllSafe}>
            Approve all safe
          </button>
          <button
            type="button"
            disabled={approvedCount === 0}
            onClick={() => void handlers.applyApproved()}
          >
            Apply approved changes ({approvedCount})
          </button>
          <button type="button" onClick={() => void handlers.cancelReview()}>
            Cancel
          </button>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          {toolInput.proposedChanges.map((change) => (
            <ProposalCard
              key={change.changeId}
              change={change}
              draft={
                draft[change.changeId] ?? {
                  approved: false,
                  editedText: change.proposedText,
                  isEditing: false,
                }
              }
              onChange={handlers.updateChange}
            />
          ))}
        </div>
      </div>
    </AIChatArtifactMessage>
  );
}

function ToolStatusCard({
  message,
  activeSuspensionToolCallId,
  clientActionError,
  onRetryClientAction,
}: {
  message: RenameChatMessage;
  activeSuspensionToolCallId: string | null;
  clientActionError: ClientActionError | null;
  onRetryClientAction: () => void;
}) {
  const latestTool = getLatestToolPart(message);
  const suspendedTool = suspendedToolFromMessage(message);
  const toolError = getToolError(message);

  if (clientActionError && suspendedTool?.toolCallId === clientActionError.toolCallId) {
    return (
      <AIChatArtifactMessage title="Client step failed">
        <p style={{ margin: 0 }}>{clientActionError.message}</p>
        <button type="button" style={{ marginTop: 12 }} onClick={onRetryClientAction}>
          Retry step
        </button>
      </AIChatArtifactMessage>
    );
  }

  if (toolError) {
    return (
      <AIChatArtifactMessage title="Step failed">
        <p style={{ margin: 0 }}>{toolError.message}</p>
      </AIChatArtifactMessage>
    );
  }

  if (
    suspendedTool?.toolName === "discoverCandidatesClient" &&
    suspendedTool.toolCallId === activeSuspensionToolCallId
  ) {
    return (
      <AIChatArtifactMessage title="Searching Contentful">
        <p style={{ margin: 0 }}>
          Looking up candidate entries and preparing a review set.
        </p>
      </AIChatArtifactMessage>
    );
  }

  if (
    suspendedTool?.toolName === "applyApprovedChangesClient" &&
    suspendedTool.toolCallId === activeSuspensionToolCallId
  ) {
    return (
      <AIChatArtifactMessage title="Applying approved changes">
        <p style={{ margin: 0 }}>
          Writing approved updates back to Contentful.
        </p>
      </AIChatArtifactMessage>
    );
  }

  if (latestTool?.type === "tool-draftProposals" && latestTool.state === "input-available") {
    return (
      <AIChatArtifactMessage title="Drafting proposals">
        <p style={{ margin: 0 }}>
          Turning candidate snapshots into field-level rename suggestions.
        </p>
      </AIChatArtifactMessage>
    );
  }

  return null;
}

function ConversationMessage({
  message,
  activeReview,
  reviewDraft,
  reviewHandlers,
  showStatusCard,
  activeSuspensionToolCallId,
  clientActionError,
  onRetryClientAction,
}: {
  message: RenameChatMessage;
  activeReview: { toolCallId: string; input: ReviewProposalsToolInput } | null;
  reviewDraft: ReviewDraftMap | null;
  reviewHandlers: ReviewHandlers;
  showStatusCard: boolean;
  activeSuspensionToolCallId: string | null;
  clientActionError: ClientActionError | null;
  onRetryClientAction: () => void;
}) {
  const text = getMessageText(message);
  const suspendedTool = suspendedToolFromMessage(message);
  const shouldRenderReview =
    suspendedTool?.toolName === "reviewProposalsClient" &&
    activeReview &&
    reviewDraft &&
    suspendedTool.toolCallId === activeReview.toolCallId;

  return (
    <AIChatMessage author={message.role === "user" ? "user" : "assistant"}>
      <div style={{ display: "grid", gap: 12 }}>
        {text ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{text}</p> : null}

        {shouldRenderReview ? (
          <ReviewToolCard
            toolInput={activeReview.input}
            draft={reviewDraft}
            handlers={reviewHandlers}
          />
        ) : null}

        {!shouldRenderReview && message.role === "assistant" && showStatusCard ? (
          <ToolStatusCard
            message={message}
            activeSuspensionToolCallId={activeSuspensionToolCallId}
            clientActionError={clientActionError}
            onRetryClientAction={onRetryClientAction}
          />
        ) : null}
      </div>
    </AIChatMessage>
  );
}

export default function ChatWorkspace({
  sdk,
  surfaceContext,
}: ChatWorkspaceProps) {
  const parameters = getInstallationParameters(sdk);
  const defaultLocale = sdk.locales?.default ?? "en-US";
  const storageKey = buildChatSessionKey(surfaceContext);
  const [chatMemory, setChatMemory] = useState(() => loadChatMemory(storageKey));
  const contextRef = useRef<RenameChatRequestBody>({
    requestContext: {
      defaultLocale,
      surfaceContext,
      allowedContentTypes: parameters.allowedContentTypes,
      maxDiscoveryQueries: parameters.maxDiscoveryQueries,
      maxCandidatesPerRun: parameters.maxCandidatesPerRun,
    },
    memory: chatMemory,
  });
  contextRef.current = {
    requestContext: {
      defaultLocale,
      surfaceContext,
      allowedContentTypes: parameters.allowedContentTypes,
      maxDiscoveryQueries: parameters.maxDiscoveryQueries,
      maxCandidatesPerRun: parameters.maxCandidatesPerRun,
    },
    memory: chatMemory,
  };

  const [transport] = useState(() =>
    createRenameChatTransport(parameters.mastraBaseUrl, () => contextRef.current),
  );
  const [input, setInput] = useState("");
  const [reviewToolCallId, setReviewToolCallId] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraftMap | null>(null);
  const [resolvedSuspensionIds, setResolvedSuspensionIds] = useState<string[]>([]);
  const [pendingClientActionTool, setPendingClientActionTool] = useState<string | null>(
    null,
  );
  const [clientActionError, setClientActionError] = useState<ClientActionError | null>(
    null,
  );
  const [clientActionRetryNonce, setClientActionRetryNonce] = useState(0);
  const autoResumingToolCallIdsRef = useRef<Set<string>>(new Set());
  const [isCompactLayout, setIsCompactLayout] = useState(() =>
    typeof window === "undefined" ? false : window.innerWidth < 1120,
  );

  const { messages, sendMessage, status, error, stop, setMessages } =
    useChat<RenameChatMessage>({
      transport,
      dataPartSchemas: renameChatDataPartSchemas as any,
    });

  useEffect(() => {
    setChatMemory(loadChatMemory(storageKey));
  }, [storageKey]);

  async function discoverCandidates(
    toolInput: DiscoverCandidatesToolInput,
  ): Promise<DiscoverCandidatesToolOutput> {
    const renameInput = toolInput.input;
    let indexStatus: DiscoverCandidatesToolOutput["indexStatus"] = null;

    if (renameInput.searchMode !== "keyword" && hasAppActionApi(sdk)) {
      indexStatus = await invokeAppAction(sdk, "semantic.ensureIndex", {
        locale: renameInput.defaultLocale,
        createIfMissing: true,
      });
    }

    const searchQueries = buildSearchQueries({
      discoveryQueries: toolInput.discoveryPlan.queries,
      oldProductName: renameInput.oldProductName,
      maxDiscoveryQueries: parameters.maxDiscoveryQueries,
    });

    const searchResult: SemanticSearchResult = hasAppActionApi(sdk)
      ? await invokeAppAction<
          {
            mode: "semantic" | "keyword" | "hybrid";
            queries: string[];
            limitPerQuery: number;
          },
          SemanticSearchResult
        >(sdk, "semantic.search", {
          mode: renameInput.searchMode,
          queries: searchQueries,
          limitPerQuery: Math.min(toolInput.maxCandidatesPerRun, 10),
        })
      : await fallbackKeywordSearch(
          sdk,
          searchQueries,
          Math.min(toolInput.maxCandidatesPerRun, 10),
        );

    const snapshots = await fetchEntrySnapshots(
      sdk,
      searchResult.entryIds.slice(0, toolInput.maxCandidatesPerRun),
      renameInput.defaultLocale,
      renameInput.contentTypeIds,
    );
    const variants = buildNameVariants(renameInput.oldProductName);
    const lexicalMatches = snapshots.filter((candidate) =>
      candidateContainsVariant(candidate, variants),
    );
    const candidateSnapshots =
      lexicalMatches.length > 0
        ? lexicalMatches
        : snapshots.slice(0, toolInput.maxCandidatesPerRun);

    return {
      runId: toolInput.runId,
      indexStatus,
      searchResult,
      candidateSnapshots,
    };
  }

  async function applyApprovedChanges(
    toolInput: ApplyApprovedChangesToolInput,
  ): Promise<ApplyApprovedChangesToolOutput> {
    const approvals = Object.fromEntries(
      toolInput.approvals.map((approval) => [
        approval.changeId,
        {
          approved: approval.approved,
          editedText: approval.editedText,
        },
      ]),
    );
    const operations = buildApplyOperations(
      toolInput.candidateSnapshots,
      toolInput.proposedChanges,
      approvals,
    );
    const results = await applyOperations(sdk, operations);

    return {
      runId: toolInput.runId,
      results,
    };
  }

  async function resumeSuspendedTool(
    toolName: string,
    toolCallId: string,
    runId: string,
    resumeData: Record<string, unknown>,
  ) {
    setPendingClientActionTool(toolName);
    setClientActionError(null);
    await sendMessage(undefined, {
      body: {
        runId,
        resumeData,
      },
    });
    setResolvedSuspensionIds((current) =>
      current.includes(toolCallId) ? current : [...current, toolCallId],
    );
    setPendingClientActionTool(null);
  }

  const latestSuspension = getLatestSuspendedToolCall(messages);
  const activeSuspension =
    latestSuspension && !resolvedSuspensionIds.includes(latestSuspension.toolCallId)
      ? latestSuspension
      : null;
  const pendingReview =
    activeSuspension?.toolName === "reviewProposalsClient" ? activeSuspension : null;

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([buildWelcomeMessage()]);
    }
  }, [messages.length, setMessages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const onResize = () => {
      setIsCompactLayout(window.innerWidth < 1120);
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!pendingReview) {
      setReviewToolCallId(null);
      setReviewDraft(null);
      return;
    }

    if (pendingReview.toolCallId !== reviewToolCallId) {
      setReviewToolCallId(pendingReview.toolCallId);
      setReviewDraft(buildReviewDraft(pendingReview.input));
    }
  }, [pendingReview, reviewToolCallId]);

  useEffect(() => {
    if (status !== "ready" || !activeSuspension) {
      return;
    }

    if (activeSuspension.toolName === "reviewProposalsClient") {
      return;
    }

    if (autoResumingToolCallIdsRef.current.has(activeSuspension.toolCallId)) {
      return;
    }

    let cancelled = false;
    autoResumingToolCallIdsRef.current.add(activeSuspension.toolCallId);

    const run = async () => {
      try {
        if (activeSuspension.toolName === "discoverCandidatesClient") {
          const toolOutput = parseDiscoverCandidatesOutput(
            await discoverCandidates(activeSuspension.input),
          );
          if (cancelled) {
            return;
          }
          await resumeSuspendedTool(
            activeSuspension.toolName,
            activeSuspension.toolCallId,
            activeSuspension.runId,
            toolOutput as unknown as Record<string, unknown>,
          );
        }

        if (activeSuspension.toolName === "applyApprovedChangesClient") {
          const toolOutput = parseApplyApprovedChangesOutput(
            await applyApprovedChanges(activeSuspension.input),
          );
          if (cancelled) {
            return;
          }
          await resumeSuspendedTool(
            activeSuspension.toolName,
            activeSuspension.toolCallId,
            activeSuspension.runId,
            toolOutput as unknown as Record<string, unknown>,
          );
        }
      } catch (toolError) {
        if (cancelled) {
          return;
        }

        autoResumingToolCallIdsRef.current.delete(activeSuspension.toolCallId);
        setPendingClientActionTool(null);
        setClientActionError({
          toolCallId: activeSuspension.toolCallId,
          toolName: activeSuspension.toolName,
          message:
            toolError instanceof Error ? toolError.message : String(toolError),
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [
    activeSuspension?.toolCallId,
    activeSuspension?.toolName,
    clientActionRetryNonce,
    status,
  ]);

  const reviewHandlers: ReviewHandlers = {
    approveAllSafe: () => {
      if (!pendingReview || !reviewDraft) {
        return;
      }

      setReviewDraft(approveSafeChanges(pendingReview.input, reviewDraft));
    },
    applyApproved: async () => {
      if (!pendingReview || !reviewDraft) {
        return;
      }

      await resumeSuspendedTool(
        pendingReview.toolName,
        pendingReview.toolCallId,
        pendingReview.runId,
        buildReviewOutput(pendingReview.input, reviewDraft, false) as unknown as Record<
          string,
          unknown
        >,
      );
    },
    cancelReview: async () => {
      if (!pendingReview || !reviewDraft) {
        return;
      }

      await resumeSuspendedTool(
        pendingReview.toolName,
        pendingReview.toolCallId,
        pendingReview.runId,
        buildReviewOutput(pendingReview.input, reviewDraft, true) as unknown as Record<
          string,
          unknown
        >,
      );
    },
    updateChange: (changeId, next) => {
      setReviewDraft((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          [changeId]: {
            ...current[changeId],
            ...next,
          },
        };
      });
    },
  };

  const rightRail = (
    <AIChatSidePanel title="Chat details">
      <AIChatHistory>
        <p style={{ margin: 0 }}>Locale: {defaultLocale}</p>
        <p style={{ margin: 0 }}>Surface: {surfaceContext.surface}</p>
        <p style={{ margin: 0 }}>Thread: {chatMemory.thread}</p>
        <p style={{ margin: 0 }}>
          Status:{" "}
          {pendingClientActionTool
            ? clientActionLabel(pendingClientActionTool)
            : status}
        </p>
      </AIChatHistory>
      {pendingReview ? (
        <AIChatArtifactMessage title="Review pending">
          <p style={{ margin: 0 }}>
            {pendingReview.input.proposedChanges.length} changes are waiting for
            approval.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            Approved so far: {reviewDraft ? countApproved(reviewDraft) : 0}
          </p>
        </AIChatArtifactMessage>
      ) : null}
      {clientActionError ? (
        <AIChatArtifactMessage title="Latest issue">
          <p style={{ margin: 0 }}>{clientActionError.message}</p>
        </AIChatArtifactMessage>
      ) : null}
    </AIChatSidePanel>
  );

  return (
    <main
      style={{
        padding: 24,
        display: "grid",
        gap: 20,
        alignItems: "start",
        gridTemplateColumns: isCompactLayout
          ? "minmax(0, 1fr)"
          : "minmax(0, 1fr) minmax(280px, 320px)",
        maxWidth: 1440,
        margin: "0 auto",
      }}
    >
      <AIChatConversation>
        <AIChatMessageList>
          {messages.map((message) => (
            <ConversationMessage
              key={message.id}
              message={message}
              activeReview={pendingReview}
              reviewDraft={reviewDraft}
              reviewHandlers={reviewHandlers}
              showStatusCard={message.id === messages.at(-1)?.id}
              activeSuspensionToolCallId={activeSuspension?.toolCallId ?? null}
              clientActionError={clientActionError}
              onRetryClientAction={() => {
                setClientActionError(null);
                if (activeSuspension) {
                  autoResumingToolCallIdsRef.current.delete(
                    activeSuspension.toolCallId,
                  );
                }
                setClientActionRetryNonce((current) => current + 1);
                setResolvedSuspensionIds((current) =>
                  activeSuspension
                    ? current.filter((id) => id !== activeSuspension.toolCallId)
                    : current,
                );
              }}
            />
          ))}

          {status !== "ready" || pendingClientActionTool ? (
            <AIChatReasoning title="Assistant activity">
              {pendingClientActionTool
                ? `${clientActionLabel(pendingClientActionTool)}.`
                : "Streaming response."}
            </AIChatReasoning>
          ) : null}
        </AIChatMessageList>

        <AIChatInput
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !input.trim() ||
              status === "submitted" ||
              status === "streaming" ||
              Boolean(pendingClientActionTool)
            ) {
              return;
            }

            void sendMessage({ text: input });
            setInput("");
          }}
          placeholder='Rename "Acme Lite" to "Acme Core", but review titles first'
          disabled={
            status === "submitted" ||
            status === "streaming" ||
            Boolean(pendingClientActionTool)
          }
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span>
              {pendingClientActionTool
                ? clientActionLabel(pendingClientActionTool)
                : status}
            </span>
            {status === "submitted" || status === "streaming" ? (
              <button type="button" onClick={() => void stop()}>
                Stop
              </button>
            ) : null}
            {error ? (
              <span style={{ color: "#b91c1c" }}>{error.message}</span>
            ) : null}
          </div>
        </AIChatInput>
      </AIChatConversation>

      {rightRail}
    </main>
  );
}
