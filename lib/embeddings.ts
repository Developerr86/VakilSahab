import OpenAI from "openai";

// NVIDIA NIM (OpenAI-compatible) — embeddings only.
// Must match the model used by the ETL (etl/constitution/embed.py) so that
// query vectors live in the same space as the stored passage vectors.
const embeddingClient = new OpenAI({
  apiKey:  process.env.NVIDIA_NIM_API_KEY,
  baseURL: process.env.NVIDIA_NIM_BASE_URL,
});

const EMBED_MODEL = process.env.NVIDIA_NIM_EMBED_MODEL ?? "nvidia/nv-embedqa-e5-v5";

export async function embed(text: string): Promise<number[]> {
  const res = await embeddingClient.embeddings.create({
    model: EMBED_MODEL,
    input: text,
    // nv-embedqa is asymmetric: queries are encoded with input_type "query"
    // (documents were indexed with "passage" by the ETL).
    input_type: "query",
    truncate: "END",
  } as any);
  return res.data[0].embedding;
}
