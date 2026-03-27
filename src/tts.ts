import { config } from "./config.js";
import { metrics } from "./metrics.js";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

// Sarah — mature, reassuring, confident (premade, works on free tier)
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

const VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.4,
  use_speaker_boost: true,
};

export async function textToSpeech(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID
): Promise<Buffer> {
  const start = Date.now();

  const res = await fetch(
    `${ELEVENLABS_API}/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenlabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: VOICE_SETTINGS,
      }),
    }
  );

  if (!res.ok) {
    metrics.trackTtsError();
    const err = await res.text();
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${err}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const latency = Date.now() - start;

  metrics.trackTts(text.length, buffer.length, latency);

  return buffer;
}
