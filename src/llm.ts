import OpenAI, { AzureOpenAI } from "openai";
import { config } from "./config.js";
import { metrics } from "./metrics.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

// Initialize the right client based on provider
let client: OpenAI;
let modelName: string;

if (config.llmProvider === "azure" && config.azureEndpoint) {
  client = new AzureOpenAI({
    endpoint: config.azureEndpoint,
    apiKey: config.azureApiKey,
    apiVersion: config.azureApiVersion,
  });
  modelName = config.azureDeployment;
  console.log(`[LLM] Using Azure OpenAI: ${config.azureDeployment}`);
} else {
  client = new OpenAI({
    apiKey: config.openrouterApiKey,
    baseURL: "https://openrouter.ai/api/v1",
  });
  modelName = config.openrouterModel;
  console.log(`[LLM] Using OpenRouter: ${config.openrouterModel}`);
}

export async function chatCompletion(
  messages: ChatCompletionMessageParam[],
  tools?: ChatCompletionTool[]
) {
  const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
    model: modelName,
    messages,
    max_tokens: 1024,
  };

  if (tools && tools.length > 0) {
    params.tools = tools;
  }

  console.log(`[LLM] Calling ${modelName} with ${messages.length} messages`);
  const start = Date.now();
  const response = await client.chat.completions.create(params);
  const latency = Date.now() - start;

  const choice = response.choices[0];
  console.log(`[LLM] Response: finish_reason=${choice.finish_reason}, tool_calls=${choice.message.tool_calls?.length ?? 0}`);

  // Track usage
  metrics.trackLlm(response.usage as any, latency, modelName);

  return choice;
}
