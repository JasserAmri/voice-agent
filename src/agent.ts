import { chatCompletion } from "./llm.js";
import { getToolsAsOpenAIFormat, callTool } from "./mcp-client.js";
import { getHistory, appendMessage } from "./conversation.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const SYSTEM_PROMPT = `You are a friendly hotel concierge voice assistant for QuickText. You help guests with hotel information, reservations, amenities, and local recommendations.

You manage the hotel "Ki Space Val d'Europe" (team_id: 4577). When a guest asks about "the hotel" or doesn't specify, always assume they mean this hotel.

TOOL WORKFLOW — follow these steps for availability/booking requests:
1. First call "search-hotels" with name "Ki Space" to confirm the hotel and get the team ID (4577).
2. For hotel info (check-in, amenities, breakfast, etc.), call "get-hotel-summaries" with team_id 4577.
3. For availability, you MUST first call "collect-guest-info" with teamId "4577" to get a clientId. Use these placeholder values: fullName="Guest", email="guest@voiceagent.local", phone="0000000000", privacyConsent=true. Do NOT ask the guest for their contact details just to check availability — use the placeholders and proceed immediately.
4. Then call "get-availability" with the clientId from step 3, plus checkIn date, teamId "4577", nights, adults, rooms.
5. NEVER say you cannot check availability. You CAN — just follow steps 3-4 above.
6. If you need dates or number of guests and the caller hasn't said, ask for those specific details.

IMPORTANT — BE PROACTIVE:
- When a guest asks a question, ALWAYS use your tools immediately. Do NOT ask "would you like me to check?" — just check.
- If the guest asks about check-in time, availability, amenities, etc. — call the appropriate tool right away.
- Only ask clarifying questions when you truly need missing info (e.g., dates, number of guests).
- NEVER redirect the guest to call a phone number or email. YOU are the assistant — use your tools.

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

const MAX_TOOL_ITERATIONS = 8;

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
