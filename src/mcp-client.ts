import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { config } from "./config.js";
import { metrics } from "./metrics.js";

import type { ChatCompletionTool } from "openai/resources/chat/completions";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

let client: Client;
let tools: McpTool[] = [];
let connected = false;

export async function connectMcp(): Promise<void> {
  const url = new URL(config.mcpServerUrl);
  const headers = {
    Authorization: `Bearer ${config.mcpBearerToken}`,
  };

  client = new Client({ name: "voice-agent", version: "1.0.0" });

  // Try StreamableHTTP first, fall back to SSE
  try {
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers },
    });
    await client.connect(transport);
    console.log("[MCP] Connected via StreamableHTTP");
  } catch (err) {
    console.log("[MCP] StreamableHTTP failed, trying SSE...", (err as Error).message);
    client = new Client({ name: "voice-agent", version: "1.0.0" });
    const transport = new SSEClientTransport(url, {
      requestInit: { headers },
    });
    await client.connect(transport);
    console.log("[MCP] Connected via SSE");
  }

  // Discover and cache tools
  const result = await client.listTools();
  tools = result.tools as McpTool[];
  connected = true;
  console.log(`[MCP] Discovered ${tools.length} tools:`, tools.map((t) => t.name).join(", "));
}

async function ensureConnected(): Promise<void> {
  if (!connected || tools.length === 0) {
    console.log("[MCP] Reconnecting...");
    await connectMcp();
  }
}

export function getToolsAsOpenAIFormat(): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
    },
  }));
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  await ensureConnected();
  console.log(`[MCP] Calling tool: ${name}`, JSON.stringify(args));
  const start = Date.now();
  let error = false;

  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text!)
      .join("\n");
    console.log(`[MCP] Tool result (${text.length} chars):`, text.substring(0, 200));

    // Post-process large availability results to extract key fields
    if (name === "get-availability" && text.length > 5000) {
      return summarizeAvailability(text);
    }

    return text;
  } catch (err) {
    error = true;
    throw err;
  } finally {
    metrics.trackMcpTool(name, Date.now() - start, error);
  }
}

export function getToolCount(): number {
  return tools.length;
}

/**
 * Summarize large availability responses to essential fields only.
 * Preserves room names, prices, bookUrl, and key details while
 * dropping images, descriptions, and other verbose data.
 */
function summarizeAvailability(text: string): string {
  try {
    const data = JSON.parse(text);
    if (!data.availability || !Array.isArray(data.availability)) return text;

    const rooms = data.availability.map((room: any) => ({
      name: room.name,
      price: room.price,
      currency: room.currency || "EUR",
      bookUrl: room.bookUrl,
      totalRoomsAvailable: room.totalRoomsAvailable,
      maxOccupancy: room.maxOccupancy,
      bedType: room.bedType,
      boardType: room.boardType,
      cancellationPolicy: room.cancellationPolicy,
    }));

    const summary = {
      _status: data._status,
      roomCount: rooms.length,
      rooms,
    };

    const result = JSON.stringify(summary, null, 2);
    console.log(`[MCP] Availability summarized: ${text.length} → ${result.length} chars, ${rooms.length} rooms`);
    return result;
  } catch {
    return text;
  }
}
