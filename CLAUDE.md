# VakilSahab — Claude Code Instructions

## What this is
A chat-based legal research assistant for Indian advocates.
Single chat page. One streaming API route at /api/chat.
Two agent tools: search_web (free iterative search agent with keyless providers) and search_constitution (pgvector RAG).

## Stack
- Next.js 14 App Router, TypeScript, Tailwind
- Supabase: pgvector for Constitution RAG, Postgres for session persistence
- NVIDIA NIM API for LLM inference AND embeddings (OpenAI-compatible, base URL in env)
- Embeddings: NVIDIA NIM nvidia/nv-embedqa-e5-v5 (1024-dim); index with input_type=passage, query with input_type=query
- Vercel for deployment

## Hard rules
- All Supabase calls are server-side only. Never import the service role key into client components.
- Agent logic lives in lib/agent/ only. API route at app/api/chat/route.ts is thin — it calls the agent, streams the result, that's it.
- All prompts live in lib/agent/prompts.ts. No hardcoded prompt strings anywhere else.
- The search_web tool is implemented using the free iterative search agent with keyless providers (DuckDuckGo, Wikipedia, GitHub, Stack Exchange). No API keys or paid services required.
- ETL is Python-only in /etl/. Do not mix with Next.js source.
- No localStorage, no sessionStorage, no React class components.

## LLM client setup
Two clients, same OpenAI SDK, both pointed at NVIDIA NIM:
- Inference: baseURL = NVIDIA_NIM_BASE_URL, apiKey = NVIDIA_NIM_API_KEY, model = NVIDIA_NIM_MODEL
- Embeddings: baseURL = NVIDIA_NIM_BASE_URL, apiKey = NVIDIA_NIM_API_KEY, model = NVIDIA_NIM_EMBED_MODEL (nvidia/nv-embedqa-e5-v5, 1024-dim)

## Search Agent Integration
The `search_web` tool now uses a free iterative search agent with the following characteristics:

- **Keyless providers**: DuckDuckGo, Wikipedia, GitHub, Stack Exchange
- **Iterative loop**: Plan → Search → Read → Gap analysis × N rounds → Verify claims → Synthesize
- **Zero infrastructure**: No API keys, no card-on-file, no self-hosted services
- **Deep research**: Multiple rounds of searching, reading, and verification for comprehensive results
- **Cited evidence**: All sources are cited with URLs and relevance scores

The search agent is configured for legal research with:
- 3 search rounds by default
- 4 pages read per round
- Medium confidence threshold for claim verification
- Focus on Indian court cases and legal precedents

## Supabase MCP
Use to: run migrations in order, inspect schemas, verify ETL row counts.

## Vercel MCP  
Use to: set environment variables, trigger deployments, check logs.

## Do not build (V2 items, do not scope-creep)
- PDF or DOCX export
- Auth / user accounts  
- Multi-statute corpus beyond the Constitution
- Procedural rules table
- Static case law seeding