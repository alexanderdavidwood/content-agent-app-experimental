import { DefaultChatTransport } from "ai";

import {
  buildMastraRequestHeaders,
  describeMastraConnectionFailure,
  preflightMastraBackend,
} from "./contentfulClient";
import type { RenameChatMessage, RenameChatRequestBody } from "./chatTypes";

type BaseUrlResolver = string | (() => string);

export function buildChatApiUrl(baseUrl: string): string {
  return new URL("/chat/stream", baseUrl).toString();
}

function resolveBaseUrl(baseUrl: BaseUrlResolver) {
  return typeof baseUrl === "function" ? baseUrl() : baseUrl;
}

async function fetchWithPreflight(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  baseUrl: BaseUrlResolver,
) {
  try {
    return await fetch(input, {
      ...init,
      credentials: "include",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    const preflight = await preflightMastraBackend(resolveBaseUrl(baseUrl));
    if (!preflight.ok) {
      throw new Error(preflight.message);
    }

    throw new Error(
      describeMastraConnectionFailure(resolveBaseUrl(baseUrl), error),
    );
  }
}

export function createRenameChatTransport(
  baseUrl: BaseUrlResolver,
  context: RenameChatRequestBody | (() => RenameChatRequestBody),
) {
  const getBaseUrl =
    typeof baseUrl === "function" ? baseUrl : () => baseUrl;
  const getContext =
    typeof context === "function" ? context : () => context;

  return new DefaultChatTransport<RenameChatMessage>({
    api: buildChatApiUrl(getBaseUrl()),
    fetch: (input, init) => fetchWithPreflight(input, init, getBaseUrl),
    prepareSendMessagesRequest: ({
      id,
      messages,
      trigger,
      messageId,
      body,
      headers,
    }) => ({
      api: buildChatApiUrl(getBaseUrl()),
      headers: buildMastraRequestHeaders(
        getBaseUrl(),
        headers as Record<string, string>,
      ),
      credentials: "include",
      body: {
        ...body,
        id,
        messages,
        trigger,
        messageId,
        ...getContext(),
      },
    }),
    prepareReconnectToStreamRequest: ({ headers }) => ({
      api: buildChatApiUrl(getBaseUrl()),
      headers: buildMastraRequestHeaders(
        getBaseUrl(),
        headers as Record<string, string>,
      ),
      credentials: "include",
    }),
  });
}
