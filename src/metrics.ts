/**
 * In-memory usage metrics store.
 * Tracks LLM tokens, TTS characters, MCP tool calls, and Twilio usage.
 */

interface LlmMetrics {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
  model: string;
}

interface TtsMetrics {
  requests: number;
  totalChars: number;
  totalAudioBytes: number;
  totalLatencyMs: number;
  errors: number;
}

interface McpToolMetrics {
  calls: number;
  totalLatencyMs: number;
  errors: number;
}

interface TwilioMetrics {
  totalCalls: number;
  totalTurns: number;
}

interface SessionMetrics {
  browser: number;
  phone: number;
}

class MetricsStore {
  llm: LlmMetrics = {
    requests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    totalLatencyMs: 0,
    model: "",
  };

  tts: TtsMetrics = {
    requests: 0,
    totalChars: 0,
    totalAudioBytes: 0,
    totalLatencyMs: 0,
    errors: 0,
  };

  mcpTools: Map<string, McpToolMetrics> = new Map();

  twilio: TwilioMetrics = {
    totalCalls: 0,
    totalTurns: 0,
  };

  sessions: SessionMetrics = {
    browser: 0,
    phone: 0,
  };

  private browserSessions = new Set<string>();
  private phoneSessions = new Set<string>();
  private startedAt = Date.now();

  trackLlm(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined, latencyMs: number, model: string) {
    this.llm.requests++;
    this.llm.totalLatencyMs += latencyMs;
    this.llm.model = model;
    if (usage) {
      this.llm.promptTokens += usage.prompt_tokens ?? 0;
      this.llm.completionTokens += usage.completion_tokens ?? 0;
      this.llm.totalTokens += usage.total_tokens ?? 0;
    }
  }

  trackTts(chars: number, audioBytes: number, latencyMs: number) {
    this.tts.requests++;
    this.tts.totalChars += chars;
    this.tts.totalAudioBytes += audioBytes;
    this.tts.totalLatencyMs += latencyMs;
  }

  trackTtsError() {
    this.tts.errors++;
  }

  trackMcpTool(name: string, latencyMs: number, error: boolean) {
    let tool = this.mcpTools.get(name);
    if (!tool) {
      tool = { calls: 0, totalLatencyMs: 0, errors: 0 };
      this.mcpTools.set(name, tool);
    }
    tool.calls++;
    tool.totalLatencyMs += latencyMs;
    if (error) tool.errors++;
  }

  trackTwilioCall() {
    this.twilio.totalCalls++;
  }

  trackTwilioTurn() {
    this.twilio.totalTurns++;
  }

  trackSession(type: "browser" | "phone", sessionId: string) {
    if (type === "browser") {
      if (!this.browserSessions.has(sessionId)) {
        this.browserSessions.add(sessionId);
        this.sessions.browser = this.browserSessions.size;
      }
    } else {
      if (!this.phoneSessions.has(sessionId)) {
        this.phoneSessions.add(sessionId);
        this.sessions.phone = this.phoneSessions.size;
      }
    }
  }

  toJSON() {
    const mcpTools: Record<string, McpToolMetrics & { avgLatencyMs: number }> = {};
    for (const [name, t] of this.mcpTools) {
      mcpTools[name] = { ...t, avgLatencyMs: t.calls > 0 ? Math.round(t.totalLatencyMs / t.calls) : 0 };
    }

    const totalMcpCalls = Array.from(this.mcpTools.values()).reduce((s, t) => s + t.calls, 0);
    const totalMcpErrors = Array.from(this.mcpTools.values()).reduce((s, t) => s + t.errors, 0);

    // Estimated costs
    // Gemini Flash Lite via OpenRouter: ~$0.075/1M input, ~$0.30/1M output
    const llmCost = (this.llm.promptTokens * 0.075 + this.llm.completionTokens * 0.30) / 1_000_000;
    // ElevenLabs: free tier, but ~$0.30/1K chars on paid
    const ttsCost = (this.tts.totalChars / 1000) * 0.30;
    // Twilio: ~$0.022/min voice + ~$0.01/min STT, estimate ~30s per turn
    const twilioCost = this.twilio.totalTurns * (0.022 + 0.01) * 0.5;

    return {
      uptime: Math.round((Date.now() - this.startedAt) / 1000),
      llm: {
        ...this.llm,
        avgLatencyMs: this.llm.requests > 0 ? Math.round(this.llm.totalLatencyMs / this.llm.requests) : 0,
        estimatedCost: `$${llmCost.toFixed(4)}`,
      },
      tts: {
        ...this.tts,
        avgLatencyMs: this.tts.requests > 0 ? Math.round(this.tts.totalLatencyMs / this.tts.requests) : 0,
        estimatedCost: `$${ttsCost.toFixed(4)}`,
      },
      mcp: {
        totalCalls: totalMcpCalls,
        totalErrors: totalMcpErrors,
        tools: mcpTools,
      },
      twilio: {
        ...this.twilio,
        estimatedCost: `$${twilioCost.toFixed(4)}`,
      },
      sessions: this.sessions,
      totalEstimatedCost: `$${(llmCost + ttsCost + twilioCost).toFixed(4)}`,
    };
  }
}

export const metrics = new MetricsStore();
