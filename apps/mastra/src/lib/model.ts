import { openai } from "@ai-sdk/openai";

export function getOpenAIModel() {
  return openai(process.env.OPENAI_MODEL ?? "gpt-5.4");
}
