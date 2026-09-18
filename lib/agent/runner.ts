import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchConstitution, searchWeb, TOOL_DEFINITIONS } from "@/lib/agent/tools";
import { SYSTEM_PROMPT } from "@/lib/agent/prompts";

// Async job runner. The agentic loop from the old synchronous /api/chat route,
// restructured so work happens in steps that fit inside one Vercel Hobby
// invocation (60s). Loop state lives in the chat_jobs row between steps, so a
// step that runs out of time persists and the next worker resumes it.

const nim = new OpenAI({
  apiKey:  process.env.NVIDIA_NIM_API_KEY!,
  baseURL: process.env.NVIDIA_NIM_BASE_URL!,
});

export const STEP_BUDGET_MS = 42_000; // work budget per invocation step
export const STALE_MS       = 90_000; // running job w/o heartbeat is reclaimable
export const MAX_ATTEMPTS   = 6;      // consecutive crashed/errored worker runs before failed

const MAX_ITERATIONS = 4;
const HEARTBEAT_MS   = 3_000;
const MAX_TOKENS     = 4096;

export interface CitedSource { full_ref?: string; url?: string; title?: string }

export interface JobState {
  // Full conversation for the agent loop: system prompt + client history +
  // assistant/tool turns produced so far.
  messages:      OpenAI.Chat.ChatCompletionMessageParam[];
  iteration:     number;
  forceFinal:    boolean;
  toolCache:     Record<string, string>;
  citedSources:  CitedSource[];
}

export interface JobRow {
  id:         string;
  session_id: string;
  status:     "pending" | "running" | "done" | "failed";
  stage:      string | null;
  partial:    string;
  state:      any;
  result:     { content: string; sources: CitedSource[] } | null;
  error:      string | null;
  attempts:   number;
  heartbeat:  string;
}

export type StepOutcome = "done" | "failed" | "continuing";

type DB = SupabaseClient<any, any, any>;

async function save(supabase: DB, jobId: string, patch: Record<string, any>) {
  await supabase.from("chat_jobs").update(patch).eq("id", jobId);
}

function freshState(baseMessages: { role: string; content: string }[]): JobState {
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...baseMessages.map((m) => ({ role: m.role, content: m.content })),
    ] as OpenAI.Chat.ChatCompletionMessageParam[],
    iteration:    0,
    forceFinal:   false,
    toolCache:    {},
    citedSources: [],
  };
}

export function initJobState(baseMessages: { role: string; content: string }[]): JobState {
  return freshState(baseMessages);
}

// One streaming chat completion with a hard abort at `deadline`.
// Accumulates final text and streamed tool calls; reports throttled partials.
async function callModelStreaming(opts: {
  messages:   OpenAI.Chat.ChatCompletionMessageParam[];
  toolChoice: "auto" | "none";
  deadline:   number;
  onPartial:  (text: string) => Promise<void>;
}): Promise<{ content: string; toolCalls: any[] }> {
  const controller = new AbortController();
  const msLeft = Math.max(5_000, opts.deadline - Date.now());
  const timer = setTimeout(() => controller.abort(), msLeft);
  try {
    const stream = await nim.chat.completions.create(
      {
        model:            process.env.NVIDIA_NIM_MODEL!,
        max_tokens:       MAX_TOKENS,
        reasoning_effort: "low",
        tools:            opts.toolChoice === "none" ? undefined : (TOOL_DEFINITIONS as any),
        tool_choice:      opts.toolChoice,
        messages:         opts.messages,
        stream:           true,
      } as any,
      { signal: controller.signal } as any,
    );

    let content = "";
    const byIndex: Record<number, { id?: string; type?: string; function: { name?: string; arguments: string } }> = {};

    for await (const chunk of stream as any) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        content += delta.content;
        await opts.onPartial(content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          byIndex[i] ??= { function: { arguments: "" } };
          const acc = byIndex[i];
          if (tc.id)                acc.id = tc.id;
          if (tc.type)              acc.type = tc.type;
          if (tc.function?.name)    acc.function.name = tc.function.name;
          if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
        }
      }
    }

    const toolCalls = Object.keys(byIndex)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => ({ type: "function", ...byIndex[i] }));
    return { content, toolCalls };
  } finally {
    clearTimeout(timer);
  }
}

