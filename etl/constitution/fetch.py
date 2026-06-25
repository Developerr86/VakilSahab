"""
Fetches the Indian Constitution as structured JSON.

NOTE: The official source (legislative.gov.in/constitution-of-india/) is now a
client-rendered JavaScript SPA — a static GET returns only a ~7 KB app shell with
no article text. We therefore pull the full Constitution from a complete,
public-domain, structured mirror instead:

    civictech-India/constitution-of-india  (constitution_of_india.json)
    465 entries: {article, title, description} covering Preamble + Articles 1-395
    incl. amendment articles (21A, 31A-D, 239AA, etc.)

Saves to etl/constitution/raw/coi.json
Re-run when a Constitutional Amendment is notified (source is community-maintained).
"""
import requests
from pathlib import Path

OUT = Path("raw")
OUT.mkdir(exist_ok=True)

HEADERS = {"User-Agent": "VakilSahab/1.0 (legal research tool)"}
URL = "https://raw.githubusercontent.com/civictech-India/constitution-of-india/main/constitution_of_india.json"


def main():
    print(f"Fetching from {URL} ...")
    r = requests.get(URL, headers=HEADERS, timeout=60)
    r.raise_for_status()
    out = OUT / "coi.json"
    out.write_text(r.text, encoding="utf-8")
    print(f"Saved {len(r.text):,} chars -> {out}")
    # Print a small sample so the structure can be inspected before parsing
    import json
    data = json.loads(r.text)
    print(f"\n--- {len(data)} entries; first entry: ---")
    print(json.dumps(data[0], ensure_ascii=False, indent=2)[:600])


if __name__ == "__main__":
    main()
