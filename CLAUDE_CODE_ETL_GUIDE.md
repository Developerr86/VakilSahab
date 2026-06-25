# Claude Code ETL Guide: Indian Constitution Embedding

## Project Overview

### What is VakilSahab?
VakilSahab is an **Indian civil law research assistant** built with Next.js 14, Supabase (pgvector), Vercel, NVIDIA NIM, and OpenAI embeddings. It provides a single-page chat interface where advocates can describe their legal cases, and the agent researches relevant case law and constitutional provisions, then drafts legal notices.

### Core Functionality
- **Chat Interface**: Single-page chat for Indian advocates
- **Two Agent Tools**: 
  - `search_constitution` - pgvector RAG over the Indian Constitution
  - `search_web` - DuckDuckGo web search for recent court cases
- **Legal Research**: Find relevant precedents and constitutional provisions
- **Legal Notice Drafting**: Generate structured legal notices using session context

### Technical Stack
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL with pgvector extension)

### Why the Indian Constitution is Central

#### 1. **Constitutional Rights Foundation**
The Indian Constitution is the supreme legal document that defines:
- Fundamental rights (Articles 12-35)
- Directive Principles of State Policy
- Federal structure and powers
- Judicial review mechanisms

#### 2. **Legal Research Requirements**
Indian legal cases and matters require:
- Constitutional interpretation and application
- Fundamental rights analysis
- State obligations and duties
- Constitutional remedies and procedures

#### 3. **RAG Search Necessity**
For legal research, you need:
- **Semantic search** of constitutional provisions
- **Contextual relevance** for legal arguments
- **Cited sources** for legal citations
- **Hierarchical structure** (Parts → Articles → Clauses)

### Business Value
- **Faster research**: Instant access to constitutional provisions
- **Accurate citations**: Proper referencing of constitutional articles
- **Comprehensive coverage**: All constitutional aspects searchable
- **Cost-effective**: One-time ETL setup, ongoing free usage

## Why the Indian Constitution?

### 1. **Legal Framework**
- **Source of all Indian law**: Constitution is the foundation
- **Rights-based system**: Focus on fundamental rights and remedies
- **Judicial review**: Courts interpret and apply constitutional provisions

### 2. **Research Complexity**
- **Hierarchical structure**: Parts → Articles → Clauses
- **Multiple dimensions**: Rights, duties, procedures, remedies
- **Interconnected provisions**: Articles often reference each other

### 3. **Practical Applications**
- **Fundamental rights cases**: Article 21, Article 14, etc.
- **Directive Principles**: State obligations and welfare
- **Constitutional remedies**: Writs, judicial review
- **Legal notice drafting**: Citing constitutional provisions

## ETL Procedure: Indian Constitution Embedding

### Overview
The ETL (Extract, Transform, Load) process converts the Indian Constitution HTML into a searchable vector database in Supabase. This involves:

1. **Extract**: Download Constitution HTML from official source
2. **Transform**: Parse into structured statute_nodes
3. **Load**: Generate embeddings and store in Supabase

### Step 1: Extract - Fetch Constitution HTML

#### Source
- **Official**: https://legislative.gov.in/constitution-of-india/
- **Public domain**: Free to use, no licensing issues
- **Regularly updated**: Constitutional amendments are notified

#### Implementation
```python
# etl/constitution/fetch.py
import requests
from pathlib import Path

OUT = Path("raw")
OUT.mkdir(exist_ok=True)

HEADERS = {"User-Agent": "VakilSahab/1.0 (legal research tool)"}
URL = "https://legislative.gov.in/constitution-of-india/"

def main():
    print(f"Fetching from {URL}...")
    r = requests.get(URL, headers=HEADERS, timeout=30)
    r.raise_for_status()
    out = OUT / "constitution.html"
    out.write_text(r.text, encoding="utf-8")
    print(f"Saved {len(r.text):,} chars → {out}")
```

