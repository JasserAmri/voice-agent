// Cache to avoid re-shortening the same URL
const cache = new Map<string, string>();

/**
 * Shorten a URL using TinyURL free API.
 * Falls back to the original URL if the service is unavailable.
 */
export async function shortenUrl(longUrl: string): Promise<string> {
  // Check cache first
  const cached = cache.get(longUrl);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`
    );

    if (!res.ok) {
      console.error(`[Shortener] TinyURL returned ${res.status}`);
      return longUrl;
    }

    const shortUrl = (await res.text()).trim();
    console.log(`[Shortener] ${longUrl.substring(0, 60)}... → ${shortUrl}`);
    cache.set(longUrl, shortUrl);
    return shortUrl;
  } catch (err) {
    console.error(`[Shortener] Error:`, (err as Error).message);
    return longUrl; // Fallback to original URL
  }
}
