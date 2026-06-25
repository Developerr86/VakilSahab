// Core types for the free iterative search agent.
// Copy into your project (e.g. src/lib/search/types.ts) and adapt the import paths.

/** A single search result, normalized across every provider. */
export interface SearchHit {
  title: string
  url: string
  /** Snippet from the search engine, later augmented with extracted page text. */
  content: string
  /** Higher = more relevant. Set by the provider, overwritten by the reranker. */
  score?: number
  /** Which provider produced this hit — useful for diversity + debugging. */
  source?: string
}

/** Every search backend implements this. Keyless + zero-infra only. */
export interface SearchProvider {
  name: string
  search(query: string, maxResults?: number): Promise<SearchHit[]>
}

/** A piece of evidence the agent has actually read (not just a snippet). */
export interface Evidence {
  url: string
  title: string
  /** Extracted main-content text of the page. */
  text: string
  /** The query that surfaced this source. */
  query: string
  /** Which round of the loop found it. */
  round: number
  source?: string
}

/** Minimal LLM interface. Wire this to your own provider (OpenAI-compatible,
 * Anthropic, local, …). The agent only needs single-shot text completion. */
export type LLM = (prompt: string, opts?: { json?: boolean }) => Promise<string>

/** A claim extracted from evidence, with the sources that support it. */
export interface Claim {
  statement: string
  /** URLs of evidence that back this claim. */
  sources: string[]
  /** Agent's confidence before verification: 'high' | 'medium' | 'low'. */
  confidence: 'high' | 'medium' | 'low'
}

export interface SearchAgentResult {
  objective: string
  /** Final synthesized, cited answer. */
  report: string
  evidence: Evidence[]
  claims: Claim[]
  /** Every query the agent ran, in order, for transparency. */
  queryLog: string[]
  rounds: number
}