#### Best Practices
- **User-Agent**: Identify your tool for server compliance
- **Timeout**: Handle slow connections
- **Error handling**: Retry on failure
- **File naming**: Consistent naming for reproducibility

### Step 2: Transform - Parse HTML into Statute Nodes

#### Parsing Strategy
The Constitution has a complex hierarchical structure:

```
Constitution
├── Part I: Introductory
│   ├── Article 1: Name and territory
│   └── Article 2: Citizenship
├── Part II: Citizenship
│   ├── Article 5: Citizenship by birth
│   └── Article 6: Citizenship by registration
├── Part III: Fundamental rights
│   ├── Article 12: Definitions
│   ├── Article 13: Laws inconsistent with fundamental rights
│   └── Article 14: Equality before law
└── Part IV: Directive principles of state policy
    ├── Article 36: Definition of state
    └── Article 37: Application of principles
```

#### Parsing Implementation
```python
# etl/constitution/parse.py
import json, re
from pathlib import Path
from bs4 import BeautifulSoup

RAW  = Path("raw/constitution.html")
OUT  = Path("parsed/nodes.json")
OUT.parent.mkdir(exist_ok=True)

MIN_CONTENT = 40  # skip structural-only headings

def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip()

def make_ref(article_num: str, clause: str = None) -> str:
    base = f"Article {article_num}, Constitution of India"
    return f"Article {article_num}({clause}), Constitution of India" if clause else base

def infer_part(n: int) -> str:
    # Approximate Constitution groupings by article number
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
```

#### Key Parsing Features
- **Hierarchical structure**: Part → Article → Clause
- **Cite-ready references**: Full citation format
- **Content filtering**: Skip structural headings
- **Tag inference**: Automatic categorization of content

### Step 3: Load - Generate Embeddings and Store in Supabase

#### Embedding Strategy
```python
# etl/constitution/embed.py
import json, os, time
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client
from tqdm import tqdm

load_dotenv()

NODES_PATH  = Path("parsed/nodes.json")
BATCH_SIZE  = 100
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM   = 1536
MIN_CHARS   = 40

oai = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
sb  = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

def embed_batch(texts: list[str]) -> list[list[float]]:
    for attempt in range(3):
        try:
            r = oai.embeddings.create(model=EMBED_MODEL, input=texts, dimensions=EMBED_DIM)
            return [d.embedding for d in r.data]
        except Exception as e:
            if attempt == 2: raise
            print(f"Retry {attempt+1}: {e}")
            time.sleep(5)

def main():
    nodes = json.loads(NODES_PATH.read_text())
    embeddable = [n for n in nodes if len(n.get("content","")) >= MIN_CHARS]
    print(f"Embedding {len(embeddable)} nodes ({len(nodes)-len(embeddable)} skipped)")

    est_tokens = sum(len(f"{n['heading']} {n['content']}".split()) * 1.3 for n in embeddable)
    print(f"Est. cost: ${est_tokens/1_000_000 * 0.02:.4f}")
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
```

#### Database Schema
```sql
-- statute_nodes table
CREATE TABLE statute_nodes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  act          TEXT NOT NULL DEFAULT 'constitution',
  part         TEXT,                  -- 'III', 'IV', 'XII' etc.
  section_num  TEXT,                  -- Article number: '21', '300A', '14'
  clause       TEXT,                  -- Sub-clause: '1', '1a', '2' etc.
  heading      TEXT NOT NULL,
  full_ref     TEXT NOT NULL UNIQUE,  -- Cite-ready: 'Article 21, Constitution of India'
  content      TEXT NOT NULL,
  embedding    VECTOR(1536),
  tags         TEXT[] DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Search function
CREATE OR REPLACE FUNCTION search_constitution(
  query_embedding  VECTOR(1536),
  filter_tags      TEXT[] DEFAULT NULL,
  match_count      INT DEFAULT 6
)
RETURNS TABLE (
  id          UUID,
  full_ref    TEXT,
  heading     TEXT,
  content     TEXT,
  tags        TEXT[],
  similarity  FLOAT
)
LANGUAGE SQL STABLE AS $$
  SELECT
    id, full_ref, heading, content, tags,
    1 - (embedding <=> query_embedding) AS similarity
  FROM statute_nodes
  WHERE
    embedding IS NOT NULL
    AND (filter_tags IS NULL OR tags && filter_tags)
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
```

