import dotenv from "dotenv";
dotenv.config({ override: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  // LLM — Azure OpenAI (primary) or OpenRouter (fallback)
  llmProvider: (process.env.LLM_PROVIDER || "azure") as "azure" | "openrouter",

  // Azure OpenAI
  azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
  azureApiKey: process.env.AZURE_OPENAI_API_KEY || "",
  azureDeployment: process.env.AZURE_OPENAI_DEPLOYMENT || "",
  azureApiVersion: process.env.AZURE_OPENAI_API_VERSION || "2025-01-01-preview",

  // OpenRouter (fallback)
  openrouterApiKey: process.env.OPENROUTER_API_KEY || "",
  openrouterModel: process.env.OPENROUTER_MODEL || "google/gemma-3-27b-it:free",

  mcpServerUrl: required("MCP_SERVER_URL"),
  mcpBearerToken: required("MCP_BEARER_TOKEN"),
  port: parseInt(process.env.PORT || "3000", 10),

  // Cartesia TTS (replaces ElevenLabs)
  cartesiaApiKey: process.env.CARTESIA_API_KEY || "",

  // ElevenLabs TTS (legacy — kept for reference)
  elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || "",

  // Twilio
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || "",

  // LiveKit (for future real-time voice)
  livekitUrl: process.env.LIVEKIT_URL || "",
  livekitApiKey: process.env.LIVEKIT_API_KEY || "",
  livekitApiSecret: process.env.LIVEKIT_API_SECRET || "",
};
