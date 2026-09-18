import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase";
import { initJobState } from "@/lib/agent/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Async chat entry point. Creates (or reuses) a session, enqueues a chat job,
// and returns immediately. The client then polls GET /api/jobs/[id]?work=1,
// which both drives the work in 60s-safe steps and reports live progress.
export async function POST(req: NextRequest) {
  const { messages, sessionId } = await req.json();
  // messages: { role: 'user' | 'assistant', content: string }[]
  // sessionId: string | null (null = new session)

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages required" }, { status: 400 });
  }

  const supabase = createClient();

  // Create or retrieve session
  let sid = sessionId;
  if (!sid) {
    const { data, error } = await supabase
      .from("sessions")
      .insert({ messages: [] })
      .select("id")
      .single();
    if (error) {
      return Response.json({ error: `session create failed: ${error.message}` }, { status: 500 });
    }
    sid = data?.id;
  }

  const { data: job, error } = await supabase
    .from("chat_jobs")
    .insert({
      session_id: sid,
      status:     "pending",
      stage:      "queued",
      state:      initJobState(messages),
    })
    .select("id")
    .single();

  if (error || !job) {
    return Response.json({ error: `job create failed: ${error?.message ?? "unknown"}` }, { status: 500 });
  }

  return Response.json({ jobId: job.id, sessionId: sid });
}
