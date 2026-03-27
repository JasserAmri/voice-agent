import { Router } from "express";
import { textToSpeech } from "../tts.js";

export const ttsRouter = Router();

ttsRouter.post("/tts", async (req, res) => {
  const { text, voiceId } = req.body;

  if (!text || typeof text !== "string") {
    res.status(400).json({ error: "Missing 'text' field" });
    return;
  }

  try {
    const audioBuffer = await textToSpeech(text, voiceId);
    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": audioBuffer.length.toString(),
    });
    res.send(audioBuffer);
  } catch (err) {
    console.error("[TTS] Error:", err);
    res.status(500).json({ error: "TTS generation failed" });
  }
});
