import dotenv from "dotenv";
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  openrouterApiKey: process.env.OPENROUTER_API_KEY || "",
  openrouterModel: process.env.OPENROUTER_MODEL || "google/gemma-3-27b-it:free",
  mcpServerUrl: required("MCP_SERVER_URL"),
  mcpBearerToken: required("MCP_BEARER_TOKEN"),
  port: parseInt(process.env.PORT || "3000", 10),
};
