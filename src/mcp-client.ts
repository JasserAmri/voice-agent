import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { config } from "./config.js";

import type { ChatCompletionTool } from "openai/resources/chat/completions";

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

let client: Client;
let tools: McpTool[] = [];

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
  console.log(`[MCP] Discovered ${tools.length} tools:`, tools.map((t) => t.name).join(", "));
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
  console.log(`[MCP] Calling tool: ${name}`, JSON.stringify(args));
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>)
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text!)
    .join("\n");
  console.log(`[MCP] Tool result (${text.length} chars):`, text.substring(0, 200));
  return text;
}

export function getToolCount(): number {
  return tools.length;
}
