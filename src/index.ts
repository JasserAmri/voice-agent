import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { connectMcp, getToolCount } from "./mcp-client.js";
import { apiRouter } from "./routes/api.js";
import { ttsRouter } from "./routes/tts.js";
import { twilioRouter } from "./routes/twilio.js";
import { metricsRouter } from "./routes/metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api", apiRouter);
app.use("/api", ttsRouter);
app.use("/api", metricsRouter);
app.use("/api/twilio", twilioRouter);

async function start() {
  // Connect to MCP server
  try {
    await connectMcp();
    console.log(`[Server] MCP connected, ${getToolCount()} tools available`);
  } catch (err) {
    console.error("[Server] MCP connection failed:", (err as Error).message);
    console.error("[Server] Starting without MCP — tool calls will fail");
  }

  // Log enabled integrations
  if (config.cartesiaApiKey) {
    console.log("[Server] Cartesia TTS enabled (Sonic-2)");
  } else if (config.elevenlabsApiKey) {
    console.log("[Server] ElevenLabs TTS enabled (legacy)");
  }
  if (config.twilioAccountSid) {
    console.log(`[Server] Twilio enabled — number: ${config.twilioPhoneNumber}`);
    console.log(`[Server] Twilio webhook: POST http://localhost:${config.port}/api/twilio/incoming`);
    console.log(`[Server] Use ngrok to expose: ngrok http ${config.port}`);
  }

  app.listen(config.port, () => {
    console.log(`[Server] Running at http://localhost:${config.port}`);
  });
}

start();
