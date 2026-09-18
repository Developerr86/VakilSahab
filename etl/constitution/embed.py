"""
Embeds Constitution nodes and upserts to Supabase statute_nodes.
Uses NVIDIA NIM nvidia/nv-embedqa-e5-v5 (1024-dim, OpenAI-compatible API).
Stored vectors use input_type="passage"; the app embeds queries with
input_type="query" against the same model (asymmetric retrieval).
Embeds: heading + content together for richer semantic signal.
Upserts by full_ref — safe to re-run.
"""
import json, os, time
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client
from tqdm import tqdm

load_dotenv()

NODES_PATH  = Path("parsed/nodes.json")
BATCH_SIZE  = 50
EMBED_MODEL = os.environ.get("NVIDIA_NIM_EMBED_MODEL", "nvidia/nemotron-3-embed-1b")
EMBED_DIM   = 2048
MIN_CHARS   = 40

# OpenAI SDK pointed at the NIM OpenAI-compatible endpoint.
oai = OpenAI(
    api_key=os.environ["NVIDIA_NIM_API_KEY"],
    base_url=os.environ.get("NVIDIA_NIM_BASE_URL", "https://integrate.api.nvidia.com/v1"),
)
sb  = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def embed_batch(texts: list[str]) -> list[list[float]]:
    for attempt in range(3):
        try:
            # nv-embedqa requires input_type; "passage" for indexed documents.
            r = oai.embeddings.create(
                model=EMBED_MODEL,
                input=texts,
                extra_body={"input_type": "passage", "truncate": "END"},
            )
            return [d.embedding for d in r.data]
        except Exception as e:
            if attempt == 2: raise
            print(f"Retry {attempt+1}: {e}")
            time.sleep(5)


def main():
    nodes = json.loads(NODES_PATH.read_text(encoding="utf-8"))
    embeddable = [n for n in nodes if len(n.get("content","")) >= MIN_CHARS]
    print(f"Embedding {len(embeddable)} nodes ({len(nodes)-len(embeddable)} skipped)")

    est_tokens = sum(len(f"{n['heading']} {n['content']}".split()) * 1.3 for n in embeddable)
    print(f"Model: {EMBED_MODEL} ({EMBED_DIM}-dim) via NVIDIA NIM | est. ~{est_tokens:,.0f} tokens")
    if input("Proceed? (y/n): ").lower() != "y":
        return

    ok, err = 0, 0
    for i in tqdm(range(0, len(embeddable), BATCH_SIZE)):
        batch = embeddable[i:i+BATCH_SIZE]
        texts = [f"{n['heading']}. {n['content']}" for n in batch]
        try:
            embeddings = embed_batch(texts)
            rows = [{
                "act":         n["act"],
                "part":        n.get("part"),
                "section_num": n.get("section_num"),
                "clause":      n.get("clause"),
                "heading":     n["heading"],
                "full_ref":    n["full_ref"],
                "content":     n["content"],
                "embedding":   emb,
                "tags":        n.get("tags", []),
            } for n, emb in zip(batch, embeddings)]
            sb.table("statute_nodes").upsert(rows, on_conflict="full_ref").execute()
            ok += len(batch)
        except Exception as e:
            print(f"\nBatch error: {e}")
            err += len(batch)
        time.sleep(0.1)

    print(f"\nDone. OK: {ok} | Errors: {err}")
    count = sb.table("statute_nodes").select("id", count="exact").eq("act","constitution").execute()
    print(f"Constitution nodes in DB: {count.count}")

if __name__ == "__main__":
    main()