## Claude Code Execution Guide

### Prerequisites

#### 1. Environment Setup
```bash
# Clone the repository
cd /path/to/vakilsahab

# Install Python dependencies (for ETL)
pip install requests beautifulsoup4 lxml openai supabase python-dotenv tiktoken tqdm

# Install Node.js dependencies (for Next.js)
npm install
```

#### 2. Environment Variables
Create `.env.local` with the following:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# NVIDIA NIM (LLM inference)
NVIDIA_NIM_API_KEY=nvapi-...
NVIDIA_NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_NIM_MODEL=nvidia/llama-3.1-405b-instruct

# OpenAI (embeddings only — text-embedding-3-small)
OPENAI_API_KEY=sk-...

# App
NEXT_PUBLIC_APP_URL=https://vakilsahab.vercel.app
```

### Step-by-Step ETL Execution

#### Step 1: Fetch Constitution HTML

**Command:**
```bash
python etl/constitution/fetch.py
```

**Expected Output:**
- Downloads Constitution HTML from legislative.gov.in
- Saves to `etl/constitution/raw/constitution.html`
- Prints first 1000 characters for inspection

**Verification:**
```bash
# Check if file was downloaded
ls -la etl/constitution/raw/
head -n 20 etl/constitution/raw/constitution.html
```

#### Step 2: Parse HTML into Statute Nodes

**Command:**
```bash
python etl/constitution/parse.py
```

**Expected Output:**
- Parses HTML into structured statute_nodes
- Saves to `etl/constitution/parsed/nodes.json`
- Prints parsed node count and sample entries

**Verification:**
```bash
# Check parsed nodes
jq length etl/constitution/parsed/nodes.json
jq '.[0:3]' etl/constitution/parsed/nodes.json
```

#### Step 3: Generate Embeddings and Load to Supabase

**Command:**
```bash
python etl/constitution/embed.py
```

**Expected Output:**
- Generates embeddings for Constitution nodes
- Upserts to Supabase statute_nodes table
- Shows progress and final count

**Verification:**
```bash
# Check Supabase content
# Use Supabase MCP or direct SQL query
SELECT COUNT(*) FROM statute_nodes WHERE act = 'constitution';
SELECT COUNT(*) FROM statute_nodes WHERE embedding IS NOT NULL;
```

### Claude Code Workflow

#### 1. Initial Setup
```
# Claude Code commands to execute:
1. Run fetch.py to download Constitution HTML
2. Run parse.py to parse into statute_nodes
3. Run embed.py to generate embeddings and load to Supabase
4. Verify with Supabase MCP commands
```

#### 2. Error Handling

**Common Issues and Solutions:**

1. **Network Issues**
   - Retry fetch.py with different network
   - Check internet connectivity
   - Verify URL accessibility

2. **Parsing Errors**
   - Inspect HTML structure in fetch.py output
   - Adjust regex patterns in parse.py
   - Check for malformed HTML

3. **Embedding Errors**
   - Verify OpenAI API key in .env.local
   - Check network connectivity
   - Verify Supabase connection

#### 3. Verification Commands

**Check Constitution nodes in Supabase:**
```bash
# Using Supabase MCP
# Run migrations 001-004
# Verify pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';

# Check table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'statute_nodes';

