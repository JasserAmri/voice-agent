import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const MAX_MESSAGES = 50;
const store = new Map<string, ChatCompletionMessageParam[]>();

export function getHistory(sessionId: string): ChatCompletionMessageParam[] {
  if (!store.has(sessionId)) {
    store.set(sessionId, []);
  }
  return store.get(sessionId)!;
}

export function appendMessage(sessionId: string, message: ChatCompletionMessageParam): void {
  const history = getHistory(sessionId);
  history.push(message);
  // Trim old messages if exceeding limit (keep system prompt if present)
  if (history.length > MAX_MESSAGES) {
    const firstNonSystem = history.findIndex((m) => m.role !== "system");
    if (firstNonSystem > 0) {
      history.splice(firstNonSystem, history.length - MAX_MESSAGES);
    } else {
      history.splice(0, history.length - MAX_MESSAGES);
    }
  }
}
