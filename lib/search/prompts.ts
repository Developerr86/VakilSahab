// LLM prompts that drive the agentic loop. These are the "brain" — the loop is
// only as deep as these prompts make it. Tune freely for your domain.
//
// Every prompt asks for STRICT JSON so the controller can parse without an LLM
// round-trip. Pair with a tolerant JSON extractor (see safeParseJSON in agent.ts).

import type { Evidence, Claim } from './types'

/** Round 0: decompose the objective into diverse search angles. */
export function planQueriesPrompt(objective: string, count = 5): string {
  return `You are a research strategist. Break the objective into ${count} diverse web search queries that together give BROAD coverage — vary the angle (definition, competitors/alternatives, technical how-to, opinions/reviews, recent news). Use search operators (site:, quotes, minus) where helpful. Avoid near-duplicates.

OBJECTIVE: ${objective}

Return STRICT JSON only:
{"queries": ["query 1", "query 2", ...]}`
}

/** After each round: decide whether coverage is sufficient, and if not, what to
 * search next. This is the engine of depth — it turns one pass into many. */
export function gapAnalysisPrompt(
  objective: string,
  evidence: Evidence[],
  queryLog: string[],
  round: number,
  maxRounds: number,
): string {
  const digest = evidence
    .map((e, i) => `[${i + 1}] ${e.title} (${e.url})\n${e.text.slice(0, 500)}`)
    .join('\n\n')
  return `You are auditing research coverage for an objective. Decide if the evidence is SUFFICIENT to answer thoroughly. If not, propose NEW follow-up queries that target the specific gaps, contradictions, or unverified claims you see. Do NOT repeat queries already run.

OBJECTIVE: ${objective}

QUERIES ALREADY RUN:
${queryLog.map((q) => `- ${q}`).join('\n')}

EVIDENCE GATHERED SO FAR:
${digest || '(none yet)'}

This is round ${round + 1} of at most ${maxRounds}.

Return STRICT JSON only:
{"satisfied": boolean, "gaps": ["short description of each gap"], "nextQueries": ["follow-up query", ...]}
If satisfied is true, nextQueries may be empty.`
}

/** Extract atomic claims with their supporting sources and a confidence flag.
 * Low/medium-confidence claims get re-searched and verified before synthesis. */
export function extractClaimsPrompt(objective: string, evidence: Evidence[]): string {
  const digest = evidence
    .map((e, i) => `[${i + 1}] ${e.url}\n${e.text.slice(0, 600)}`)
    .join('\n\n')
  return `Extract the key factual claims relevant to the objective from the evidence below. For each claim, list the source URLs that support it and rate how well-supported it is.

OBJECTIVE: ${objective}

EVIDENCE:
${digest}

Return STRICT JSON only:
{"claims": [{"statement": "...", "sources": ["url", ...], "confidence": "high|medium|low"}]}`
}

/** Verify a single shaky claim against freshly fetched evidence. */
export function verifyClaimPrompt(claim: Claim, freshEvidence: Evidence[]): string {
  const digest = freshEvidence
    .map((e, i) => `[${i + 1}] ${e.url}\n${e.text.slice(0, 600)}`)
    .join('\n\n')
  return `Adversarially fact-check the CLAIM using only the fresh evidence. Default to "refuted" or "unclear" if support is weak — do not be charitable.

CLAIM: ${claim.statement}

FRESH EVIDENCE:
${digest || '(no new evidence found)'}

Return STRICT JSON only:
{"verdict": "supported|refuted|unclear", "reason": "one sentence", "sources": ["url", ...]}`
}

/** Final synthesis into a cited report. */
export function synthesizePrompt(objective: string, evidence: Evidence[], claims: Claim[]): string {
  const digest = evidence
    .map((e, i) => `[${i + 1}] ${e.title} — ${e.url}\n${e.text.slice(0, 800)}`)
    .join('\n\n')
  const claimList = claims
    .map((c) => `- (${c.confidence}) ${c.statement} [${c.sources.join(', ')}]`)
    .join('\n')
  return `Write a thorough, well-structured answer to the objective using ONLY the evidence below. Cite sources inline as [n] referencing the numbered evidence. Note disagreements between sources explicitly. Do not invent facts not present in the evidence.

OBJECTIVE: ${objective}

VERIFIED CLAIMS:
${claimList || '(none)'}

EVIDENCE:
${digest}

Write the answer in Markdown with a short "Sources" list at the end mapping [n] to URLs.`
}