import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const MAX_MESSAGES = 30;
const MAX_TOOL_RESULT_CHARS = 8000; // Truncate large tool results to save tokens

const store = new Map<string, ChatCompletionMessageParam[]>();

export function getHistory(sessionId: string): ChatCompletionMessageParam[] {
  if (!store.has(sessionId)) {
    store.set(sessionId, []);
  }
  return store.get(sessionId)!;
}

export function appendMessage(sessionId: string, message: ChatCompletionMessageParam): void {
  const history = getHistory(sessionId);

  // Truncate large tool results to save token budget
  if (message.role === "tool" && typeof message.content === "string" && message.content.length > MAX_TOOL_RESULT_CHARS) {
    message = {
      ...message,
      content: message.content.substring(0, MAX_TOOL_RESULT_CHARS) + "\n...[truncated — data continues]",
    };
  }

  history.push(message);

  // Trim old messages if exceeding limit (keep system prompt)
  if (history.length > MAX_MESSAGES) {
    const firstNonSystem = history.findIndex((m) => m.role !== "system");
    if (firstNonSystem > 0) {
      history.splice(firstNonSystem, history.length - MAX_MESSAGES);
    } else {
      history.splice(0, history.length - MAX_MESSAGES);
    }
  }
}
