import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase";
import { runJobStep, claimJob, STALE_MS, MAX_ATTEMPTS, type JobRow } from "@/lib/agent/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NOCACHE = { "Cache-Control": "no-store, no-cache, must-revalidate", "CDN-Cache-Control": "no-store", "Vercel-CDN-Cache-Control": "no-store" } as const;

function snapshot(job: JobRow) {
  return {
    id:       job.id,
    status:   job.status,
    stage:    job.stage,
    partial:  job.partial,
    result:   job.result,
    error:    job.error,
    attempts: job.attempts,
  };
}

// GET /api/jobs/[id]?work=1&wait=25
// - work=1: if the job needs a worker (pending, or running with a stale
//   heartbeat = crashed worker), this request becomes the worker and runs one
//   time-budgeted step. Claims are atomic, so concurrent pollers can't
//   double-work a job.
// - wait=N: afterwards (or if another worker is active), long-poll up to N
//   seconds for a status change so the client gets progress promptly.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const jobId = params.id;
  const url = new URL(req.url);
  const work = url.searchParams.get("work") === "1";
  const waitSec = Math.min(25, Math.max(0, parseInt(url.searchParams.get("wait") ?? "0", 10) || 0));

  // Hard ceiling so this handler always returns inside the Hobby window.
  const handlerDeadline = Date.now() + 52_000;

  const supabase = createClient();
  const { data: loaded } = await supabase
    .from("chat_jobs").select("*").eq("id", jobId).single();
  if (!loaded) return Response.json({ error: "not found" }, { status: 404, headers: NOCACHE });
  let job = loaded as JobRow;

  if (work && (job.status === "pending" || job.status === "running")) {
    const claimed = await claimJob(supabase, job);
    if (claimed) {
      await runJobStep(supabase, claimed);
      const { data: fresh } = await supabase
        .from("chat_jobs").select("*").eq("id", jobId).single();
      if (fresh) job = fresh as JobRow;
    }
  }

  // Long-poll for a status change while the job is still active.
  const until = Math.min(Date.now() + waitSec * 1000, handlerDeadline);
  while ((job.status === "pending" || job.status === "running") && Date.now() < until) {
    await sleep(2_000);
    const { data: fresh } = await supabase
      .from("chat_jobs")
      .select("id,status,stage,partial,result,error,attempts,heartbeat")
      .eq("id", jobId).single();
    if (fresh) job = { ...job, ...(fresh as any) };
  }

  return Response.json(snapshot(job), { headers: NOCACHE });
}
