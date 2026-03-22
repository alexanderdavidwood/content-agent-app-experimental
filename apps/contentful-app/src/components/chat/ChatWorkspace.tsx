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
import {
  createChatDebugError,
  parseChatDebugError,
  type AgentSurfaceContext,
  type AgentTraceData,
  type AgentTraceStep,
  type AgentTraceToolCall,
  type AgentTraceToolResult,
  type ApplyApprovedChangesToolInput,
  type ApplyApprovedChangesToolOutput,
  type ChatDebugError,
  type DiscoverCandidatesToolInput,
  type DiscoverCandidatesToolOutput,
  type GetEntryDetailsToolInput,
  type GetEntryDetailsToolOutput,
  type ListContentTypesToolInput,
  type ListContentTypesToolOutput,
  type ReadEntriesToolInput,
  type ReadEntriesToolOutput,
  type ReviewProposalsToolInput,
  type SemanticSearchResult,
  type UpdateEntryAndPublishToolInput,
  type UpdateEntryAndPublishToolOutput,
} from "@contentful-rename/shared";

import {
  applyOperations,
  buildApplyOperations,
  fetchEntrySnapshots,
  getEntryDetailsWithContentType,
  getInstallationParameters,
  listContentTypes,
  performCandidateSearch,
  readEntries,
  updateEntryAndPublish,
} from "../../lib/contentfulClient";
import {
  approveSafeChanges,
  buildReviewDraft,
  buildReviewOutput,
  buildWelcomeMessage,
  countApproved,
  getLatestAgentTrace,
  getLatestSuspendedToolCall,
  getLatestToolPart,
  getMessageText,
  getReasoningText,
  getToolParts,
  getToolError,
  parseApplyApprovedChangesOutput,
  parseDiscoverCandidatesOutput,
  parseGetEntryDetailsOutput,
  parseListContentTypesOutput,
  parseReadEntriesOutput,
  parseUpdateEntryAndPublishOutput,
  type ReviewDraftMap,
  type ToolPartSummary,
} from "../../lib/chatRuntime";
import { createRenameChatTransport } from "../../lib/chatTransport";
import {
  LEGACY_TOOL_CALL_SUSPENDED_PART_TYPE,
  TOOL_CALL_SUSPENDED_PART_TYPE,
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
  error: ChatDebugError;
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
    case "listContentTypesClient":
      return "Loading content types";
    case "getEntryDetailsClient":
      return "Loading entry details";
    case "readEntriesClient":
      return "Reading entries";
    case "updateEntryAndPublishClient":
      return "Publishing entry updates";
    case "discoverCandidatesClient":
      return "Searching Contentful";
    case "applyApprovedChangesClient":
      return "Applying approved changes";
    default:
      return "Waiting";
  }
}

function phaseForToolName(toolName: string | null) {
  switch (toolName) {
    case "listContentTypesClient":
      return "listing-content-types" as const;
    case "getEntryDetailsClient":
      return "loading-entry-details" as const;
    case "readEntriesClient":
      return "reading-entries" as const;
    case "updateEntryAndPublishClient":
      return "publishing-entry-updates" as const;
    case "discoverCandidatesClient":
      return "searching-contentful" as const;
    case "reviewProposalsClient":
      return "reviewing-proposed-changes" as const;
    case "applyApprovedChangesClient":
      return "applying-approved-changes" as const;
    default:
      return "error" as const;
  }
}

