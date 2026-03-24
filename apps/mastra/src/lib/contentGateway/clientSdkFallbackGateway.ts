import type { GeneralContentToolName } from "./types";

export const CLIENT_SDK_FALLBACK_TOOL_NAMES = [
  "listContentTypes",
  "getContentType",
  "listEntries",
  "getEntry",
  "getLocales",
] as const satisfies readonly GeneralContentToolName[];

const clientSdkFallbackToolNameSet = new Set<string>(CLIENT_SDK_FALLBACK_TOOL_NAMES);

export function hasClientSdkFallback(toolName: GeneralContentToolName) {
  return clientSdkFallbackToolNameSet.has(toolName);
}
