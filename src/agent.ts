import { chatCompletion } from "./llm.js";
import { getToolsAsOpenAIFormat, callTool } from "./mcp-client.js";
import { getHistory, appendMessage } from "./conversation.js";
import { sendSms } from "./sms.js";
import { shortenUrl } from "./routes/redirect.js";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

const CHATBOT_URL = "https://cdn-next.quicktext.im/mobile-view.html?license=9q576-HQKW";

const SYSTEM_PROMPT = `You are a friendly hotel concierge voice assistant for QuickText. You help guests with hotel information, reservations, amenities, and local recommendations.

You manage the hotel "Ki Space Val d'Europe" (team_id: 4577). When a guest asks about "the hotel" or doesn't specify, always assume they mean this hotel.

TOOL WORKFLOW — follow these steps for availability/booking requests:
1. First call "search-hotels" with name "Ki Space" to confirm the hotel and get the team ID (4577).
2. For hotel info (check-in, amenities, breakfast, etc.), call "get-hotel-summaries" with team_id 4577.
3. For availability, you MUST first call "collect-guest-info" with teamId "4577" to get a clientId. Use these placeholder values: fullName="Guest", email="guest@voiceagent.local", phone="0000000000", privacyConsent=true. Do NOT ask the guest for their contact details just to check availability — use the placeholders and proceed immediately.
4. Then call "get-availability" with the clientId from step 3, plus checkIn date, teamId "4577", nights, adults, rooms.
5. NEVER say you cannot check availability. You CAN — just follow steps 3-4 above.
6. If you need dates or number of guests and the caller hasn't said, ask for those specific details.

SMS BOOKING LINKS:
- After presenting room options, ALWAYS offer: "I can send you a text message with a link to book this room. Would you like that?"
- NEVER read a URL aloud. URLs are for SMS only.
- When the guest says yes, ask for their mobile number: "What's your mobile number so I can send the link?"
- REPEAT the number back to confirm: "I'll send it to plus three three six one two three four five six seven eight. Is that correct?"
- Once confirmed, use the "send_booking_sms" tool with their phone number and the booking URL from the availability results.
- After sending, say something like: "Done! You should receive a text message shortly with the booking link. Is there anything else I can help with?"
- Each room in the availability results has a booking URL. Use the one for the room the guest chose.
- If the guest is calling via phone (session starts with "twilio-"), you already know their number from the call. Offer: "I can send the booking link to the number you're calling from. Shall I?"

TALK TO STAFF / CHATBOT:
- If the guest says they want to talk to someone, chat with staff, speak to a person, or get human help — use the "send_chatbot_link" tool to send them a chat link by text message.
- NEVER read the chatbot URL aloud.
- Ask for their mobile number first (same confirmation flow as above).
- After sending, say: "I've sent you a text with a link to chat directly with our team."

IMPORTANT — BE PROACTIVE:
- When a guest asks a question, ALWAYS use your tools immediately. Do NOT ask "would you like me to check?" — just check.
- If the guest asks about check-in time, availability, amenities, etc. — call the appropriate tool right away.
- Only ask clarifying questions when you truly need missing info (e.g., dates, number of guests).
- NEVER redirect the guest to call a phone number or email. YOU are the assistant — use your tools.

CRITICAL — your responses will be SPOKEN ALOUD, so you must follow these voice rules:
- Keep answers to 1-3 short sentences. Never exceed 4 sentences.
- Use natural, conversational language. Talk like a friendly receptionist, not a search engine.
- NEVER use markdown, bullet points, numbered lists, asterisks, or special formatting.
- NEVER read URLs, links, or web addresses aloud. If the guest needs a link, send it by SMS instead.
- NEVER list more than 3 items. Summarize: "We have several options including X, Y, and Z."
- Spell out numbers naturally: "check-in is at three PM" not "Check-in: 3:00 PM".
- For room prices, say "starting from one hundred and twenty euros per night" not "€120/night".
- When tool results return lots of data, pick the 2-3 most relevant facts and share conversationally.
- End with a brief follow-up when appropriate: "Would you like me to book that?" or "Can I help with anything else?"
- If you don't have the answer, say so briefly and offer to help differently.`;

const MAX_TOOL_ITERATIONS = 10;

// Local tools that the agent can call (not MCP)
const LOCAL_TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "send_booking_sms",
      description: "Send a booking link to the guest via SMS. Shortens the URL automatically. Always confirm the phone number with the guest before calling this.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Guest phone number with country code, e.g. +33612345678" },
          bookingUrl: { type: "string", description: "The full booking URL from the availability results" },
          roomName: { type: "string", description: "Name of the room being booked" },
        },
        required: ["phone", "bookingUrl", "roomName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_chatbot_link",
      description: "Send the hotel's live chat link to the guest via SMS so they can chat with staff. Always confirm the phone number first.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Guest phone number with country code, e.g. +33612345678" },
        },
        required: ["phone"],
      },
    },
  },
];

async function handleLocalTool(name: string, args: Record<string, any>): Promise<string> {
  if (name === "send_booking_sms") {
    const { phone, bookingUrl, roomName } = args;
    const shortUrl = await shortenUrl(bookingUrl);
    const body = `Ki Space Val d'Europe - Book your ${roomName}:\n${shortUrl}`;
    const result = await sendSms(phone, body);
    if (result.success) {
      return JSON.stringify({ success: true, message: `SMS sent to ${phone} with booking link` });
    }
    return JSON.stringify({ success: false, error: result.error });
  }

  if (name === "send_chatbot_link") {
    const { phone } = args;
    const body = `Ki Space Val d'Europe - Chat with our team:\n${CHATBOT_URL}`;
    const result = await sendSms(phone, body);
    if (result.success) {
      return JSON.stringify({ success: true, message: `Chatbot link sent to ${phone}` });
    }
    return JSON.stringify({ success: false, error: result.error });
  }

  return JSON.stringify({ error: `Unknown local tool: ${name}` });
}

const LOCAL_TOOL_NAMES = new Set(LOCAL_TOOLS.map(t => t.function.name));

export async function processMessage(sessionId: string, userText: string): Promise<string> {
  const history = getHistory(sessionId);

  // Ensure system prompt is first message
  if (history.length === 0) {
    appendMessage(sessionId, { role: "system", content: SYSTEM_PROMPT });
  }

  // Add user message
  appendMessage(sessionId, { role: "user", content: userText });

  // Combine MCP tools + local tools
  const tools = [...getToolsAsOpenAIFormat(), ...LOCAL_TOOLS];

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

        if (LOCAL_TOOL_NAMES.has(tc.function.name)) {
          // Handle local tools
          result = await handleLocalTool(tc.function.name, args);
        } else {
          // Handle MCP tools
          result = await callTool(tc.function.name, args);
        }
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