function stringifyForDisplay(value: unknown) {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function toolStateLabel(state: string) {
  switch (state) {
    case "input-available":
      return "Input ready";
    case "input-streaming":
      return "Input streaming";
    case "output-available":
      return "Completed";
    case "output-error":
      return "Failed";
    case "output-denied":
      return "Denied";
    default:
      return state;
  }
}

function toolStateColors(state: string) {
  switch (state) {
    case "output-available":
      return {
        background: "#dcfce7",
        color: "#166534",
      };
    case "output-error":
      return {
        background: "#fee2e2",
        color: "#991b1b",
      };
    case "input-available":
    case "input-streaming":
      return {
        background: "#dbeafe",
        color: "#1d4ed8",
      };
    default:
      return {
        background: "#e4e4e7",
        color: "#3f3f46",
      };
  }
}

function StatusBadge({ label, state }: { label: string; state: string }) {
  const colors = toolStateColors(state);

  return (
    <span
      style={{
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 600,
        background: colors.background,
        color: colors.color,
      }}
    >
      {label}
    </span>
  );
}

function buildDebugErrorLog(error: ChatDebugError) {
  const lines = [`message: ${error.message}`];

  if (error.code) {
    lines.push(`code: ${error.code}`);
  }
  if (error.phase) {
    lines.push(`phase: ${error.phase}`);
  }
  if (error.toolName) {
    lines.push(`tool: ${error.toolName}`);
  }
  if (error.details.length > 0) {
    lines.push("details:");
    lines.push(...error.details.map((detail) => `- ${detail}`));
  }
  if (error.stack) {
    lines.push("stack:");
    lines.push(error.stack);
  }

  return lines.join("\n");
}

function buildToolPartLog(toolPart: ToolPartSummary) {
  const lines = [
    `tool: ${toolPart.type.slice(5)}`,
    `toolCallId: ${toolPart.toolCallId}`,
    `state: ${toolPart.state}`,
  ];
  const input = stringifyForDisplay(toolPart.input);
  const output = stringifyForDisplay(toolPart.output);
  const parsedError = normalizeDebugError(toolPart.errorText, {
    toolName: toolPart.type.slice(5),
  });

  if (input) {
    lines.push("input:");
    lines.push(input);
  }
  if (output) {
    lines.push("output:");
    lines.push(output);
  }
  if (parsedError) {
    lines.push("error:");
    lines.push(buildDebugErrorLog(parsedError));
  }

  return lines.join("\n");
}

function buildAgentTraceLog(trace: AgentTraceData) {
  const lines = [];

  if (trace.status) {
    lines.push(`status: ${trace.status}`);
  }
  if (trace.response?.modelId) {
    lines.push(`model: ${trace.response.modelId}`);
  }
  if (trace.finishReason) {
    lines.push(`finishReason: ${trace.finishReason}`);
  }

  trace.steps.forEach((step, index) => {
    lines.push(`step ${index + 1}:`);

    if (step.stepType) {
      lines.push(`  stepType: ${step.stepType}`);
    }
    if (step.reasoningText) {
      lines.push("  reasoning:");
      lines.push(
        ...step.reasoningText.split("\n").map((line) => `    ${line}`),
      );
    }
    if (step.warnings.length > 0) {
      lines.push("  warnings:");
      lines.push(
        ...step.warnings.map((warning) => `    - ${stringifyForDisplay(warning)}`),
      );
    }

    traceStepCalls(step).forEach((call) => {
      lines.push(`  call: ${extractTraceToolName(call)}`);
      lines.push(`    toolCallId: ${extractTraceToolCallId(call)}`);
      const input = stringifyForDisplay(extractTraceToolInput(call));
      if (input) {
        lines.push("    input:");
        lines.push(...input.split("\n").map((line) => `      ${line}`));
      }
    });

    traceStepResults(step).forEach((result) => {
      lines.push(`  result: ${extractTraceToolName(result)}`);
      lines.push(`    toolCallId: ${extractTraceToolCallId(result)}`);
      const errorText = extractTraceToolError(result);
      if (errorText) {
        lines.push("    error:");
        lines.push(...errorText.split("\n").map((line) => `      ${line}`));
      } else {
        const output = stringifyForDisplay(extractTraceToolOutput(result));
        if (output) {
          lines.push("    output:");
          lines.push(...output.split("\n").map((line) => `      ${line}`));
        }
      }
    });
  });

  if (trace.steps.length === 0 && trace.reasoning.length > 0) {
    lines.push("reasoning:");
    lines.push(trace.reasoning.join(""));
  }

  return lines.join("\n");
}

function CopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          if (!navigator?.clipboard?.writeText) {
            throw new Error("Clipboard API unavailable");
          }

          await navigator.clipboard.writeText(text);
          setStatus("copied");
          window.setTimeout(() => setStatus("idle"), 1500);
        } catch {
          setStatus("failed");
          window.setTimeout(() => setStatus("idle"), 1500);
        }
      }}
    >
      {status === "idle"
        ? label
        : status === "copied"
          ? "Copied"
          : "Copy failed"}
    </button>
  );
}

function normalizeDebugError(
  error: unknown,
  fallback?: Partial<ChatDebugError>,
): ChatDebugError | null {
  if (!error) {
    return null;
  }

  const parsed = parseChatDebugError(error);
  if (parsed) {
    return {
      ...parsed,
      ...fallback,
      details: [
        ...parsed.details,
        ...((fallback?.details as string[] | undefined) ?? []),
      ],
    };
  }

  return createChatDebugError(error, fallback);
}

