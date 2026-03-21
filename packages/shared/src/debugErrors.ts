import { ZodError } from "zod";

import { chatDebugErrorSchema, type ChatDebugError, type RenameRunPhase } from "./schemas";

type ChatDebugErrorOverrides = {
  code?: string;
  details?: Record<string, unknown> | string[];
  message?: string;
  phase?: RenameRunPhase;
  retryable?: boolean;
  toolName?: string;
};

function stringifyDetailValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeDetails(
  details: Record<string, unknown> | string[] | undefined,
): string[] {
  if (!details) {
    return [];
  }

  if (Array.isArray(details)) {
    return details.filter(Boolean);
  }

  return Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${stringifyDetailValue(value)}`);
}

export function createChatDebugError(
  error: unknown,
  overrides: ChatDebugErrorOverrides = {},
): ChatDebugError {
  const parsedExisting = parseChatDebugError(error);
  if (parsedExisting) {
    return chatDebugErrorSchema.parse({
      ...parsedExisting,
      ...overrides,
      details: [
        ...parsedExisting.details,
        ...normalizeDetails(overrides.details),
      ],
    });
  }

  const name = error instanceof Error ? error.name : undefined;
  const message =
    overrides.message ??
    (error instanceof Error ? error.message : undefined) ??
    "Unknown error";
  const stack = error instanceof Error ? error.stack : undefined;
  const details = normalizeDetails(overrides.details);

  if (error instanceof ZodError) {
    details.push(...error.issues.map((issue) => issue.message));
  }

  if (
    error &&
    typeof error === "object" &&
    "cause" in error &&
    (error as { cause?: unknown }).cause !== undefined
  ) {
    details.push(`cause: ${stringifyDetailValue((error as { cause?: unknown }).cause)}`);
  }

  return chatDebugErrorSchema.parse({
    message,
    name,
    code: overrides.code,
    phase: overrides.phase,
    retryable: overrides.retryable ?? false,
    toolName: overrides.toolName,
    details,
    stack,
  });
}

export function parseChatDebugError(value: unknown): ChatDebugError | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      const result = chatDebugErrorSchema.safeParse(parsed);
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  if (value instanceof Error) {
    return parseChatDebugError(value.message);
  }

  const result = chatDebugErrorSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function serializeChatDebugError(error: ChatDebugError) {
  return JSON.stringify(chatDebugErrorSchema.parse(error), null, 2);
}
