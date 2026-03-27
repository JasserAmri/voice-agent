import { config } from "./config.js";
import { metrics } from "./metrics.js";

const CARTESIA_API = "https://api.cartesia.ai/tts/bytes";

// Cartesia "British Lady" — warm, professional hotel concierge voice
const DEFAULT_VOICE_ID = "79a125e8-cd45-4c13-8a67-188112f4dd22";

export async function textToSpeech(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<Buffer> {
  const start = Date.now();

  const res = await fetch(CARTESIA_API, {
    method: "POST",
    headers: {
      "X-API-Key": config.cartesiaApiKey,
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: "sonic-2",
      transcript: text,
      voice: {
        mode: "id",
        id: voiceId,
      },
      output_format: {
        container: "mp3",
        encoding: "mp3",
        sample_rate: 24000,
      },
    }),
  });

  if (!res.ok) {
    metrics.trackTtsError();
    const err = await res.text();
    throw new Error(`Cartesia TTS failed (${res.status}): ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const latency = Date.now() - start;

  metrics.trackTts(text.length, buffer.length, latency);

  return buffer;
}
