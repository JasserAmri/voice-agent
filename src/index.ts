import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { connectMcp, getToolCount } from "./mcp-client.js";
import { apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", apiRouter);

async function start() {
  // Connect to MCP server
  try {
    await connectMcp();
    console.log(`[Server] MCP connected, ${getToolCount()} tools available`);
  } catch (err) {
    console.error("[Server] MCP connection failed:", (err as Error).message);
    console.error("[Server] Starting without MCP — tool calls will fail");
  }

  app.listen(config.port, () => {
    console.log(`[Server] Running at http://localhost:${config.port}`);
  });
}

start();
