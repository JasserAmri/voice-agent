import { chatCompletion } from "./llm.js";
import { getToolsAsOpenAIFormat, callTool } from "./mcp-client.js";
import { getHistory, appendMessage } from "./conversation.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const SYSTEM_PROMPT = `You are a friendly hotel concierge voice assistant for QuickText. You help guests with hotel information, reservations, amenities, and local recommendations.

IMPORTANT — BE PROACTIVE:
- When a guest asks a question, ALWAYS use your tools immediately to find the answer. Do NOT ask "would you like me to check?" — just check.
- If you need a hotel name and only manage one hotel, assume they mean that hotel.
- If the guest asks about check-in time, availability, amenities, etc. — call the appropriate tool right away.
- Only ask clarifying questions when you truly cannot determine what the guest needs (e.g., which dates for a booking).

CRITICAL — your responses will be SPOKEN ALOUD, so you must follow these voice rules:
- Keep answers to 1-3 short sentences. Never exceed 4 sentences.
- Use natural, conversational language. Talk like a friendly receptionist, not a search engine.
- NEVER use markdown, bullet points, numbered lists, asterisks, or special formatting.
- NEVER list more than 3 items. Summarize: "We have several options including X, Y, and Z."
- Spell out numbers naturally: "check-in is at three PM" not "Check-in: 3:00 PM".
- For room prices, say "starting from one hundred and twenty euros per night" not "€120/night".
- When tool results return lots of data, pick the 2-3 most relevant facts and share conversationally.
- End with a brief follow-up when appropriate: "Would you like me to book that?" or "Can I help with anything else?"
- If you don't have the answer, say so briefly and offer to help differently.`;

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
