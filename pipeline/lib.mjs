// Shared helpers for the Orfeu data build scripts.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

export const UA = 'OrfeuDataBuild/1.0 (https://github.com/jerryshi042003/orfeu)';

// Minimal RFC 4180 CSV parser (handles quoted fields with commas).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  return rows;
}

export const readCsv = path => parseCsv(readFileSync(path, 'utf8'));
export const readJson = (path, fallback) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };
export const writeJson = (path, value, pretty = true) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, pretty ? 1 : 0) + '\n');
};

// Lowercase, strip accents and everything that is not a letter or digit.
export const fold = s => (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Optional on-disk cache (pipeline/.cache, git-ignored) so reruns do not refetch.
const CACHE = new URL('./.cache/', import.meta.url).pathname;
const useCache = !process.argv.includes('--no-cache');

const cacheFile = url => CACHE + createHash('sha1').update(url).digest('hex') + '.json';
export const isCached = url => useCache && existsSync(cacheFile(url));

// GET JSON with retries. Returns { status, body } and never throws for HTTP errors.
export async function getJson(url, opts = {}) {
  const file = cacheFile(url);
  if (useCache && opts.cache !== false && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const result = await fetchJson(url, opts);
  if (useCache && opts.cache !== false && (result.status === 200 || result.status === 404)) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(result));
  }
  return result;
}

async function fetchJson(url, { retries = 4 } = {}) {
  for (let attempt = 0; ; attempt++) {
    let wait = 1500 * (attempt + 1);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 404 || res.status === 400) return { status: res.status, body: null };
      if (res.ok) return { status: res.status, body: await res.json() };
      // Rate limited (Wikimedia answers 429 with Retry-After): wait as asked, a few more times.
      if (res.status === 429 && attempt < retries + 4) wait = Math.min(60, Math.max(5, +res.headers.get('retry-after') || 10)) * 1000;
      else if (attempt >= retries) return { status: res.status, body: null };
    } catch (err) {
      if (attempt >= retries) return { status: 'error', body: null, error: String(err) };
    }
    await sleep(wait);
  }
}

// Run fn over items with limited concurrency, preserving order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export const playlistId = link => (String(link || '').match(/playlist[:/]([A-Za-z0-9]{22})/) || [])[1] || null;

// URL slug: "Música Mexicana" -> "musica-mexicana", "R&B" -> "r-and-b".
export const slugify = s => (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
