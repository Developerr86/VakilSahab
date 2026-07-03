// URL canonicalization, dedup, lexical reranking, and domain diversity.
// All zero-dep and deterministic — no LLM, no embeddings required. (You can
// swap rankByRelevance for an embedding cosine score later; the seam is here.)

import type { SearchHit } from './types'

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|mc_|ref|ref_src|spm|igshid|si)$/i

/** Normalize a URL so trivially-different forms dedupe to one key:
 * drop tracking params, fragments, trailing slash; lowercase host. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    for (const key of Array.from(u.searchParams.keys())) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key)
    }
    let s = u.toString()
    s = s.replace(/\/$/, '')
    return s
  } catch {
    return raw
  }
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

/** Cheap lexical relevance: fraction of objective terms present in the hit,
 * weighted toward the title. Range ~0..1.5. */
function relevance(hit: SearchHit, objectiveTokens: Set<string>): number {
  const titleTokens = new Set(tokenize(hit.title))
  const bodyTokens = new Set(tokenize(hit.content))
  let titleHits = 0
  let bodyHits = 0
  for (const t of objectiveTokens) {
    if (titleTokens.has(t)) titleHits++
    else if (bodyTokens.has(t)) bodyHits++
  }
  const n = Math.max(objectiveTokens.size, 1)
  return (titleHits / n) * 1.0 + (bodyHits / n) * 0.5
}

/** Dedup against an external `seen` set (canonical URLs the agent already has),
 * mutating it so cross-round dedup works. */
export function dedupNew(hits: SearchHit[], seen: Set<string>): SearchHit[] {
  const out: SearchHit[] = []
  for (const h of hits) {
    if (!h.url) continue
    const key = canonicalizeUrl(h.url)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...h, url: key })
  }
  return out
}

/** Rerank by blended provider-score + lexical relevance, then enforce host
 * diversity (at most `perHost` results from any one domain) so a single site
 * can't dominate the evidence set. */
export function rerank(
  hits: SearchHit[],
  objective: string,
  { perHost = 2 }: { perHost?: number } = {},
): SearchHit[] {
  const objectiveTokens = new Set(tokenize(objective))
  const maxProviderScore = Math.max(1, ...hits.map((h) => h.score ?? 0))

  const scored = hits
    .map((h) => ({
      hit: h,
      rank: relevance(h, objectiveTokens) + 0.4 * ((h.score ?? 0) / maxProviderScore),
    }))
    .sort((a, b) => b.rank - a.rank)

  const perHostCount = new Map<string, number>()
  const diverse: SearchHit[] = []
  for (const { hit } of scored) {
    let host = ''
    try {
      host = new URL(hit.url).hostname
    } catch {
      /* keep host empty */
    }
    const n = perHostCount.get(host) ?? 0
    if (host && n >= perHost) continue
    perHostCount.set(host, n + 1)
    diverse.push(hit)
  }
  return diverse
}