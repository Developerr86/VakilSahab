// Public barrel for the free iterative search agent.
// Import this in your Next.js route, CLI, or agent tool.

export { runSearchAgent } from './agent'
export type { SearchAgentResult, SearchHit, Evidence, Claim, LLM, SearchProvider } from './types'
export { pickProviders } from './providers'
export { searchRound } from './search'
export { fetchPageText } from './http'
export { dedupNew, rerank } from './rerank'

export { planQueriesPrompt, gapAnalysisPrompt, extractClaimsPrompt, verifyClaimPrompt, synthesizePrompt } from './prompts'

export { duckDuckGoProvider, wikipediaProvider, githubProvider, stackExchangeProvider } from './providers'

// Example usage for Next.js route handlers, CLI commands, or agent tools:
// import { runSearchAgent } from '@/lib/search'
// import type { LLM } from '@/lib/search'
//
// // Wire your LLM here (e.g., Anthropic client, OpenAI-compatible, local Ollama)
// const llm: LLM = async (prompt, opts) => {
//   // Your LLM implementation here
//   // For example, with Anthropic:
//   // const res = await anthropic.messages.create({ model, max_tokens: 4096, system, messages: [{ role: 'user', content: prompt }] })
//   // return res.content[0].text
//   throw new Error('LLM not implemented')
// }
//
// // In your API route:
// export async function GET() {
//   const result = await runSearchAgent('What are the best open-source alternatives to Notion for self-hosting?', {
//     llm,
//     maxRounds: 3,
//     readsPerRound: 4,
//     onProgress: (msg) => console.log('•', msg),
//   })
//   return Response.json(result)
// }