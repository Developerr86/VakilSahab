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

  const base = process.env.NVIDIA_NIM_BASE_URL ?? "https://integrate.api.nvidia.com/v1";
  const model = new URL(req.url).searchParams.get("model") ?? process.env.NVIDIA_NIM_EMBED_MODEL ?? "nvidia/nv-embedqa-e5-v5";
  const texts = nodes.map((n: any) => `${n.heading}. ${n.content}`);

  const r = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_NIM_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: texts, input_type: "passage", truncate: "END" }),
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
