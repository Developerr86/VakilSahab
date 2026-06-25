// HTTP fetch with retry, SSRF guard, and main-content extraction.
// Zero required deps: uses global fetch (Node 18+). The readability path is
// OPTIONAL — if @mozilla/readability + linkedom are installed it produces much
// cleaner text; otherwise it falls back to a boilerplate-stripping regex pass.

const DEFAULT_TIMEOUT_MS = 12_000
const DEFAULT_RETRIES = 2
const FETCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'

export interface FetchOptions {
  timeoutMs?: number
  retries?: number
  headers?: Record<string, string>
}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, headers } = options
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, {
        headers: { 'User-Agent': FETCH_USER_AGENT, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      })
    } catch (err) {
      lastError = err
      if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Fetch failed')
}

/** Block SSRF: no localhost, no private/link-local ranges, http(s) only. */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host.endsWith('.local')) return false
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0.0.0|::1|fc00:|fd)/.test(host)) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
}

export function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
}

/** Regex fallback: drop chrome (nav/aside/footer/forms) then strip tags. */
function regexExtract(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
  return stripTags(cleaned)
}

/** Optional high-quality extraction via @mozilla/readability. Returns null if
 * the deps aren't installed so the caller can fall back gracefully. */
async function readabilityExtract(html: string, url: string): Promise<string | null> {
  try {
    // Dynamic import keeps these optional — no install, no problem. The
    // @ts-ignore lets the module typecheck even when the deps aren't installed.
    // @ts-ignore optional dependency
    const { Readability } = await import('@mozilla/readability')
    // @ts-ignore optional dependency
    const { parseHTML } = await import('linkedom')
    const { document } = parseHTML(html)
    // Readability wants a base URI for resolving links.
    const article = new Readability(document as unknown as Document).parse()
    if (article?.textContent && article.textContent.trim().length > 200) {
      return article.textContent.replace(/\s+/g, ' ').trim()
    }
    return null
  } catch {
    return null // deps missing or parse failed → caller uses regex fallback
  }
}

function extractMetaDescription(html: string): string | null {
  const m = html.match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i,
  )
  return m?.[1]?.trim() ?? null
}

/** Fetch a URL and return its main-content text (readability if available,
 * regex otherwise). Returns null on non-HTML, unsafe URL, or failure. */
export async function fetchPageText(url: string, maxChars = 4000): Promise<string | null> {
  if (!isSafeUrl(url)) return null
  try {
    const res = await fetchWithRetry(url, { timeoutMs: 10_000, retries: 1 })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null

    const html = await res.text()
    const main = (await readabilityExtract(html, url)) ?? regexExtract(html)
    const meta = extractMetaDescription(html)
    const text = meta && !main.startsWith(meta) ? `${meta}\n\n${main}` : main
    return text.slice(0, maxChars) || null
  } catch {
    return null
  }
}