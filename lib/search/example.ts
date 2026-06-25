// End-to-end usage example. Shows the ONE thing you must wire up: an `llm`
// function. Everything else is keyless and works out of the box.
//
// Run: npx tsx example.ts  (Node 18+ for global fetch)

import { runSearchAgent } from './index'
import type { LLM } from './types'

// ── Wire your LLM here ─────────────────────────────────────────────────────
// Any provider works — it just needs to take a prompt and return text.
// Example with an OpenAI-compatible endpoint (OpenAI, Groq, Together, Ollama…):
const llm: LLM = async (prompt, opts) => {
  const res = await fetch(`${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      ...(opts?.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// For Anthropic, swap the body to the Messages API and return
// data.content[0].text. The agent only cares about (prompt) -> string.

async function main() {
  const result = await runSearchAgent(
    'What are the best open-source alternatives to Notion for self-hosting, and their trade-offs?',
    {
      llm,
      maxRounds: 3,
      readsPerRound: 4,
      onProgress: (m) => console.log('•', m),
    },
  )

  console.log('\n===== REPORT =====\n')
  console.log(result.report)
  console.log(`\n(${result.rounds} rounds, ${result.evidence.length} sources, ${result.queryLog.length} queries)`)
}

main().catch(console.error)