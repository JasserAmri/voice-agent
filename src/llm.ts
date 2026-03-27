import OpenAI from "openai";
import { config } from "./config.js";
import { metrics } from "./metrics.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

const openai = new OpenAI({
  apiKey: config.openrouterApiKey,
  baseURL: "https://openrouter.ai/api/v1",
});

export async function chatCompletion(
  messages: ChatCompletionMessageParam[],
  tools?: ChatCompletionTool[]
) {
  const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model: config.openrouterModel,
    messages,
    max_tokens: 1024,
  };

  if (tools && tools.length > 0) {
    params.tools = tools;
  }

  console.log(`[LLM] Calling ${config.openrouterModel} with ${messages.length} messages`);
  const start = Date.now();
  const response = await openai.chat.completions.create(params);
  const latency = Date.now() - start;

  const choice = response.choices[0];
  console.log(`[LLM] Response: finish_reason=${choice.finish_reason}, tool_calls=${choice.message.tool_calls?.length ?? 0}`);

  // Track usage
  metrics.trackLlm(response.usage as any, latency, config.openrouterModel);

  return choice;
}
