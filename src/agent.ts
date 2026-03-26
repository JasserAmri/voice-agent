import { chatCompletion } from "./llm.js";
import { getToolsAsOpenAIFormat, callTool } from "./mcp-client.js";
import { getHistory, appendMessage } from "./conversation.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const SYSTEM_PROMPT = `You are a helpful hotel concierge assistant for QuickText. You help guests with hotel information, reservations, amenities, and local recommendations.

You have access to tools that can look up hotel data. Use them when the guest asks questions about specific hotels, rooms, availability, or services.

Keep responses concise and friendly — they will be spoken aloud to the guest. Avoid long lists or complex formatting. Prefer short, conversational answers.`;

const MAX_TOOL_ITERATIONS = 5;

export async function processMessage(sessionId: string, userText: string): Promise<string> {
  const history = getHistory(sessionId);

  // Ensure system prompt is first message
  if (history.length === 0) {
    appendMessage(sessionId, { role: "system", content: SYSTEM_PROMPT });
  }

  // Add user message
  appendMessage(sessionId, { role: "user", content: userText });

  const tools = getToolsAsOpenAIFormat();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const choice = await chatCompletion(getHistory(sessionId), tools);
    const msg = choice.message;

    // Add assistant message to history
    const assistantMsg: ChatCompletionMessageParam = {
      role: "assistant",
      content: msg.content ?? null,
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}),
    } as ChatCompletionMessageParam;
    appendMessage(sessionId, assistantMsg);

    // If no tool calls, we have the final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content ?? "(No response)";
    }

    // Execute each tool call and add results
    for (const tc of msg.tool_calls) {
      let result: string;
      try {
        const args = JSON.parse(tc.function.arguments);
        result = await callTool(tc.function.name, args);
      } catch (err) {
        result = `Error calling tool: ${(err as Error).message}`;
        console.error(`[Agent] Tool call error:`, err);
      }

      appendMessage(sessionId, {
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
    // Loop back to get LLM response with tool results
  }

  return "I'm having trouble processing your request. Could you try rephrasing?";
}
