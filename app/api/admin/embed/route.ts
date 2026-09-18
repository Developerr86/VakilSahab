import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// TEMPORARY one-off route to seed statute_nodes embeddings into the fresh
// Supabase project using the deployment's own NIM + Supabase env vars.
// Protected by ADMIN_EMBED_KEY. Remove after ETL completes.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const key = req.headers.get("x-admin-key");
  if (!process.env.ADMIN_EMBED_KEY || key !== process.env.ADMIN_EMBED_KEY) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (new URL(req.url).searchParams.get("list") === "1") {
    const b = process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
    const lr = await fetch(`${b}/models`, {
      headers: { Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}` },
    });
    const j: any = await lr.json().catch(() => ({}));
    const ids = ((j.data ?? []) as any[]).map((m) => m.id);
    return NextResponse.json({ status: lr.status, ids, embed: ids.filter((i) => /embed/i.test(i)), total: ids.length });
  }

  const probe = new URL(req.url).searchParams.get("chatprobe");
  if (probe) {
    const sp = new URL(req.url).searchParams;
    const b = process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
    const model = sp.get("model") ?? process.env.NVIDIA_NIM_MODEL ?? "deepseek-ai/deepseek-v4-flash-0731";
    const thinking = sp.get("thinking") !== "0";
    const mt = Math.min(Number(sp.get("mt") ?? 32) || 32, 800);
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55000);
    try {
      const payload: any = {
        model,
        max_tokens: mt,
        temperature: 0.3,
        top_p: 0.95,
        messages: [{ role: "user", content: "Say hello in one word." }],
      };
      if (/deepseek-v4/.test(model)) payload.extra_body = { chat_template_kwargs: { thinking } };
      const re = sp.get("re");
      if (re) payload.reasoning_effort = re;
      const cr = await fetch(`${b}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const ms = Date.now() - t0;
      const txt = await cr.text();
      let sample = "", rc = "", finish = "";
      try {
        const ch = JSON.parse(txt)?.choices?.[0];
        sample = String(ch?.message?.content ?? "").slice(0, 80);
        rc = String(ch?.message?.reasoning_content ?? "").slice(0, 80);
        finish = String(ch?.finish_reason ?? "");
      } catch {}
      return NextResponse.json({ status: cr.status, ms, model, thinking, mt, re: sp.get("re"), sample, rc, finish, raw: cr.status === 200 ? undefined : txt.slice(0, 240) });
    } catch (e: any) {
      clearTimeout(timer);
      return NextResponse.json({ ms: Date.now() - t0, model, thinking, mt, error: e?.name === "AbortError" ? "aborted>55s" : String(e) });
    }
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const nodes = body?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0 || nodes.length > 50) {
    return NextResponse.json({ error: "nodes must be an array of 1..50" }, { status: 400 });
  }

  const provider = new URL(req.url).searchParams.get("provider") ?? "nim";
  const base = provider === "openai"
    ? (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
    : (process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1");
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.NVIDIA_NIM_API_KEY;
  const model = new URL(req.url).searchParams.get("model")
    ?? (provider === "openai" ? "text-embedding-3-small" : (process.env.NVIDIA_NIM_EMBED_MODEL ?? "nvidia/nv-embedqa-e5-v5"));
  const texts = nodes.map((n: any) => `${n.heading}. ${n.content}`);
  const payload: any = { model, input: texts };
  if (provider !== "openai") { payload.input_type = "passage"; payload.truncate = "END"; }

  const r = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    return NextResponse.json({ error: `nim ${r.status}: ${t.slice(0, 500)}` }, { status: 502 });
  }
  const data = await r.json();
  const byIndex = new Map<number, number[]>();
  for (const d of data.data) byIndex.set(d.index, d.embedding);

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const rows = nodes.map((n: any, i: number) => ({
    act: n.act,
    part: n.part ?? null,
    section_num: n.section_num ?? null,
    clause: n.clause ?? null,
    heading: n.heading,
    full_ref: n.full_ref,
    content: n.content,
    embedding: byIndex.get(i),
    tags: n.tags ?? [],
  }));
  const { error } = await sb.from("statute_nodes").upsert(rows, { onConflict: "full_ref" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ embedded: rows.length });
}