function extractTraceToolName(
  candidate: AgentTraceToolCall | AgentTraceToolResult,
) {
  return (
    candidate.toolName ??
    ((candidate.payload as any)?.toolName as string | undefined) ??
    "unknown-tool"
  );
}

function extractTraceToolCallId(
  candidate: AgentTraceToolCall | AgentTraceToolResult,
) {
  return (
    candidate.toolCallId ??
    ((candidate.payload as any)?.toolCallId as string | undefined) ??
    "unknown-call"
  );
}

function extractTraceToolInput(candidate: AgentTraceToolCall) {
  return candidate.args ?? (candidate.payload as any)?.args;
}

function extractTraceToolOutput(candidate: AgentTraceToolResult) {
  return (
    candidate.result ??
    candidate.output ??
    (candidate.payload as any)?.result ??
    (candidate.payload as any)?.output
  );
}

function extractTraceToolError(candidate: AgentTraceToolResult) {
  const direct =
    candidate.errorText ?? ((candidate.payload as any)?.errorText as string | undefined);

  if (direct) {
    return direct;
  }

  if (candidate.isError) {
    return stringifyForDisplay(extractTraceToolOutput(candidate));
  }

  return null;
}

function traceStepCalls(step: AgentTraceStep) {
  return [...step.staticToolCalls, ...step.dynamicToolCalls];
}

function traceStepResults(step: AgentTraceStep) {
  return [...step.staticToolResults, ...step.dynamicToolResults];
}

