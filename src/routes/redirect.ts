// Cache to avoid re-shortening the same URL
const cache = new Map<string, string>();

/**
 * Shorten a URL using is.gd free API (confirmed working in Tunisia).
 * Falls back to TinyURL, then original URL if both fail.
 */
export async function shortenUrl(longUrl: string): Promise<string> {
  // Check cache first
  const cached = cache.get(longUrl);
  if (cached) return cached;

  // Try is.gd first (confirmed working)
  try {
    const res = await fetch(
      `https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`
    );

    if (res.ok) {
      const shortUrl = (await res.text()).trim();
      if (shortUrl.startsWith("http")) {
        console.log(`[Shortener] is.gd: ${longUrl.substring(0, 60)}... → ${shortUrl}`);
        cache.set(longUrl, shortUrl);
        return shortUrl;
      }
    }
    console.warn(`[Shortener] is.gd returned ${res.status}, trying TinyURL...`);
  } catch (err) {
    console.warn(`[Shortener] is.gd error: ${(err as Error).message}, trying TinyURL...`);
  }

  // Fallback to TinyURL
  try {
    const res = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`
    );

    if (res.ok) {
      const shortUrl = (await res.text()).trim();
      console.log(`[Shortener] TinyURL: ${longUrl.substring(0, 60)}... → ${shortUrl}`);
      cache.set(longUrl, shortUrl);
      return shortUrl;
    }
  } catch (err) {
    console.error(`[Shortener] TinyURL also failed:`, (err as Error).message);
  }

  // Last resort: return original URL
  return longUrl;
}
