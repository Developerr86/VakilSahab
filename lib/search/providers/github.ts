// GitHub provider: public API for repository search (unauth works, token optional).
// Rate limit: 10 req/min unauth, 30 req/min with token.

import { fetchWithRetry, stripTags } from '../http'
import type { SearchHit, SearchProvider } from '../types'

const GITHUB_API = 'https://api.github.com/search/repositories'

export const githubProvider: SearchProvider = {
  name: 'github',
  async search(query: string, maxResults = 5): Promise<SearchHit[]> {
    try {
      const params = new URLSearchParams({
        q: query,
        per_page: String(maxResults),
        sort: 'stars',
        order: 'desc',
      })
      const headers: Record<string, string> = {}
      const token = process.env.GITHUB_TOKEN
      if (token) headers.Authorization = `token ${token}`
      const response = await fetchWithRetry(`${GITHUB_API}?${params}`, {
        timeoutMs: 8_000,
        retries: 1,
        headers,
      })
      if (!response.ok) {
        if (response.status === 403) {
          console.warn('[github] rate limited (403)')
        }
        return []
      }
      const data = await response.json()
      if (!data?.items?.length) return []
      return data.items.map((item: any, i: number) => ({
        title: stripTags(item.full_name),
        url: item.html_url,
        content: stripTags(item.description || ''),
        score: data.items.length - i,
        source: 'github',
      }))
    } catch (err) {
      console.warn('[github] search failed:', err)
      return []
    }
  },
}