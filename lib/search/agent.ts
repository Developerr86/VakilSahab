// The iterative search agent. This is what makes results DEEP instead of
// surface-level: it plans queries, searches across free providers, READS the
// top pages, asks the LLM what's still missing, searches again, verifies shaky
// claims, and only then synthesizes a cited answer.
//
//   plan → [ search → read → gap-analysis ] × rounds → verify claims → synthesize
//
// Everything below is keyless and zero-infra. The only external dependency is
// YOUR LLM, injected via the `llm` function (see types.ts → LLM).

import { fetchPageText } from './http'
import { searchRound } from './search'
import {
  planQueriesPrompt,
  gapAnalysisPrompt,
  extractClaimsPrompt,
  verifyClaimPrompt,
  synthesizePrompt,
} from './prompts'
import type { Claim, Evidence, LLM, SearchAgentResult, SearchHit } from './types'

/** Tolerant JSON parse — strips code fences and grabs the first {...} block. */
export function safeParseJSON<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0]) as T
      } catch {
        /* fall through */
      }
    }
    return fallback
  }
}

export interface SearchAgentOptions {
  llm: LLM
  /** Max search rounds (each = search + read + gap analysis). Default 3. */
  maxRounds?: number
  /** Pages to fully read (extract text) per round. Default 4. */
  readsPerRound?: number
  /** Results requested per query per provider. Default 5. */
  maxPerQuery?: number
  /** Seed queries to plan. Default 5. */
  seedQueries?: number
  /** Verify claims at or below this confidence by re-searching. Default 'medium'. */
  verifyAtOrBelow?: 'high' | 'medium' | 'low'
  /** Restrict to specific provider names (else auto-routed). */
  onlyProviders?: string[]
  /** Optional progress callback for UI/logging. */
  onProgress?: (msg: string) => void
}

async function readPages(
  hits: SearchHit[],
  limit: number,
  round: number,
  query: string,
): Promise<Evidence[]> {
  const top = hits.slice(0, limit)
  const read = await Promise.all(
    top.map(async (h): Promise<Evidence | null> => {
      const text = await fetchPageText(h.url)
      // Fall back to the snippet if the page couldn't be fetched/extracted.
      const body = text ?? h.content
      if (!body) return null
      return { url: h.url, title: h.title, text: body, query, round, source: h.source }
    }),
  )
  return read.filter((e): e is Evidence => e !== null)
}

const CONF_RANK = { low: 0, medium: 1, high: 2 } as const

/** Run the full iterative research loop for one objective. */
export async function runSearchAgent(
  objective: string,
  opts: SearchAgentOptions,
): Promise<SearchAgentResult> {
  const {
    llm,
    maxRounds = 3,
    readsPerRound = 4,
    maxPerQuery = 5,
    seedQueries = 5,
    verifyAtOrBelow = 'medium',
    onlyProviders,
    onProgress = () => {},
  } = opts

  const seen = new Set<string>()
  const evidence: Evidence[] = []
  const queryLog: string[] = []

  // ── Round 0: plan diverse seed queries ──────────────────────────────────
  const planRaw = await llm(planQueriesPrompt(objective, seedQueries), { json: true })
  let queries = safeParseJSON<{ queries: string[] }>(planRaw, { queries: [objective] }).queries
  if (!queries.length) queries = [objective]

  let round = 0
  for (; round < maxRounds; round++) {
    onProgress(`round ${round + 1}: searching ${queries.length} queries`)
    queryLog.push(...queries)

    const hits = await searchRound(queries, {
      objective,
      maxPerQuery,
      seen,
      only: onlyProviders,
    })
    onProgress(`round ${round + 1}: ${hits.length} fresh hits, reading top ${readsPerRound}`)

    // Read pages from this round's best hits (attribute to the first query for
    // logging; the controller doesn't depend on per-hit query precision).
    const read = await readPages(hits, readsPerRound, round, queries[0] ?? objective)
    evidence.push(...read)

    // ── Gap analysis: are we done? if not, what next? ─────────────────────
    const gapRaw = await llm(
      gapAnalysisPrompt(objective, evidence, queryLog, round, maxRounds),
      { json: true },
    )
    const gap = safeParseJSON<{ satisfied: boolean; gaps: string[]; nextQueries: string[] }>(
      gapRaw,
      { satisfied: true, gaps: [], nextQueries: [] },
    )

    if (gap.satisfied || round === maxRounds - 1) break
    // De-dupe against everything we've already run.
    const ran = new Set(queryLog.map((q) => q.toLowerCase().trim()))
    queries = (gap.nextQueries ?? []).filter((q) => q && !ran.has(q.toLowerCase().trim()))
    if (!queries.length) break // nothing new to ask → stop early
  }

  // ── Claim extraction ───────────────────────────────────────────────────
  onProgress('extracting claims')
  const claimsRaw = await llm(extractClaimsPrompt(objective, evidence), { json: true })
  const claims = safeParseJSON<{ claims: Claim[] }>(claimsRaw, { claims: [] }).claims

  // ── Verify shaky claims by re-searching ───────────────────────────────
  const threshold = CONF_RANK[verifyAtOrBelow]
  const shaky = claims.filter((c) => CONF_RANK[c.confidence] <= threshold)
  onProgress(`verifying ${shaky.length} shaky claims`)
  for (const claim of shaky) {
    const vHits = await searchRound([claim.statement], {
      objective: claim.statement,
      maxPerQuery: 3,
      seen,
      only: onlyProviders,
    })
    const vEvidence = await readPages(vHits, 2, round, claim.statement)
    evidence.push(...vEvidence)
    const verdictRaw = await llm(verifyClaimPrompt(claim, vEvidence), { json: true })
    const verdict = safeParseJSON<{ verdict: string; reason: string; sources: string[] }>(
      verdictRaw,
      { verdict: 'unclear', reason: '', sources: [] },
    )
    if (verdict.verdict === 'supported') claim.confidence = 'high'
    if (verdict.verdict === 'refuted') claim.statement = `[REFUTED] ${claim.statement}`
    if (verdict.sources?.length) claim.sources = Array.from(new Set([...claim.sources, ...verdict.sources]))
  }

  // ── Synthesize the cited report ────────────────────────────────────────
  onProgress('synthesizing report')
  const report = await llm(synthesizePrompt(objective, evidence, claims))

  return { objective, report, evidence, claims, queryLog, rounds: round + 1 }
}