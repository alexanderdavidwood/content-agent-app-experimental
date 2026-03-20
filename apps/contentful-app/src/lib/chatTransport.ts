import { DefaultChatTransport } from "ai";

import { buildMastraRequestHeaders } from "./contentfulClient";
import type { RenameChatMessage, RenameChatRequestBody } from "./chatTypes";

export function buildChatApiUrl(baseUrl: string): string {
  return new URL("/api/chat/stream", baseUrl).toString();
}

export function createRenameChatTransport(
  baseUrl: string,
  context: RenameChatRequestBody | (() => RenameChatRequestBody),
) {
  const getContext =
    typeof context === "function" ? context : () => context;

  return new DefaultChatTransport<RenameChatMessage>({
    api: buildChatApiUrl(baseUrl),
    prepareSendMessagesRequest: ({
      id,
      messages,
      trigger,
      messageId,
      body,
    }) => ({
      headers: buildMastraRequestHeaders(baseUrl),
      body: {
        ...body,
        id,
        messages,
        trigger,
        messageId,
        ...getContext(),
      },
    }),
    prepareReconnectToStreamRequest: () => ({
      headers: buildMastraRequestHeaders(baseUrl),
    }),
  });
}
