import { Router } from "express";
import { processMessage } from "../agent.js";
import { metrics } from "../metrics.js";

export const apiRouter = Router();

apiRouter.post("/chat", async (req, res) => {
  const sessionId = (req.headers["x-session-id"] as string) || "default";
  const { text } = req.body;

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Missing 'text' field" });
    return;
  }

  metrics.trackSession("browser", sessionId);
  console.log(`[API] Session ${sessionId}: "${text}"`);

  try {
    const reply = await processMessage(sessionId, text);
    console.log(`[API] Reply: "${reply.substring(0, 100)}..."`);
    res.json({ reply });
  } catch (err) {
    console.error("[API] Error:", err);
    res.status(500).json({ error: "Failed to process message" });
  }
});
