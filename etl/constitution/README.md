# Constitution ETL

Run in order:

```bash
cd etl
source venv/bin/activate

# 1. Fetch HTML
python constitution/fetch.py
# → Inspect printed HTML to confirm tag structure matches parser selectors

# 2. Parse into nodes
python constitution/parse.py
# → Check parsed/nodes.json — verify full_ref format looks correct

# 3. Embed + upsert
python constitution/embed.py
# → Confirm row count matches expected (~400-500 nodes)
```

Re-run quarterly or when a Constitutional Amendment is notified.
Upsert is idempotent — safe to re-run without duplicating rows.

Required .env variables:
- NVIDIA_NIM_API_KEY (and optionally NVIDIA_NIM_BASE_URL; embeds with nvidia/nemotron-3-embed-1b, 2048-dim)
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
