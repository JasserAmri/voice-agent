import { Router } from "express";
import crypto from "crypto";

export const redirectRouter = Router();

// In-memory URL store with auto-expiry
const urlStore = new Map<string, { url: string; expiresAt: number }>();

const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function shortenUrl(longUrl: string, baseUrl: string): string {
  // Check if we already shortened this URL
  for (const [code, entry] of urlStore) {
    if (entry.url === longUrl && entry.expiresAt > Date.now()) {
      return `${baseUrl}/r/${code}`;
    }
  }

  const code = crypto.randomBytes(4).toString("hex"); // 8 chars
  urlStore.set(code, { url: longUrl, expiresAt: Date.now() + EXPIRY_MS });

  // Cleanup expired entries
  for (const [key, entry] of urlStore) {
    if (entry.expiresAt < Date.now()) urlStore.delete(key);
  }

  return `${baseUrl}/r/${code}`;
}

/**
 * GET /r/:code — Redirects to the original long URL
 */
redirectRouter.get("/r/:code", (req, res) => {
  const entry = urlStore.get(req.params.code);
  if (!entry || entry.expiresAt < Date.now()) {
    res.status(404).send("Link expired or not found");
    return;
  }
  console.log(`[Redirect] ${req.params.code} → ${entry.url.substring(0, 80)}...`);
  res.redirect(302, entry.url);
});
