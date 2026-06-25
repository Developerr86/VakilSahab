// Tavily provider: AI-search API tuned for agents. Keyed (TAVILY_API_KEY).
// Used as the first fallback when DuckDuckGo fails. If the key is missing the
// provider is skipped entirely (see web.ts); if the key is present but invalid
// the API returns 401 and we return [] so the chain falls through to Bing.

import type { SearchHit, SearchProvider } from '../types'

const TAVILY_API = 'https://api.tavily.com/search'

/** True only when a key is configured — lets the chain skip Tavily cleanly. */
export function tavilyKeyPresent(): boolean {
  return Boolean(process.env.TAVILY_API_KEY)
}

export const tavilyProvider: SearchProvider = {
  name: 'tavily',
  async search(query: string, maxResults = 5): Promise<SearchHit[]> {
    const key = process.env.TAVILY_API_KEY
    if (!key) return [] // no key → nothing to do (web.ts skips us anyway)
    try {
      const res = await fetch(TAVILY_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query,
          max_results: maxResults,
          search_depth: 'basic',
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        // 401/403 = bad key → fall through to Bing; other codes likewise.
        console.warn(`[tavily] HTTP ${res.status} — falling back`)
        return []
      }
      const data = await res.json()
      const results: any[] = data?.results ?? []
      return results.slice(0, maxResults).map((r, i) => ({
        title: String(r.title ?? r.url ?? ''),
        url: String(r.url ?? ''),
        content: String(r.content ?? ''),
        score: typeof r.score === 'number' ? r.score : results.length - i,
        source: 'tavily',
      }))
    } catch (err) {
      console.warn('[tavily] search failed:', err)
      return []
    }
  },
}
