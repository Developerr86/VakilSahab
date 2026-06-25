// Wikipedia provider: keyless API to search and fetch article summaries.
// Uses the public Wikipedia API (CORS-friendly with `origin=*`).

import { fetchWithRetry, stripTags } from '../http'
import type { SearchHit, SearchProvider } from '../types'

const WIKI_API = 'https://en.wikipedia.org/w/api.php'

export const wikipediaProvider: SearchProvider = {
  name: 'wikipedia',
  async search(query: string, maxResults = 5): Promise<SearchHit[]> {
    try {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        origin: '*',
        list: 'search',
        srsearch: query,
        srlimit: String(maxResults),
        srprop: 'snippet|titlesnippet',
        srinfo: 'size',
      })
      const response = await fetchWithRetry(`${WIKI_API}?${params}`, {
        timeoutMs: 8_000,
        retries: 1,
      })
      const data = await response.json()
      if (!data?.query?.search?.length) return []
      return data.query.search.map((item: any, i: number) => ({
        title: stripTags(item.title || item.titlesnippet || item.title),
        url: `https://en.wikipedia.org/wiki?curid=${item.pageid}`, // more stable than raw title
        content: stripTags(item.snippet || ''),
        score: data.query.search.length - i,
        source: 'wikipedia',
      }))
    } catch (err) {
      console.warn('[wikipedia] search failed:', err)
      return []
    }
  },
}