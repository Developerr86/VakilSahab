import { NextRequest } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/lib/supabase";
import { searchConstitution, searchWeb, TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { SYSTEM_PROMPT } from "@/lib/agent/prompts";

// NVIDIA NIM is OpenAI-compatible — use the OpenAI SDK against its base URL.
const nim = new OpenAI({
  apiKey:  process.env.NVIDIA_NIM_API_KEY!,
  baseURL: process.env.NVIDIA_NIM_BASE_URL!,
});

export async function POST(req: NextRequest) {
  const { messages, sessionId } = await req.json();
  // messages: { role: 'user' | 'assistant', content: string }[]
  // sessionId: string | null (null = new session)

  const supabase = createClient();

  // Create or retrieve session
  let sid = sessionId;
  if (!sid) {
    const { data } = await supabase
      .from("sessions")
      .insert({ messages: [] })
      .select("id")
      .single();
    sid = data?.id;
  }

  // Agentic loop with tool use. The LLM runs, may emit tool_calls, we execute
  // them, feed the results back as role:"tool" messages, and repeat until the
  // model answers with plain text (no tool calls).
  let currentMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];
  const citedSources: { full_ref?: string; url?: string; title?: string }[] = [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Agent loop. Each iteration the model may call tools; we run them, feed
      // results back, and repeat. Two guardrails keep it from searching forever:
      //   1. A hard iteration cap, and on the FINAL iteration we force
      //      tool_choice:"none" so the model must answer with text.
      //   2. Duplicate-search suppression — the same tool+args won't run twice;
      //      we tell the model it already has those results and to conclude.
      const MAX_ITERATIONS = 4;
      const toolCallCache = new Map<string, string>();
      let answered = false;

      const streamText = (text: string) => {
        const words = text.split(" ");
        return (async () => {
          for (const word of words) {
            send({ type: "text", delta: word + " " });
            await new Promise((r) => setTimeout(r, 10)); // chunked for UX
          }
        })();
      };

      try {
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
          const lastIteration = iteration === MAX_ITERATIONS - 1;
          const response = await nim.chat.completions.create({
            model:           process.env.NVIDIA_NIM_MODEL!,
            max_tokens:      1024,
            reasoning_effort: "low",
            tools:           TOOL_DEFINITIONS as any,
            tool_choice:     lastIteration ? "none" : "auto",
            messages:        currentMessages,
          } as any);

          const choice = response.choices[0];
          const msg    = choice?.message;
          const toolCalls = msg?.tool_calls ?? [];

          // No tool calls → stream the final text response and finish.
          if (toolCalls.length === 0) {
            await streamText(msg?.content ?? "");
            send({ type: "sources", sources: citedSources });
            send({ type: "session", sessionId: sid });
            send({ type: "done" });
            answered = true;
            break;
          }

          // Record the assistant turn (with its tool_calls) before the results.
          currentMessages.push({
            role:       "assistant",
            content:    msg?.content ?? "",
            tool_calls: toolCalls,
          });

          // Execute each tool call and append a role:"tool" result message.
          for (const tc of toolCalls) {
            if (tc.type !== "function") continue;
            const name = tc.function.name;
            send({ type: "tool_call", tool: name });

            // Suppress repeat searches: same tool + same args → don't re-run.
            const cacheKey = `${name}:${tc.function.arguments}`;
            if (toolCallCache.has(cacheKey)) {
              currentMessages.push({
                role:         "tool",
                tool_call_id: tc.id,
                content:      "You already ran this exact search — the results are above. Do not repeat it; synthesize your answer from what you have.",
              });
              continue;
            }

            let result: string;
            try {
              const input = JSON.parse(tc.function.arguments || "{}");

              if (name === "search_constitution") {
                const results = await searchConstitution(input.query, input.filter_tags);
                results.forEach((r) => citedSources.push({ full_ref: r.full_ref }));
                result = results.length === 0
                  ? "No relevant constitutional provisions found."
                  : results.map((r) =>
                      `[${r.full_ref}]\n${r.heading}\n${r.content.slice(0, 250)}...`
                    ).join("\n\n");

              } else if (name === "search_web") {
                const results = await searchWeb(input.query);
                results.forEach((r) => citedSources.push({ url: r.url, title: r.title }));
                result = results.length === 0
                  ? "No relevant cases found."
                  : results.map((r) =>
                      `[${r.title}]\n${r.snippet}\nSource: ${r.url}`
                    ).join("\n\n");

              } else {
                result = `Unknown tool: ${name}`;
              }
            } catch (e) {
              result = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
            }

            toolCallCache.set(cacheKey, result);
            currentMessages.push({
              role:         "tool",
              tool_call_id: tc.id,
              content:      result,
            });
          }
        }

        // Safety net: if the loop ended while still mid-tool-use (model never
        // produced a plain-text turn), make one final call to force an answer.
        if (!answered) {
          const final = await nim.chat.completions.create({
            model:            process.env.NVIDIA_NIM_MODEL!,
            max_tokens:       1024,
            reasoning_effort: "low",
            tool_choice:      "none",
            messages:         currentMessages,
          } as any);
          await streamText(final.choices[0]?.message?.content ?? "");
          send({ type: "sources", sources: citedSources });
          send({ type: "session", sessionId: sid });
          send({ type: "done" });
        }

        // Persist conversation (minus the system prompt) to the session.
        await supabase
          .from("sessions")
          .update({ messages: currentMessages.filter((m) => m.role !== "system") })
          .eq("id", sid);

      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "Unknown error" });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Session-Id":  sid ?? "",
    },
  });
}
