import { type UIMessage } from "ai";

export function parseAssistantText(message: UIMessage): string {
  return message.parts
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      return "";
    })
    .join("");
}

export function buildChatApiUrl(baseUrl: string): string {
  return new URL("/api/chat/stream", baseUrl).toString();
}