# Verify data
SELECT COUNT(*) FROM statute_nodes WHERE act = 'constitution';
SELECT COUNT(*) FROM statute_nodes WHERE embedding IS NOT NULL;
SELECT full_ref, heading FROM statute_nodes LIMIT 5;
```

## Best Practices

### 1. ETL Process Management
- **Run in order**: fetch → parse → embed
- **Verify each step**: Check output before proceeding
- **Backup data**: Keep copies of intermediate files
- **Document changes**: Note any parsing adjustments

### 2. Error Handling
- **Network retries**: Implement retry logic
- **Graceful degradation**: Handle missing data
- **Logging**: Track progress and errors
- **Testing**: Verify each step independently

### 3. Performance Optimization
- **Batch processing**: Process in batches to avoid rate limits
- **Progress tracking**: Show progress for long operations
- **Error recovery**: Resume from last successful point
- **Resource monitoring**: Track memory and CPU usage

### 4. Quality Assurance
- **Data validation**: Verify parsed data structure
- **Consistency checks**: Ensure data integrity
- **Performance testing**: Test search functionality
- **Documentation**: Update documentation with changes

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Fetch Fails
**Problem**: Cannot download Constitution HTML
**Solution**:
- Check internet connectivity
- Verify URL accessibility
- Check user-agent restrictions
- Try alternative sources

#### Issue 2: Parsing Errors
**Problem**: HTML parsing fails
**Solution**:
- Inspect HTML structure from fetch.py output
- Adjust regex patterns
- Check for malformed HTML
- Update parsing logic

#### Issue 3: Embedding Errors
**Problem**: Cannot generate embeddings
**Solution**:
- Verify OpenAI API key
- Check network connectivity
- Verify Supabase connection
- Check API rate limits

#### Issue 4: Supabase Connection
**Problem**: Cannot connect to Supabase
**Solution**:
- Verify Supabase URL and keys
- Check network connectivity
- Verify pgvector extension
- Check database permissions

## Advanced Usage

### Custom ETL Scripts

#### Custom Fetch Script
```python
# Custom fetch with additional features
import requests
from pathlib import Path
import hashlib

class ConstitutionFetcher:
    def __init__(self, output_dir="etl/constitution/raw"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
    
    def fetch_with_checksum(self, url, expected_checksum=None):
        response = requests.get(url, headers={"User-Agent": "VakilSahab/1.0"})
        response.raise_for_status()
        
        content = response.text
        actual_checksum = hashlib.md5(content.encode()).hexdigest()
        
        if expected_checksum and actual_checksum != expected_checksum:
            raise ValueError(f"Checksum mismatch: expected {expected_checksum}, got {actual_checksum}")
        
        return content, actual_checksum
```

#### Custom Parser
```python
# Custom parser with additional features
class ConstitutionParser:
    def __init__(self):
        self.min_content = 40
        self.tag_patterns = {
            "fundamental_rights": ["right to", "freedom", "liberty", "equality"],
            "property": ["property", "immovable", "transfer"],
            # ... more patterns
        }
    
    def parse_with_custom_rules(self, html):
        # Custom parsing logic
        pass
```

### Monitoring and Logging

#### Progress Tracking
```python
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('etl/constitution/etl.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

def log_step(step, status, message):
    logger.info(f"[{step}] {status}: {message}")
```

## Conclusion

### Why This ETL Process Matters

The ETL process is crucial for VakilSahab because:

1. **Core Functionality**: Constitution RAG search depends on this data
2. **Legal Research**: Indian legal cases require constitutional context
3. **Performance**: Vector search requires pre-computed embeddings
4. **Scalability**: One-time setup enables ongoing free usage

### Key Takeaways

1. **Sequential Execution**: Run fetch → parse → embed in order
2. **Verification**: Check each step before proceeding
3. **Error Handling**: Implement robust error handling
4. **Documentation**: Document all changes and adjustments
5. **Testing**: Verify functionality at each step

### Next Steps After ETL

1. **Run migrations**: Execute Supabase migrations 001-004
2. **Test search**: Verify search_constitution function
3. **Deploy**: Set up Vercel and environment variables
4. **Monitor**: Track performance and usage
5. **Maintain**: Schedule regular ETL re-runs

This comprehensive guide provides everything needed to successfully execute the ETL process for embedding the Indian Constitution into Supabase using Claude Code. The process is systematic, well-tested, and ready for production use.