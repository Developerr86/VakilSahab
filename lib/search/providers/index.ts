// Provider registry. Every keyless provider here is zero-infra. The broad-web
// slot is the composite `webSearchProvider`, which runs the configured fallback
// chain (DuckDuckGo -> Tavily -> Bing; see web.ts). Specialist providers
// (Wikipedia/GitHub/Stack Exchange) are added per query by pickProviders().

import type { SearchProvider } from '../types'
import { duckDuckGoProvider } from './duckduckgo'
import { tavilyProvider } from './tavily'
import { bingProvider } from './bing'
import { webSearchProvider } from './web'
import { wikipediaProvider } from './wikipedia'
import { githubProvider } from './github'
import { stackExchangeProvider } from './stackexchange'

export const ALL_PROVIDERS: SearchProvider[] = [
  webSearchProvider, // broad web search — fallback chain DDG -> Tavily -> Bing
  wikipediaProvider, // authoritative facts / definitions
  githubProvider, // open-source tools / competitors
  stackExchangeProvider, // technical pain points
]

// Includes the individual web backends by name so an explicit `only` list can
// still target one directly (e.g. only: ['bing']).
export const PROVIDERS_BY_NAME: Record<string, SearchProvider> = Object.fromEntries(
  [...ALL_PROVIDERS, duckDuckGoProvider, tavilyProvider, bingProvider].map((p) => [p.name, p]),
)

/** Choose providers for a query. Always include the broad-web chain; add
 * specialist providers when the query hints at them. Override via `only`. */
export function pickProviders(query: string, only?: string[]): SearchProvider[] {
  if (only?.length) return only.map((n) => PROVIDERS_BY_NAME[n]).filter(Boolean)
  const q = query.toLowerCase()
  const chosen: SearchProvider[] = [webSearchProvider]
  if (/(library|sdk|package|repo|open source|github|cli)/.test(q)) chosen.push(githubProvider)
  if (/(error|how to|bug|exception|api|code|install)/.test(q)) chosen.push(stackExchangeProvider)
  if (/(what is|history|definition|founded|who is|meaning)/.test(q)) chosen.push(wikipediaProvider)
  return chosen
}

export {
  webSearchProvider,
  duckDuckGoProvider,
  tavilyProvider,
  bingProvider,
  wikipediaProvider,
  githubProvider,
  stackExchangeProvider,
}
