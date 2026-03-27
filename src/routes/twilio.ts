import { Router } from "express";
import { processMessage } from "../agent.js";
import { textToSpeech } from "../tts.js";
import { config } from "../config.js";
import { metrics } from "../metrics.js";
import express from "express";

export const twilioRouter = Router();
twilioRouter.use(express.urlencoded({ extended: false }));

// In-memory caches
const audioCache = new Map<string, Buffer>();
const pendingResponses = new Map<string, { reply: string; audioId?: string }>();

// Royalty-free hold music URL
const HOLD_MUSIC_URL = "http://com.twilio.sounds.music.s3.amazonaws.com/ClockworkWaltz.mp3";

/**
 * POST /incoming — Twilio hits this when someone calls.
 */
twilioRouter.post("/incoming", (req, res) => {
  const callSid = req.body.CallSid || "unknown";
  const from = req.body.From || "unknown";
  console.log(`[Twilio] Incoming call from ${from} (${callSid})`);
  metrics.trackTwilioCall();
  metrics.trackSession("phone", callSid);

  const baseUrl = getBaseUrl(req);
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Welcome to QuickText hotel concierge. How can I help you today?</Say>
  <Gather input="speech" action="${baseUrl}/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna-Neural">I did not catch that. Goodbye!</Say>
</Response>`);
});

/**
 * POST /gather — Called when caller speaks.
 * Immediately plays hold music, processes in background, then redirects to response.
 */
twilioRouter.post("/gather", async (req, res) => {
  const callSid = req.body.CallSid || "unknown";
  const speechResult = req.body.SpeechResult;
  const baseUrl = getBaseUrl(req);

  if (!speechResult) {
    console.log(`[Twilio] No speech detected for call ${callSid}`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">I did not catch that. Could you repeat?</Say>
  <Gather input="speech" action="${baseUrl}/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna-Neural">Goodbye!</Say>
</Response>`);
    return;
  }

  console.log(`[Twilio] Speech: "${speechResult}" (call: ${callSid})`);
  metrics.trackTwilioTurn();

  // Start processing in background
  processInBackground(callSid, speechResult);

  // Immediately respond with filler then poll /wait for the response
  console.log(`[Twilio] Base URL: ${baseUrl}`);
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">One moment please, let me check that for you.</Say>
  <Redirect method="POST">${baseUrl}/api/twilio/wait/${callSid}</Redirect>
</Response>`);
});

/**
 * Background processing — runs LLM + TTS and stores result.
 */
async function processInBackground(callSid: string, speechResult: string) {
  try {
    const reply = await processMessage(`twilio-${callSid}`, speechResult);
    console.log(`[Twilio] Reply: "${reply.substring(0, 100)}..."`);

    // Truncate very long responses for voice
    const truncated = truncateForVoice(reply);

    // Generate Cartesia TTS audio (works on real servers, not tunnels)
    let audioId: string | undefined;
    if (config.cartesiaApiKey) {
      try {
        const audioBuffer = await textToSpeech(truncated);
        audioId = `${callSid}-${Date.now()}`;
        audioCache.set(audioId, audioBuffer);
        setTimeout(() => audioCache.delete(audioId!), 120_000);
        console.log(`[Twilio] Cartesia TTS OK: ${audioBuffer.length} bytes, id=${audioId}`);
      } catch (ttsErr) {
        console.error("[Twilio] Cartesia TTS failed:", ttsErr);
      }
    }

    pendingResponses.set(callSid, { reply: truncated, audioId });
    console.log(`[Twilio] Response ready for ${callSid}`);
  } catch (err) {
    console.error("[Twilio] Processing error:", err);
    pendingResponses.set(callSid, { reply: "I am sorry, something went wrong. Could you try again?" });
  }
}

/**
 * POST /wait/:callSid — Polls until response is ready.
 */
twilioRouter.post("/wait/:callSid", (req, res) => {
  const { callSid } = req.params;
  const pending = pendingResponses.get(callSid);
  const baseUrl = getBaseUrl(req);

  if (pending) {
    console.log(`[Twilio] /wait — ready, redirecting to /respond/${callSid}`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${baseUrl}/api/twilio/respond/${callSid}</Redirect>
</Response>`);
  } else {
    console.log(`[Twilio] /wait — still processing ${callSid}`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${HOLD_MUSIC_URL}</Play>
  <Redirect method="POST">${baseUrl}/api/twilio/wait/${callSid}</Redirect>
</Response>`);
  }
});

/**
 * POST /respond/:callSid — Delivers the processed response to the caller.
 */
twilioRouter.post("/respond/:callSid", (req, res) => {
  const { callSid } = req.params;
  console.log(`[Twilio] /respond hit for ${callSid}`);
  const pending = pendingResponses.get(callSid);
  pendingResponses.delete(callSid);
  const baseUrl = getBaseUrl(req);
  const gatherUrl = `${baseUrl}/api/twilio/gather`;

  if (!pending) {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">I am sorry, I lost track of your question. Could you repeat it?</Say>
  <Gather input="speech" action="${gatherUrl}" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
</Response>`);
    return;
  }

  const { reply, audioId } = pending;

  if (audioId && audioCache.has(audioId)) {
    // Play Cartesia TTS audio
    const audioUrl = `${baseUrl}/api/twilio/audio/${audioId}`;
    console.log(`[Twilio] Playing Cartesia audio: ${audioUrl}`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Gather input="speech" action="${gatherUrl}" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Pause length="5"/>
  <Say voice="Polly.Joanna-Neural">Is there anything else I can help with?</Say>
  <Gather input="speech" action="${gatherUrl}" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna-Neural">Goodbye! Have a wonderful day.</Say>
</Response>`);
  } else {
    // Fallback to Polly Neural
    console.log(`[Twilio] Polly fallback for ${callSid}`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">${escapeXml(reply)}</Say>
  <Gather input="speech" action="${gatherUrl}" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Pause length="5"/>
  <Say voice="Polly.Joanna-Neural">Is there anything else I can help with?</Say>
  <Gather input="speech" action="${gatherUrl}" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna-Neural">Goodbye! Have a wonderful day.</Say>
</Response>`);
  }
});

/**
 * GET /audio/:id — Serves cached Cartesia audio to Twilio.
 */
twilioRouter.get("/audio/:id", (req, res) => {
  const id = req.params.id;
  console.log(`[Twilio] Audio fetch: ${id}`);
  const audio = audioCache.get(id);
  if (!audio) {
    console.log(`[Twilio] Audio not found: ${id}`);
    res.status(404).send("Audio not found");
    return;
  }
  console.log(`[Twilio] Serving ${audio.length} bytes`);
  res.set({
    "Content-Type": "audio/mpeg",
    "Content-Length": audio.length.toString(),
    "Cache-Control": "no-cache",
  });
  res.send(audio);
});

/**
 * Truncate response for voice — max ~500 chars to keep it concise.
 */
function truncateForVoice(text: string): string {
  let clean = text
    .replace(/[*_#`~]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (clean.length > 500) {
    const cut = clean.substring(0, 500);
    const lastPeriod = cut.lastIndexOf(".");
    if (lastPeriod > 200) {
      clean = cut.substring(0, lastPeriod + 1);
    } else {
      clean = cut + "...";
    }
    clean += " Would you like to know more?";
  }
  return clean;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getBaseUrl(req: any): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}
