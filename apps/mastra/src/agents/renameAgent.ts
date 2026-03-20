import { Agent } from "@mastra/core/agent";
import { DISCOVERY_SYSTEM_PROMPT } from "../prompts/discovery";

export const renameAgent = new Agent({
  id: "contentful-product-rename-agent",
  name: "contentful-product-rename-agent",
  instructions: `${DISCOVERY_SYSTEM_PROMPT}

You are operating inside a Contentful app. Keep responses concise, approval-oriented, and explicit about semantic search limits.`,
  model: {
    id: `openai/${process.env.OPENAI_MODEL ?? "gpt-5.4"}`,
    apiKey: process.env.OPENAI_API_KEY,
  },
});
