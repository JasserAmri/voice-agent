import { Router } from "express";
import { processMessage } from "../agent.js";
import { textToSpeech } from "../tts.js";
import { config } from "../config.js";

export const twilioRouter = Router();

// Twilio sends form-encoded data
import express from "express";
twilioRouter.use(express.urlencoded({ extended: false }));

/**
 * POST /api/twilio/incoming — Twilio hits this when someone calls our number.
 * Greets the caller and starts gathering speech input.
 */
twilioRouter.post("/incoming", (req, res) => {
  const callSid = req.body.CallSid || "unknown";
  const from = req.body.From || "unknown";
  console.log(`[Twilio] Incoming call from ${from} (${callSid})`);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Welcome to QuickText hotel concierge. How can I help you today?</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna">I didn't catch that. Goodbye!</Say>
</Response>`;

  res.type("text/xml").send(twiml);
});

/**
 * POST /api/twilio/gather — Called when caller speaks.
 * Processes speech through LLM, then responds with ElevenLabs audio or Polly fallback.
 */
twilioRouter.post("/gather", async (req, res) => {
  const callSid = req.body.CallSid || "unknown";
  const speechResult = req.body.SpeechResult;

  if (!speechResult) {
    console.log(`[Twilio] No speech detected for call ${callSid}`);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I didn't catch that. Could you repeat?</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna">Goodbye!</Say>
</Response>`;
    res.type("text/xml").send(twiml);
    return;
  }

  console.log(`[Twilio] Speech: "${speechResult}" (call: ${callSid})`);

  try {
    // Use callSid as session ID so conversation persists within a call
    const reply = await processMessage(`twilio-${callSid}`, speechResult);
    console.log(`[Twilio] Reply: "${reply.substring(0, 100)}..."`);

    // Try ElevenLabs TTS — stream audio back via <Play>
    if (config.elevenlabsApiKey) {
      try {
        const audioBuffer = await textToSpeech(reply);
        // Serve the audio at a unique URL for this response
        const audioId = `${callSid}-${Date.now()}`;
        audioCache.set(audioId, audioBuffer);

        // Clean up after 60 seconds
        setTimeout(() => audioCache.delete(audioId), 60_000);

        const baseUrl = getBaseUrl(req);
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${baseUrl}/api/twilio/audio/${audioId}</Play>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna">Is there anything else I can help with?</Say>
</Response>`;
        res.type("text/xml").send(twiml);
        return;
      } catch (ttsErr) {
        console.error("[Twilio] ElevenLabs TTS failed, falling back to Polly:", ttsErr);
      }
    }

    // Fallback: use Twilio's built-in Polly voice
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(reply)}</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna">Is there anything else I can help with?</Say>
</Response>`;
    res.type("text/xml").send(twiml);
  } catch (err) {
    console.error("[Twilio] Processing error:", err);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm sorry, something went wrong. Please try again.</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
</Response>`;
    res.type("text/xml").send(twiml);
  }
});

/**
 * GET /api/twilio/audio/:id — Serves cached ElevenLabs audio to Twilio <Play>.
 */
twilioRouter.get("/audio/:id", (req, res) => {
  const audio = audioCache.get(req.params.id);
  if (!audio) {
    res.status(404).send("Audio not found");
    return;
  }
  res.set({
    "Content-Type": "audio/mpeg",
    "Content-Length": audio.length.toString(),
  });
  res.send(audio);
});

// In-memory audio cache for serving TTS to Twilio
const audioCache = new Map<string, Buffer>();

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getBaseUrl(req: any): string {
  // Use X-Forwarded headers if behind a proxy/ngrok
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}