function suspendedToolFromMessage(message: RenameChatMessage | undefined) {
  if (!message || message.role !== "assistant") {
    return null;
  }

  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index];
    const partType = String(part.type);
    if (
      partType === TOOL_CALL_SUSPENDED_PART_TYPE ||
      partType === LEGACY_TOOL_CALL_SUSPENDED_PART_TYPE
    ) {
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

function DebugErrorCard({
  title,
  error,
  actionLabel,
  onAction,
}: {
  title: string;
  error: ChatDebugError;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const logText = buildDebugErrorLog(error);

  return (
    <AIChatArtifactMessage title={title}>
      <div style={{ display: "grid", gap: 10 }}>
        <p style={{ margin: 0 }}>{error.message}</p>
        {(error.code || error.phase || error.toolName) && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {error.code ? (
              <StatusBadge label={error.code} state="output-error" />
            ) : null}
            {error.phase ? (
              <StatusBadge label={error.phase} state="output-error" />
            ) : null}
            {error.toolName ? (
              <StatusBadge label={error.toolName} state="output-error" />
            ) : null}
          </div>
        )}
        {error.details.length > 0 ? (
          <details>
            <summary>Debug details</summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {error.details.map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {error.stack ? (
          <details>
            <summary>Stack trace</summary>
            <pre
              style={{
                margin: "8px 0 0",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 12,
              }}
            >
              {error.stack}
            </pre>
          </details>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <CopyButton text={logText} label="Copy error log" />
          {actionLabel && onAction ? (
            <button type="button" onClick={onAction}>
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </AIChatArtifactMessage>
  );
}

function ToolActivityCard({
  toolParts,
}: {
  toolParts: ToolPartSummary[];
}) {
  if (toolParts.length === 0) {
    return null;
  }

  return (
    <AIChatArtifactMessage title="Tool activity">
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <CopyButton
            text={toolParts.map((toolPart) => buildToolPartLog(toolPart)).join("\n\n")}
            label="Copy all tool logs"
          />
        </div>
        {toolParts.map((toolPart) => {
          const input = stringifyForDisplay(toolPart.input);
          const output = stringifyForDisplay(toolPart.output);
          const parsedError = normalizeDebugError(toolPart.errorText, {
            toolName: toolPart.type.slice(5),
          });

          return (
            <details key={`${toolPart.toolCallId}:${toolPart.state}`} open={toolParts.length === 1}>
              <summary style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong>{toolPart.type.slice(5)}</strong>
                <StatusBadge
                  label={toolStateLabel(toolPart.state)}
                  state={toolPart.state}
                />
              </summary>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: "#57534e" }}>
                  Tool call id: {toolPart.toolCallId}
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <CopyButton
                    text={buildToolPartLog(toolPart)}
                    label="Copy tool log"
                  />
                </div>
                {input ? (
                  <details>
                    <summary>Input</summary>
                    <pre
                      style={{
                        margin: "8px 0 0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 12,
                      }}
                    >
                      {input}
                    </pre>
                  </details>
                ) : null}
                {output ? (
                  <details>
                    <summary>Output</summary>
                    <pre
                      style={{
                        margin: "8px 0 0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 12,
                      }}
                    >
                      {output}
                    </pre>
                  </details>
                ) : null}
                {parsedError ? (
                  <DebugErrorCard title="Tool error" error={parsedError} />
                ) : null}
              </div>
            </details>
          );
        })}
      </div>
    </AIChatArtifactMessage>
  );
}

function AgentTracePanel({ trace }: { trace: AgentTraceData | null }) {
  if (!trace) {
    return null;
  }

  return (
    <AIChatArtifactMessage title="Execution trace">
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <CopyButton text={buildAgentTraceLog(trace)} label="Copy trace" />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {trace.status ? (
            <StatusBadge
              label={trace.status === "finished" ? "Run finished" : "Run active"}
              state={trace.status === "finished" ? "output-available" : "input-available"}
            />
          ) : null}
          {trace.response?.modelId ? (
            <StatusBadge label={trace.response.modelId} state="input-available" />
          ) : null}
          {trace.finishReason ? (
            <StatusBadge label={trace.finishReason} state="input-available" />
          ) : null}
        </div>
        {trace.steps.length > 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            {trace.steps.map((step, index) => {
              const calls = traceStepCalls(step);
              const results = traceStepResults(step);
              const title =
                calls.length > 0
                  ? calls.map((call) => extractTraceToolName(call)).join(", ")
                  : step.stepType ?? `Step ${index + 1}`;

              return (
                <details key={`${index}-${title}`} open={index === trace.steps.length - 1}>
                  <summary>
                    Step {index + 1}: {title}
                  </summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {step.reasoningText ? (
                      <AIChatReasoning title="Thinking summary">
                        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                          {step.reasoningText}
                        </p>
                      </AIChatReasoning>
                    ) : null}
                    {step.warnings.length > 0 ? (
                      <details>
                        <summary>Warnings</summary>
                        <pre
                          style={{
                            margin: "8px 0 0",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontSize: 12,
                          }}
                        >
                          {stringifyForDisplay(step.warnings)}
                        </pre>
                      </details>
                    ) : null}
                    {calls.map((call) => (
                      <details key={`call-${extractTraceToolCallId(call)}`}>
                        <summary>Call: {extractTraceToolName(call)}</summary>
                        <pre
                          style={{
                            margin: "8px 0 0",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontSize: 12,
                          }}
                        >
                          {stringifyForDisplay(extractTraceToolInput(call))}
                        </pre>
                      </details>
                    ))}
                    {results.map((result) => {
                      const errorText = extractTraceToolError(result);

                      return (
                        <details key={`result-${extractTraceToolCallId(result)}`}>
                          <summary>
                            Result: {extractTraceToolName(result)}
                            {errorText ? " (failed)" : ""}
                          </summary>
                          {errorText ? (
                            <DebugErrorCard
                              title="Tool result error"
                              error={createChatDebugError(errorText, {
                                toolName: extractTraceToolName(result),
                              })}
                            />
                          ) : (
                            <pre
                              style={{
                                margin: "8px 0 0",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                fontSize: 12,
                              }}
                            >
                              {stringifyForDisplay(extractTraceToolOutput(result))}
                            </pre>
                          )}
                        </details>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        ) : trace.reasoning.length > 0 ? (
          <AIChatReasoning title="Thinking summary">
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {trace.reasoning.join("")}
            </p>
          </AIChatReasoning>
        ) : null}
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
      <DebugErrorCard
        title="Client step failed"
        error={clientActionError.error}
        actionLabel="Retry step"
        onAction={onRetryClientAction}
      />
    );
  }

  if (toolError) {
    return <DebugErrorCard title="Step failed" error={toolError} />;
  }

  if (
    suspendedTool?.toolName === "listContentTypesClient" &&
    suspendedTool.toolCallId === activeSuspensionToolCallId
  ) {
    return (
      <AIChatArtifactMessage title="Loading content types">
        <p style={{ margin: 0 }}>
          Fetching the requested content types from Contentful.
        </p>
      </AIChatArtifactMessage>
    );
  }

  if (
    suspendedTool?.toolName === "getEntryDetailsClient" &&
    suspendedTool.toolCallId === activeSuspensionToolCallId
  ) {
    return (
      <AIChatArtifactMessage title="Loading entry details">
        <p style={{ margin: 0 }}>
          Reading the entry and its content type metadata.
        </p>
      </AIChatArtifactMessage>
    );
  }

  if (
    suspendedTool?.toolName === "readEntriesClient" &&
    suspendedTool.toolCallId === activeSuspensionToolCallId
  ) {
    return (
      <AIChatArtifactMessage title="Reading entries">
        <p style={{ margin: 0 }}>
          Loading localized entry fields from Contentful.
        </p>
      </AIChatArtifactMessage>
    );
  }

  if (
    suspendedTool?.toolName === "updateEntryAndPublishClient" &&
    suspendedTool.toolCallId === activeSuspensionToolCallId
  ) {
    return (
      <AIChatArtifactMessage title="Publishing entry updates">
        <p style={{ margin: 0 }}>
          Updating the entry and publishing the new version.
        </p>
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
  const reasoning = getReasoningText(message);
  const toolParts = getToolParts(message);
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

        {reasoning ? (
          <AIChatReasoning title="Assistant thinking summary">
            <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{reasoning}</p>
          </AIChatReasoning>
        ) : null}

        {toolParts.length > 0 ? <ToolActivityCard toolParts={toolParts} /> : null}

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
      toolAvailability: parameters.toolAvailability,
    },
    memory: chatMemory,
  });
  const baseUrlRef = useRef(parameters.mastraBaseUrl);
  contextRef.current = {
    requestContext: {
      defaultLocale,
      surfaceContext,
      allowedContentTypes: parameters.allowedContentTypes,
      maxDiscoveryQueries: parameters.maxDiscoveryQueries,
      maxCandidatesPerRun: parameters.maxCandidatesPerRun,
      toolAvailability: parameters.toolAvailability,
    },
    memory: chatMemory,
  };
  baseUrlRef.current = parameters.mastraBaseUrl;

  const [transport] = useState(() =>
    createRenameChatTransport(
      () => baseUrlRef.current,
      () => contextRef.current,
    ),
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

  const { messages, sendMessage, status, error, stop, setMessages, clearError } =
    useChat<RenameChatMessage>({
      transport,
      dataPartSchemas: renameChatDataPartSchemas as any,
    });
  const latestAgentTrace = getLatestAgentTrace(messages);
  const transportError = normalizeDebugError(error);

  useEffect(() => {
    setChatMemory(loadChatMemory(storageKey));
  }, [storageKey]);

  async function loadContentTypes(
    toolInput: ListContentTypesToolInput,
  ): Promise<ListContentTypesToolOutput> {
    try {
      return await listContentTypes(sdk, toolInput);
    } catch (error) {
      throw createChatDebugError(error, {
        code: "list_content_types_failed",
        phase: "listing-content-types",
        toolName: "listContentTypesClient",
        details: {
          requestedContentTypeIds: toolInput.contentTypeIds,
          includeFields: toolInput.includeFields,
          limit: toolInput.limit,
        },
      });
    }
  }

  async function loadEntryDetails(
    toolInput: GetEntryDetailsToolInput,
  ): Promise<GetEntryDetailsToolOutput> {
    try {
      return await getEntryDetailsWithContentType(sdk, toolInput);
    } catch (error) {
      throw createChatDebugError(error, {
        code: "get_entry_details_failed",
        phase: "loading-entry-details",
        toolName: "getEntryDetailsClient",
        details: {
          entryId: toolInput.entryId,
          locale: toolInput.locale,
          includeContentTypeFields: toolInput.includeContentTypeFields,
        },
      });
    }
  }

  async function loadEntries(
    toolInput: ReadEntriesToolInput,
  ): Promise<ReadEntriesToolOutput> {
    try {
      return await readEntries(sdk, toolInput);
    } catch (error) {
      throw createChatDebugError(error, {
        code: "read_entries_failed",
        phase: "reading-entries",
        toolName: "readEntriesClient",
        details: {
          entryIds: toolInput.entryIds,
          locales: toolInput.locales,
        },
      });
    }
  }

  async function publishEntryUpdates(
    toolInput: UpdateEntryAndPublishToolInput,
  ): Promise<UpdateEntryAndPublishToolOutput> {
    try {
      return await updateEntryAndPublish(sdk, toolInput);
    } catch (error) {
      throw createChatDebugError(error, {
        code: "update_entry_publish_failed",
        phase: "publishing-entry-updates",
        toolName: "updateEntryAndPublishClient",
        details: {
          entryId: toolInput.entryId,
          expectedVersion: toolInput.expectedVersion,
          expectedContentTypeId: toolInput.expectedContentTypeId,
          updateCount: toolInput.updates.length,
        },
      });
    }
  }

  async function discoverCandidates(
    toolInput: DiscoverCandidatesToolInput,
  ): Promise<DiscoverCandidatesToolOutput> {
    const renameInput = toolInput.input;
    const searchQueries = buildSearchQueries({
      discoveryQueries: toolInput.discoveryPlan.queries,
      oldProductName: renameInput.oldProductName,
      maxDiscoveryQueries: parameters.maxDiscoveryQueries,
    });

    try {
      const { indexStatus, searchResult }: {
        indexStatus: DiscoverCandidatesToolOutput["indexStatus"];
        searchResult: SemanticSearchResult;
      } = await performCandidateSearch(sdk, {
        defaultLocale: renameInput.defaultLocale,
        searchMode: renameInput.searchMode,
        queries: searchQueries,
        limitPerQuery: Math.min(toolInput.maxCandidatesPerRun, 10),
        semanticSearchEnabled: parameters.toolAvailability.semanticSearch,
      });

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
    } catch (error) {
      throw createChatDebugError(error, {
        code: "discover_candidates_failed",
        phase: "searching-contentful",
        toolName: "discoverCandidatesClient",
        details: {
          defaultLocale: renameInput.defaultLocale,
          requestedSearchMode: renameInput.searchMode,
          semanticSearchEnabled: parameters.toolAvailability.semanticSearch,
          searchQueries,
        },
      });
    }
  }

  async function applyApprovedChanges(
    toolInput: ApplyApprovedChangesToolInput,
  ): Promise<ApplyApprovedChangesToolOutput> {
    try {
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
    } catch (error) {
      throw createChatDebugError(error, {
        code: "apply_changes_failed",
        phase: "applying-approved-changes",
        toolName: "applyApprovedChangesClient",
        details: {
          runId: toolInput.runId,
          approvalCount: toolInput.approvals.length,
        },
      });
    }
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
        if (activeSuspension.toolName === "listContentTypesClient") {
          const toolOutput = parseListContentTypesOutput(
            await loadContentTypes(activeSuspension.input),
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

        if (activeSuspension.toolName === "getEntryDetailsClient") {
          const toolOutput = parseGetEntryDetailsOutput(
            await loadEntryDetails(activeSuspension.input),
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

        if (activeSuspension.toolName === "readEntriesClient") {
          const toolOutput = parseReadEntriesOutput(
            await loadEntries(activeSuspension.input),
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

        if (activeSuspension.toolName === "updateEntryAndPublishClient") {
          const toolOutput = parseUpdateEntryAndPublishOutput(
            await publishEntryUpdates(activeSuspension.input),
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
          error: normalizeDebugError(toolError, {
            phase: phaseForToolName(activeSuspension.toolName),
            toolName: activeSuspension.toolName,
            details: [
              `toolCallId: ${activeSuspension.toolCallId}`,
              `runId: ${activeSuspension.runId}`,
            ],
          })!,
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
        <p style={{ margin: 0 }}>
          Semantic search:{" "}
          {parameters.toolAvailability.semanticSearch ? "enabled" : "disabled"}
        </p>
        <p style={{ margin: 0, wordBreak: "break-all" }}>
          Backend: {parameters.mastraBaseUrl}
        </p>
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
      <AgentTracePanel trace={latestAgentTrace} />
      {clientActionError ? (
        <DebugErrorCard title="Latest issue" error={clientActionError.error} />
      ) : null}
      {!clientActionError && transportError ? (
        <DebugErrorCard title="Latest issue" error={transportError} />
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
                clearError();
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

            clearError();
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
            {transportError ? (
              <span style={{ color: "#b91c1c" }}>{transportError.message}</span>
            ) : null}
          </div>
        </AIChatInput>
      </AIChatConversation>

      {rightRail}
    </main>
  );
}
