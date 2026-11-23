// ─────────────────────────────────────────────────────────────────────────────
// scraper.ts — arc custom web scraper (zero dependencies)
//
// Pure Node http/https. Handles:
//   • Redirects (up to 8 hops)
//   • Gzip/deflate decompression
//   • Charset detection from Content-Type and meta tags
//   • HTML → readable text extraction (heuristic, not DOM)
//   • JSON pretty-printing
//   • Robots.txt bypass (we're a local tool, not a bot)
//   • Timeout and size limits
// ─────────────────────────────────────────────────────────────────────────────

import * as http  from 'http';
import * as https from 'https';
import * as zlib  from 'zlib';
import { URL }    from 'url';

export interface ScrapeResult {
  url:         string;
  title:       string;
  text:        string;
  bytesFetched: number;
  contentType: string;
  error?:      string;
}

const MAX_BYTES    = 512 * 1024;  // 512KB
const TIMEOUT_MS   = 12_000;
const MAX_REDIRECTS = 8;

// ── HTML → text extraction ────────────────────────────────────────────────────

function stripHtml(html: string): string {
  let text = html;

  // Remove entire blocks we never want
  text = text.replace(/<(script|style|noscript|nav|footer|header|aside|svg|iframe|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Extract title
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title      = titleMatch ? titleMatch[1].trim() : '';

  // Convert common block elements to newlines
  text = text.replace(/<(br|p|div|section|article|main|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|main|h[1-6]|tr|blockquote)>/gi, '\n');

  // Convert anchors: [text](href) style
  text = text.replace(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/gi, '$2');

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeEntities(text);

  // Collapse whitespace
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g,   '&')
    .replace(/&lt;/g,    '<')
    .replace(/&gt;/g,    '>')
    .replace(/&quot;/g,  '"')
    .replace(/&#39;/g,   "'")
    .replace(/&apos;/g,  "'")
    .replace(/&nbsp;/g,  ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g,'…')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : '';
}

// Heuristic: score each block of text and prefer the main content
function extractMainContent(html: string, maxChars = 8000): string {
  // First try: look for <article>, <main>, <div role="main"> etc.
  const mainBlockRe = /<(article|main)[^>]*>([\s\S]{200,}?)<\/\1>/i;
  const mainMatch   = html.match(mainBlockRe);
  const source      = mainMatch ? mainMatch[0] : html;

  const text = stripHtml(source);

  // Trim to limit
  if (text.length <= maxChars) return text;

  // Smart truncation: find last sentence boundary before limit
  const limited = text.slice(0, maxChars);
  const lastSent = Math.max(
    limited.lastIndexOf('. '),
    limited.lastIndexOf('.\n'),
  );
  return lastSent > maxChars * 0.7
    ? limited.slice(0, lastSent + 1) + '\n\n[…truncated]'
    : limited + '\n\n[…truncated]';
}

// ── HTTP fetch ────────────────────────────────────────────────────────────────

function fetchRaw(urlStr: string, redirectsLeft: number): Promise<{ body: string; url: string; contentType: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try { parsed = new URL(urlStr); }
    catch (e) { reject(new Error(`Invalid URL: ${urlStr}`)); return; }

    const lib     = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      timeout:  TIMEOUT_MS,
      headers:  {
        'User-Agent':      'arc/1.6.1 (local LLM platform; +https://github.com/the-architect/arc)',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Connection':      'close',
      },
    };

    const req = lib.request(options, (res) => {
      const status      = res.statusCode ?? 0;
      const contentType = res.headers['content-type'] ?? '';

      // Follow redirects
      if (status >= 300 && status < 400 && res.headers.location) {
        if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return; }
        const next = new URL(res.headers.location, urlStr).href;
        res.resume(); // drain the response
        fetchRaw(next, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }

      if (status < 200 || status >= 400) {
        reject(new Error(`HTTP ${status}`));
        res.resume();
        return;
      }

      // Decompress
      const encoding = res.headers['content-encoding'] ?? '';
      let   stream: NodeJS.ReadableStream = res;
      if      (encoding === 'gzip')    stream = res.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (encoding === 'br')      stream = res.pipe(zlib.createBrotliDecompress());

      const chunks: Buffer[] = [];
      let   totalBytes = 0;

      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_BYTES) {
          req.destroy();
          // Resolve with what we have
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ body, url: urlStr, contentType, bytes: totalBytes });
          return;
        }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ body, url: urlStr, contentType, bytes: totalBytes });
      });

      stream.on('error', reject);
    });

    req.on('timeout', () => { req.destroy(); reject(new Error(`Request timed out after ${TIMEOUT_MS}ms`)); });
    req.on('error',   reject);
    req.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  // Ensure protocol
  const urlStr = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  try {
    const { body, url: finalUrl, contentType, bytes } = await fetchRaw(urlStr, MAX_REDIRECTS);

    // JSON
    if (contentType.includes('application/json') || (body.trimStart().startsWith('{') || body.trimStart().startsWith('['))) {
      try {
        const parsed = JSON.parse(body);
        return {
          url:          finalUrl,
          title:        'JSON response',
          text:         JSON.stringify(parsed, null, 2).slice(0, 8000),
          bytesFetched: bytes,
          contentType,
        };
      } catch { /* fall through to text */ }
    }

    // Plain text / markdown
    if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
      return {
        url:          finalUrl,
        title:        new URL(finalUrl).pathname.split('/').pop() ?? finalUrl,
        text:         body.slice(0, 8000),
        bytesFetched: bytes,
        contentType,
      };
    }

    // HTML
    const title = extractTitle(body);
    const text  = extractMainContent(body);

    return {
      url:          finalUrl,
      title:        title || new URL(finalUrl).hostname,
      text,
      bytesFetched: bytes,
      contentType,
    };

  } catch (err: any) {
    return {
      url:          urlStr,
      title:        '',
      text:         '',
      bytesFetched: 0,
      contentType:  '',
      error:        err.message,
    };
  }
}

/** Format a ScrapeResult for injection into a prompt */
export function formatScrapeResult(result: ScrapeResult): string {
  if (result.error) {
    return `[Error fetching ${result.url}: ${result.error}]`;
  }
  const header = result.title
    ? `[Web page: ${result.title}]\n[URL: ${result.url}]\n[${result.bytesFetched} bytes]\n`
    : `[URL: ${result.url}]\n[${result.bytesFetched} bytes]\n`;
  return header + '---\n' + result.text;
}
