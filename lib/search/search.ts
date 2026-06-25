// Multi-provider fan-out for ONE round. Routes each query to the relevant
// keyless providers, runs DuckDuckGo sequentially (it rate-limits parallel requests)
// while running API providers in parallel, and merges + reranks the results.

import { pickProviders } from './providers'
import { webSearchProvider } from './providers/web'
import { dedupNew, rerank } from './rerank'
import type { SearchHit, SearchProvider } from './types'

const DDG_PAUSE_MS = 400

async function searchOne(
  provider: SearchProvider,
  query: string,
  maxPerQuery: number,
): Promise<SearchHit[]> {
  try {
    return await provider.search(query, maxPerQuery)
  } catch (err) {
    console.warn(`[search:${provider.name}] "${query}" failed:`, err)
    return []
  }
}

/**
 * Run a batch of queries for one round. For each query we hit its routed
 * providers. DDG calls are serialized across the whole batch (shared pause);
 * keyless APIs run in parallel since they don't rate-limit like DDG.
 */
export async function searchRound(
  queries: string[],
  {
    objective,
    maxPerQuery = 5,
    seen,
    only,
  }: { objective: string; maxPerQuery?: number; seen: Set<string>; only?: string[] },
): Promise<SearchHit[]> {
  const webJobs: Array<{ query: string }> = []
  const apiPromises: Promise<SearchHit[]>[] = []

  for (const query of queries) {
    for (const provider of pickProviders(query, only)) {
      if (provider.name === webSearchProvider.name) webJobs.push({ query })
      else apiPromises.push(searchOne(provider, query, maxPerQuery))
    }
  }

  // Broad-web chain (may hit DDG, which rate-limits): strictly sequential with
  // a pause to avoid CAPTCHA/blocks.
  const webResults: SearchHit[] = []
  for (const job of webJobs) {
    webResults.push(...(await searchOne(webSearchProvider, job.query, maxPerQuery)))
    await new Promise((r) => setTimeout(r, DDG_PAUSE_MS))
  }

  const apiResults = (await Promise.all(apiPromises)).flat()
  const fresh = dedupNew([...webResults, ...apiResults], seen)
  return rerank(fresh, objective)
}