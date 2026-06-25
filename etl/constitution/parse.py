"""
Parses the Constitution JSON (raw/coi.json) into statute_nodes records.
Output: parsed/nodes.json

Source schema (civictech-India): list of {article, title, description}
  - article: int (0-395) or str ('21A', '239AA', ...); 0 == Preamble
  - title:   article heading
  - description: full article text

Output schema (consumed by embed.py): one node per article with a cite-ready full_ref.
Nodes with content < 40 chars are skipped (structural-only / stubs).
"""
import json, re
from pathlib import Path

RAW = Path("raw/coi.json")
OUT = Path("parsed/nodes.json")
OUT.parent.mkdir(exist_ok=True)

MIN_CONTENT = 40  # skip structural-only headings


def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', str(text)).strip()


def make_ref(article_num: str, clause: str = None) -> str:
    if str(article_num) == "0":
        return "Preamble, Constitution of India"
    base = f"Article {article_num}, Constitution of India"
    return f"Article {article_num}({clause}), Constitution of India" if clause else base


def infer_part(article_num) -> str:
    # Approximate — Constitution groupings by article number. Non-numeric
    # suffixes (21A, 239AA) inherit the part of their integer stem.
    m = re.match(r"\d+", str(article_num))
    if not m:
        return "Unknown"
    n = int(m.group())
    if n == 0:
        return "Preamble"
    for lo, hi, part in [
        (1,4,"I"),(5,11,"II"),(12,35,"III"),(36,51,"IV"),(52,151,"V"),
        (152,237,"VI"),(239,242,"VIII"),(243,243,"IX"),(244,244,"X"),
        (245,263,"XI"),(264,300,"XII"),(301,307,"XIII"),(308,323,"XIV"),
        (324,329,"XV"),(330,342,"XVI"),(343,351,"XVII"),(352,360,"XVIII"),
        (361,367,"XIX"),(368,368,"XX"),(369,395,"XXI"),
    ]:
        if lo <= n <= hi:
            return part
    return "Unknown"


def infer_tags(heading: str, content: str) -> list:
    text = f"{heading} {content}".lower()
    tags = []
    patterns = {
        "fundamental_rights": ["right to","freedom","liberty","equality","article 14",
                               "article 19","article 21","article 32"],
        "property":           ["property","immovable","transfer","possession"],
        "contract":           ["contract","agreement","obligation"],
        "compensation":       ["compensation","damages","remedy","relief"],
        "court":              ["court","tribunal","jurisdiction","judicial review"],
        "directive_principles":["directive","policy","welfare","state shall"],
        "consumer":           ["consumer","goods","services"],
        "emergency":          ["emergency","proclamation","president's rule"],
        "amendment":          ["amendment","parliament shall"],
    }
    for tag, kws in patterns.items():
        if any(k in text for k in kws):
            tags.append(tag)
    return tags


def parse(records: list) -> list:
    nodes, seen_refs = [], set()
    for rec in records:
        art = str(rec.get("article")).strip()
        heading = clean(rec.get("title") or f"Article {art}")
        content = clean(rec.get("description") or "")

        if len(content) < MIN_CONTENT:
            continue

        full_ref = make_ref(art)
        if full_ref in seen_refs:        # guard against any source dupes
            continue
        seen_refs.add(full_ref)

        nodes.append({
            "act":         "constitution",
            "part":        infer_part(art),
            "section_num": art if art != "0" else None,
            "clause":      None,
            "heading":     heading,
            "full_ref":    full_ref,
            "content":     content[:2000],
            "tags":        infer_tags(heading, content),
        })

    print(f"Parsed {len(nodes)} nodes")
    return nodes


def main():
    records = json.loads(RAW.read_text(encoding="utf-8"))
    nodes = parse(records)
    OUT.write_text(json.dumps(nodes, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Written -> {OUT}")
    for n in nodes[:3]:
        print(f"  {n['full_ref']}: {n['heading'][:60]}")

if __name__ == "__main__":
    main()
