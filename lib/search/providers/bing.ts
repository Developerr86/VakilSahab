// Bing provider: keyless HTML scrape of the public results page. Used as the
// final fallback (no key required). Markup can drift over time — if Bing changes
// its result structure, parseBing() is the place to adjust.

import { fetchWithRetry, decodeHtml, stripTags } from '../http'
import type { SearchHit, SearchProvider } from '../types'

const BING_SEARCH = 'https://www.bing.com/search'
// NOTE: modern Chrome UAs get a JS-only shell with no server-rendered results.
// An older Firefox UA reliably returns the classic b_algo HTML we can parse.
const BING_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; rv:60.0) Gecko/20100101 Firefox/60.0',
}

/** Bing wraps many result links in a /ck/a redirect with the real URL base64'd
 * into the `u` param (prefixed with "a1"). Decode it; pass plain links through. */
function resolveBingUrl(href: string): string | null {
  const decoded = decodeHtml(href)
  if (!decoded.includes('bing.com/ck/a')) {
    return decoded.startsWith('http') ? decoded : null
  }
  try {
    const parsed = new URL(decoded, 'https://www.bing.com')
    const enc = parsed.searchParams.get('u')
    if (!enc) return null
    const b64 = enc.replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/')
    const real = Buffer.from(b64, 'base64').toString('utf-8')
    return real.startsWith('http') ? real : null
  } catch {
    return null
  }
}

function parseBing(html: string, maxResults: number): SearchHit[] {
  const hits: SearchHit[] = []
  // Organic results live in <li class="b_algo">; each has <h2 ...><a href>title</a>.
  const itemRegex = /<h2[^>]*>\s*<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi
  let match: RegExpExecArray | null
  while ((match = itemRegex.exec(html)) && hits.length < maxResults) {
    const url = resolveBingUrl(match[1])
    if (!url || /(\.|\/\/)bing\.com\//.test(url) || url.includes('go.microsoft.com')) continue

    // Snippet: first <p> after the heading (b_lineclamp/b_caption text).
    const rest = html.slice(itemRegex.lastIndex, itemRegex.lastIndex + 3000)
    const snippet = rest.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
    hits.push({
      title: stripTags(match[2]),
      url,
      content: snippet ? stripTags(snippet[1]) : '',
      score: maxResults - hits.length,
      source: 'bing',
    })
  }
  return hits
}

export const bingProvider: SearchProvider = {
  name: 'bing',
  async search(query: string, maxResults = 5): Promise<SearchHit[]> {
    try {
      const url = `${BING_SEARCH}?q=${encodeURIComponent(query)}&count=${maxResults}&setlang=en-US`
      const response = await fetchWithRetry(url, {
        timeoutMs: 8_000,
        retries: 1,
        headers: BING_HEADERS,
      })
      if (!response.ok) return []
      return parseBing(await response.text(), maxResults)
    } catch (err) {
      console.warn('[bing] search failed:', err)
      return []
    }
  },
}
