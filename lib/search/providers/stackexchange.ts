// Stack Exchange provider: public API for questions and answers.
// Default site: stackoverflow. Works unauth, respects rate limits.

import { fetchWithRetry, stripTags } from '../http'
import type { SearchHit, SearchProvider } from '../types'

const STACK_API = 'https://api.stackexchange.com/2.3'

export const stackExchangeProvider: SearchProvider = {
  name: 'stackexchange',
  async search(query: string, maxResults = 5): Promise<SearchHit[]> {
    try {
      const params = new URLSearchParams({
        order: 'desc',
        sort: 'relevance',
        intitle: query,
        site: 'stackoverflow',
        pagesize: String(maxResults),
        filter: '!9Z(-wzftf', // include body
      })
      const response = await fetchWithRetry(`${STACK_API}/search/advanced?${params}`, {
        timeoutMs: 8_000,
        retries: 1,
      })
      const data = await response.json()
      if (!data?.items?.length) return []
      return data.items.map((item: any, i: number) => ({
        title: stripTags(item.title),
        url: item.link,
        content: stripTags(item.body || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 500) || '',
        score: data.items.length - i,
        source: 'stackexchange',
      }))
    } catch (err) {
      console.warn('[stackexchange] search failed:', err)
      return []
    }
  },
}