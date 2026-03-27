import { Router } from "express";
import { processMessage } from "../agent.js";
import { textToSpeech } from "../tts.js";
import { config } from "../config.js";
import express from "express";

export const twilioRouter = Router();
twilioRouter.use(express.urlencoded({ extended: false }));

// In-memory caches
const audioCache = new Map<string, Buffer>();
const pendingResponses = new Map<string, { reply: string; audioId?: string }>();

// Royalty-free hold music URL (gentle piano loop)
const HOLD_MUSIC_URL = "http://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-B8.mp3";

/**
 * POST /incoming — Twilio hits this when someone calls.
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
 * POST /gather — Called when caller speaks.
 * Immediately plays hold music, processes in background, then redirects to response.
 */
twilioRouter.post("/gather", async (req, res) => {
  const callSid = req.body.CallSid || "unknown";
  const speechResult = req.body.SpeechResult;

  if (!speechResult) {
    console.log(`[Twilio] No speech detected for call ${callSid}`);
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I didn't catch that. Could you repeat?</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna">Goodbye!</Say>
</Response>`);
    return;
  }

  console.log(`[Twilio] Speech: "${speechResult}" (call: ${callSid})`);

  // Start processing in background
  processInBackground(callSid, speechResult, req);

  // Immediately respond with filler + hold music while we process
  // The /wait endpoint will poll for the response and redirect when ready
  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">One moment please.</Say>
  <Play>${HOLD_MUSIC_URL}</Play>
  <Redirect method="POST">/api/twilio/wait/${callSid}</Redirect>
</Response>`);
});

/**
 * Background processing — runs LLM + TTS and stores result.
 * Then uses Twilio REST API to redirect the live call to the response.
 */
async function processInBackground(callSid: string, speechResult: string, req: any) {
  try {
    const reply = await processMessage(`twilio-${callSid}`, speechResult);
    console.log(`[Twilio] Reply: "${reply.substring(0, 100)}..."`);

    // Truncate very long responses for voice
    const truncated = truncateForVoice(reply);

    // Generate TTS audio
    let audioId: string | undefined;
    if (config.elevenlabsApiKey) {
      try {
        const audioBuffer = await textToSpeech(truncated);
        audioId = `${callSid}-${Date.now()}`;
        audioCache.set(audioId, audioBuffer);
        setTimeout(() => audioCache.delete(audioId!), 120_000);
      } catch (ttsErr) {
        console.error("[Twilio] ElevenLabs TTS failed:", ttsErr);
      }
    }

    // Store response
    pendingResponses.set(callSid, { reply: truncated, audioId });

    // Use Twilio REST API to redirect the live call to the response
    const baseUrl = getBaseUrl(req);
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls/${callSid}.json`;
      const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
      await fetch(twilioUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `Url=${encodeURIComponent(baseUrl + "/api/twilio/respond/" + callSid)}&Method=POST`,
      });
      console.log(`[Twilio] Redirected call ${callSid} to response`);
    } catch (redirectErr) {
      console.error("[Twilio] Failed to redirect call:", redirectErr);
      // Response will still be available via /wait polling fallback
    }
  } catch (err) {
    console.error("[Twilio] Processing error:", err);
    pendingResponses.set(callSid, { reply: "I'm sorry, something went wrong. Could you try again?" });
  }
}

/**
 * POST /wait/:callSid — Fallback polling endpoint.
 * If the Twilio REST API redirect didn't work, this catches the call
 * after hold music ends and redirects to response if ready.
 */
twilioRouter.post("/wait/:callSid", (req, res) => {
  const { callSid } = req.params;
  const pending = pendingResponses.get(callSid);

  if (pending) {
    // Response is ready — redirect to it
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">/api/twilio/respond/${callSid}</Redirect>
</Response>`);
  } else {
    // Still processing — play more hold music and check again
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${HOLD_MUSIC_URL}</Play>
  <Redirect method="POST">/api/twilio/wait/${callSid}</Redirect>
</Response>`);
  }
});

/**
 * POST /respond/:callSid — Delivers the processed response to the caller.
 */
twilioRouter.post("/respond/:callSid", (req, res) => {
  const { callSid } = req.params;
  const pending = pendingResponses.get(callSid);
  pendingResponses.delete(callSid);

  if (!pending) {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm sorry, I lost track of your question. Could you repeat it?</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
</Response>`);
    return;
  }

  const baseUrl = getBaseUrl(req);
  const { reply, audioId } = pending;

  if (audioId && audioCache.has(audioId)) {
    // Play ElevenLabs audio
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${baseUrl}/api/twilio/audio/${audioId}</Play>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Pause length="5"/>
  <Say voice="Polly.Joanna">Is there anything else I can help with?</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna">Goodbye! Have a wonderful day.</Say>
</Response>`);
  } else {
    // Fallback to Polly
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(reply)}</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Pause length="5"/>
  <Say voice="Polly.Joanna">Is there anything else I can help with?</Say>
  <Gather input="speech" action="/api/twilio/gather" method="POST"
    speechTimeout="auto" language="en-US" enhanced="true">
  </Gather>
  <Say voice="Polly.Joanna">Goodbye! Have a wonderful day.</Say>
</Response>`);
  }
});

/**
 * GET /audio/:id — Serves cached ElevenLabs audio to Twilio.
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

/**
 * Truncate response for voice — max ~500 chars to keep it concise.
 */
function truncateForVoice(text: string): string {
  // Strip any markdown that leaked through
  let clean = text
    .replace(/[*_#`~]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (clean.length > 500) {
    // Cut at last sentence boundary before 500 chars
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
