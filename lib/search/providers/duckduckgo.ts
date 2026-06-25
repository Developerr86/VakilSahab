// DuckDuckGo provider: package search → html.duckduckgo.com → lite.duckduckgo.com.
// Keyless. DDG rate-limits/CAPTCHAs aggressively, so callers MUST run queries
// sequentially with a pause (see ../search.ts runQueries).
//
// `duck-duck-scrape` is optional. If it's not installed the provider goes
// straight to HTML scraping, which has no dependencies at all.

import { fetchWithRetry, decodeHtml, stripTags } from '../http'
import type { SearchHit, SearchProvider } from '../types'

const DDG_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
}

function resolveDuckDuckGoUrl(rawUrl: string): string {
  const decoded = decodeHtml(rawUrl)
  const absolute = decoded.startsWith('//') ? `https:${decoded}` : decoded
  try {
    const parsed = new URL(absolute)
    const uddg = parsed.searchParams.get('uddg')
    return uddg ? decodeURIComponent(uddg) : parsed.toString()
  } catch {
    return decoded
  }
}

function parseHtmlResults(html: string, maxResults: number): SearchHit[] {
  const hits: SearchHit[] = []
  const linkRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(html)) && hits.length < maxResults) {
    const nextLinkIndex = html.indexOf('class="result__a"', linkRegex.lastIndex)
    const resultHtml = html.slice(
      match.index,
      nextLinkIndex === -1 ? Math.min(html.length, match.index + 6000) : nextLinkIndex,
    )
    const snippet =
      resultHtml.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ??
      resultHtml.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i)
    const url = resolveDuckDuckGoUrl(match[1])
    if (!url.startsWith('http')) continue
    hits.push({
      title: stripTags(match[2]),
      url,
      content: snippet ? stripTags(snippet[1]) : '',
      score: maxResults - hits.length,
      source: 'duckduckgo',
    })
  }
  return hits
}

function parseLiteResults(html: string, maxResults: number): SearchHit[] {
  const hits: SearchHit[] = []
  const linkRegex = /<a[^>]+class=['"]result-link['"][^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(html)) && hits.length < maxResults) {
    const afterLink = html.slice(match.index, html.indexOf('</table>', match.index))
    const snippet = afterLink.match(/<td class=['"]result-snippet['"]>([\s\S]*?)<\/td>/i)
    const url = resolveDuckDuckGoUrl(match[1])
    if (!url.startsWith('http')) continue
    hits.push({
      title: stripTags(match[2]),
      url,
      content: snippet ? stripTags(snippet[1]) : '',
      score: maxResults - hits.length,
      source: 'duckduckgo',
    })
  }
  return hits
}

async function searchHtml(query: string, maxResults: number): Promise<SearchHit[]> {
  const encoded = encodeURIComponent(query)
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encoded}`,
    `https://lite.duckduckgo.com/lite/?q=${encoded}`,
  ]
  for (const endpoint of endpoints) {
    // Fail fast: if DDG is unreachable (e.g. ISP-blocked), don't stall the
    // whole agent — give up quickly and let other providers carry the round.
    const response = await fetchWithRetry(endpoint, {
      timeoutMs: 4_000,
      retries: 0,
      headers: DDG_HEADERS,
    })
    if (!response.ok) continue
    const html = await response.text()
    const hits = endpoint.includes('/lite/')
      ? parseLiteResults(html, maxResults)
      : parseHtmlResults(html, maxResults)
    if (hits.length > 0) return hits
  }
  return []
}

export const duckDuckGoProvider: SearchProvider = {
  name: 'duckduckgo',
  async search(query: string, maxResults = 5): Promise<SearchHit[]> {
    try {
      // @ts-ignore optional dependency — falls back to HTML scraping if absent
      const ddg = await import('duck-duck-scrape')
      // duck-duck-scrape has no timeout control; race it so a dead/blocked
      // connection bails in ~5s instead of hanging on UND_ERR_CONNECT_TIMEOUT.
      const response = (await Promise.race([
        ddg.search(query, { safeSearch: ddg.SafeSearchType.MODERATE }, { headers: DDG_HEADERS }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('duck-duck-scrape timeout')), 5_000),
        ),
      ])) as Awaited<ReturnType<typeof ddg.search>>
      if (response.noResults || !response.results?.length) return searchHtml(query, maxResults)
      return response.results.slice(0, maxResults).map((r: any, i: number) => ({
        title: stripTags(r.title),
        url: r.url,
        content: stripTags(r.description || r.rawDescription || ''),
        score: response.results.length - i,
        source: 'duckduckgo',
      }))
    } catch (err) {
      // package missing OR rate-limited → HTML scrape fallback.
      return searchHtml(query, maxResults)
    }
  },
}