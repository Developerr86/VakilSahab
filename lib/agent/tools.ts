import { createClient } from "@/lib/supabase";
import { embed } from "@/lib/embeddings";
import { searchRound, fetchPageText } from "@/lib/search";

export interface ConstitutionResult {
  full_ref:   string;
  heading:    string;
  content:    string;
  tags:       string[];
  similarity: number;
}

// Tool 1: Constitution RAG
// Called by the agent when it needs to find relevant articles/clauses
export async function searchConstitution(
  query:      string,
  filterTags?: string[],
  matchCount   = 6
): Promise<ConstitutionResult[]> {
  const supabase        = createClient();
  const queryEmbedding  = await embed(query);

  const { data, error } = await supabase.rpc("search_constitution", {
    query_embedding: queryEmbedding,
    filter_tags:     filterTags ?? null,
    match_count:     matchCount,
  });

  if (error) throw new Error(`Constitution search failed: ${error.message}`);
  return (data ?? []) as ConstitutionResult[];
}

// Tool 2: Web search — ONE precise pass, not a deep-research loop.
//
// We run a single search round across the configured provider chain
// (Tavily/Bing/DDG per SEARCH_PROVIDER), read the top few result pages, and
// return them. There is deliberately no multi-round plan→gap→verify→synthesize
// cycle here: the calling LLM (route.ts) already decides whether to refine and
// search again. If this pass finds nothing, we return [] and the assistant
// reports "no relevant results" rather than searching indefinitely.
const WEB_READS = 4;          // top pages to fully read per call
const WEB_MAX_PER_QUERY = 6;  // results requested from the provider chain

export async function searchWeb(query: string): Promise<{
  title:   string;
  url:     string;
  snippet: string;
}[]> {
  const objective = `Indian court cases and legal precedents related to: ${query}`;
  const seen = new Set<string>();

  const hits = await searchRound([query], {
    objective,
    maxPerQuery: WEB_MAX_PER_QUERY,
    seen,
  });
  if (hits.length === 0) return []; // nothing relevant → caller says so

  // Read the top hits in parallel; fall back to the provider snippet if a page
  // can't be fetched/extracted.
  const top = hits.slice(0, WEB_READS);
  const pages = await Promise.all(
    top.map(async (h) => {
      let body = h.content ?? "";
      try {
        const text = await fetchPageText(h.url);
        if (text) body = text;
      } catch {
        /* keep the snippet */
      }
      return {
        title:   h.title,
        url:     h.url,
        snippet: body.slice(0, 300) + (body.length > 300 ? "..." : ""),
      };
    }),
  );

  return pages.filter((p) => p.snippet.trim().length > 0);
}

// Tool definitions for the LLM (OpenAI function-tool format — NIM is OpenAI-compatible)
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name:        "search_constitution",
      description: "Search the Indian Constitution for relevant articles, clauses, and provisions using semantic similarity. Use this when the case involves rights, state obligations, constitutional remedies, or any provision you want to verify from the Constitution text.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type:        "string",
            description: "Semantic search query — describe the legal concept or right you're looking for. E.g. 'right to property', 'freedom of speech restrictions', 'remedies for fundamental rights violation'",
          },
          filter_tags: {
            type:  "array",
            items: { type: "string" },
            description: "Optional tag filters to narrow search: fundamental_rights, property, contract, compensation, court, directive_principles, consumer, emergency, amendment",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name:        "search_web",
      description: "Search the web for recent Indian court cases and judgements relevant to the matter at hand. Use this to find how similar cases were handled in court, relevant High Court or Supreme Court decisions, and any recent legal developments. Always include 'India' and relevant legal terms in your query.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type:        "string",
            description: "Search query. Include court level if relevant. E.g. 'builder delay possession RERA Bombay High Court 2023', 'breach of contract specific performance India Supreme Court'",
          },
        },
        required: ["query"],
      },
    },
  },
];