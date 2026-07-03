// Composite broad-web provider implementing the configured fallback chain.
//
// Order (per query): the env-selected primary first, then the remaining
// providers in the canonical order DuckDuckGo -> Tavily -> Bing.
//   - SEARCH_PROVIDER selects the primary (default: duckduckgo).
//   - Tavily is skipped when TAVILY_API_KEY is absent; if the key is present
//     but invalid, its call returns no results and we fall through to Bing.
//   - A provider "fails" (and we advance) when it throws OR returns 0 hits —
//     so a single DDG timeout (which surfaces as 0 hits) triggers the fallback.

import type { SearchHit, SearchProvider } from '../types'
import { duckDuckGoProvider } from './duckduckgo'
import { tavilyProvider, tavilyKeyPresent } from './tavily'
import { bingProvider } from './bing'

const CANONICAL_ORDER = ['duckduckgo', 'tavily', 'bing'] as const
const BY_NAME: Record<string, SearchProvider> = {
  duckduckgo: duckDuckGoProvider,
  tavily: tavilyProvider,
  bing: bingProvider,
}

/** Primary first (from SEARCH_PROVIDER, default duckduckgo), then the rest in
 * canonical order. Deduped, invalid names ignored. */
function providerChain(): SearchProvider[] {
  const primary = (process.env.SEARCH_PROVIDER || 'duckduckgo').toLowerCase()
  const names = [primary, ...CANONICAL_ORDER.filter((n) => n !== primary)]
  return Array.from(new Set(names)).map((n) => BY_NAME[n]).filter(Boolean)
}

export const webSearchProvider: SearchProvider = {
  name: 'web',
  async search(query: string, maxResults = 5): Promise<SearchHit[]> {
    for (const provider of providerChain()) {
      if (provider.name === 'tavily' && !tavilyKeyPresent()) continue // no key → skip
      try {
        const hits = await provider.search(query, maxResults)
        if (hits.length > 0) return hits
      } catch (err) {
        console.warn(`[web] ${provider.name} failed, trying next:`, err)
      }
    }
    return []
  },
}