// Run the job until it finishes or the step budget runs out.
// On "continuing" the row is left status=pending with saved state so the next
// poll picks it up immediately.
export async function runJobStep(supabase: DB, job: JobRow): Promise<StepOutcome> {
  const deadline = Date.now() + STEP_BUDGET_MS;
  const state: JobState = job.state?.messages ? job.state : null;
  if (!state) {
    await save(supabase, job.id, { status: "failed", error: "Corrupt job state" });
    return "failed";
  }

  let lastBeat = 0;
  const beat = async (patch: Record<string, any>) => {
    const now = Date.now();
    if (now - lastBeat >= HEARTBEAT_MS) {
      lastBeat = now;
      await save(supabase, job.id, { heartbeat: new Date().toISOString(), ...patch });
    }
  };

  const finish = async (content: string) => {
    const result = { content, sources: state.citedSources };
    state.messages.push({ role: "assistant", content });
    await save(supabase, job.id, {
      status: "done",
      stage:  "done",
      result,
      partial: content,
      state,
      heartbeat: new Date().toISOString(),
    });
    // Persist the conversation to the session, same shape as the old route.
    await supabase
      .from("sessions")
      .update({ messages: state.messages.filter((m: any) => m.role !== "system") })
      .eq("id", job.session_id);
    return "done" as const;
  };

  const pause = async (stage: string) => {
    await save(supabase, job.id, {
      status: "pending", // hand back to the next worker
      stage,
      state,
      heartbeat: new Date().toISOString(),
    });
    return "continuing" as const;
  };

  const failOrRetry = async (message: string) => {
    const attempts = job.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await save(supabase, job.id, { status: "failed", error: message, attempts, stage: null });
      return "failed" as const;
    }
    await save(supabase, job.id, {
      status: "pending",
      stage:  "thinking",
      error:  message,
      attempts,
      state,
      heartbeat: new Date().toISOString(),
    });
    return "continuing" as const;
  };

  try {
    // Forced-answer pass requested by an earlier step.
    if (state.forceFinal) {
      const { content } = await callModelStreaming({
        messages:   state.messages,
        toolChoice: "none",
        deadline,
        onPartial:  (text) => beat({ stage: "writing", partial: text }),
      });
      return await finish(content);
    }

    for (let iteration = state.iteration; iteration < MAX_ITERATIONS; iteration++) {
      const lastIteration = iteration === MAX_ITERATIONS - 1;
      await save(supabase, job.id, { stage: "thinking", heartbeat: new Date().toISOString() });

      const { content, toolCalls } = await callModelStreaming({
        messages:   state.messages,
        toolChoice: lastIteration ? "none" : "auto",
        deadline,
        onPartial:  (text) => beat({ stage: "writing", partial: text }),
      });

      // Plain-text answer â done.
      if (toolCalls.length === 0) {
        return await finish(content);
      }

      // Record the assistant turn (with its tool calls) before the results.
      state.messages.push({ role: "assistant", content: content ?? "", tool_calls: toolCalls } as any);

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        const name: string = tc.function.name;
        await save(supabase, job.id, { stage: name, heartbeat: new Date().toISOString() });

        // Suppress repeat searches: same tool + same args â don't re-run.
        const cacheKey = `${name}:${tc.function.arguments}`;
        if (state.toolCache[cacheKey]) {
          state.messages.push({
            role:         "tool",
            tool_call_id: tc.id,
            content:      "You already ran this exact search â the results are above. Do not repeat it; synthesize your answer from what you have.",
          } as any);
          continue;
        }

        // Out of step budget mid-tools: persist and let the next step redo
        // this iteration's tool calls is not possible (the assistant turn is
        // already recorded), so persist state including completed tool
        // results and continue with remaining calls next step.
        let result: string;
        try {
          const input = JSON.parse(tc.function.arguments || "{}");
          if (name === "search_constitution") {
            const results = await searchConstitution(input.query, input.filter_tags);
            results.forEach((r) => state.citedSources.push({ full_ref: r.full_ref }));
            result = results.length === 0
              ? "No relevant constitutional provisions found."
              : results.map((r) => `[${r.full_ref}]\n${r.heading}\n${r.content.slice(0, 250)}...`).join("\n\n");
          } else if (name === "search_web") {
            const results = await searchWeb(input.query);
            results.forEach((r) => state.citedSources.push({ url: r.url, title: r.title }));
            result = results.length === 0
              ? "No relevant cases found."
              : results.map((r) => `[${r.title}]\n${r.snippet}\nSource: ${r.url}`).join("\n\n");
          } else {
            result = `Unknown tool: ${name}`;
          }
        } catch (e) {
          result = `Tool error: ${e instanceof Error ? e.message : String(e)}`;
        }

        state.toolCache[cacheKey] = result;
        state.messages.push({ role: "tool", tool_call_id: tc.id, content: result } as any);

        if (Date.now() > deadline - 2_000) {
          state.iteration = iteration + 1;
          return await pause(name);
        }
      }

      state.iteration = iteration + 1;
      await save(supabase, job.id, { state, heartbeat: new Date().toISOString() });

      if (Date.now() > deadline - 2_000) {
        return await pause("thinking");
      }
    }

    // Iteration cap reached mid-tool-use: force a final plain-text answer.
    state.forceFinal = true;
    if (Date.now() > deadline - 5_000) {
      return await pause("writing");
    }
    await save(supabase, job.id, { stage: "writing", heartbeat: new Date().toISOString() });
    const { content } = await callModelStreaming({
      messages:   state.messages,
      toolChoice: "none",
      deadline,
      onPartial:  (text) => beat({ stage: "writing", partial: text }),
    });
    return await finish(content);
  } catch (e: any) {
    // Our own budget abort (or simply out of time): persist and resume later.
    const outOfTime = Date.now() >= deadline - 1_000;
    if (e?.name === "AbortError" || outOfTime || /aborted/i.test(String(e?.message))) {
      return await pause("thinking");
    }
    return await failOrRetry(e instanceof Error ? e.message : String(e));
  }
}

// Atomically claim a job that needs a worker. Returns null when another
// worker already holds it. A pending claim is free; reclaiming a crashed
// worker (stale heartbeat) counts against the attempts budget.
export async function claimJob(supabase: DB, job: JobRow): Promise<JobRow | null> {
  const now = new Date().toISOString();

  if (job.status === "pending") {
    const { data } = await supabase
      .from("chat_jobs")
      .update({ status: "running", heartbeat: now })
      .eq("id", job.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();
    if (data) return data as JobRow;
  }

  // Reclaim a crashed worker (running but heartbeat stale).
  if (job.attempts + 1 > MAX_ATTEMPTS) {
    await supabase
      .from("chat_jobs")
      .update({ status: "failed", error: "The request kept failing. Please try again.", stage: null })
      .eq("id", job.id)
      .eq("status", "running");
    return null;
  }
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data } = await supabase
    .from("chat_jobs")
    .update({ status: "running", heartbeat: now, attempts: job.attempts + 1 })
    .eq("id", job.id)
    .eq("status", "running")
    .lt("heartbeat", staleBefore)
    .select()
    .maybeSingle();
  return (data as JobRow) ?? null;
}
