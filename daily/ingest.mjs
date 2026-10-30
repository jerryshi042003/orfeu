// Merge a Muse "ORFEU FEED" email into daily/feed.json and daily/homes.json.
//
//   node daily/ingest.mjs mail.txt      # the email body, as text
//
// The body ends with a JSON object between the lines ORFEU-JSON-START and
// ORFEU-JSON-END: {"days": [...], "homes": {...}}. New dates are appended; a date
// already in the feed is left alone. New homes are added; existing ones are kept.
// Then resolve.mjs checks everything (the daily-feed Action runs it again on push).
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = readFileSync(process.argv[2], 'utf8').replace(/\r/g, '');
const m = text.match(/ORFEU-JSON-START\s*\n([\s\S]*?)\n\s*ORFEU-JSON-END/);
if (!m) { console.error('No ORFEU-JSON-START ... ORFEU-JSON-END block in the email.'); process.exit(1); }
// Mail clients sometimes curl the quotes; JSON needs straight ones.
const block = JSON.parse(m[1].replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));

const feedPath = resolve(root, 'daily/feed.json'), homesPath = resolve(root, 'daily/homes.json');
const feed = JSON.parse(readFileSync(feedPath, 'utf8'));
const homes = JSON.parse(readFileSync(homesPath, 'utf8'));
const have = new Set(feed.days.map(d => d.date));
let added = 0, skipped = 0, newHomes = 0;
for (const d of block.days || []) {
  if (!d || have.has(d.date)) { skipped++; continue; }
  const { date, culture, place, why } = d;
  feed.days.push({ date, culture, place, ...(why ? { why } : {}) });
  have.add(date); added++;
}
for (const [k, v] of Object.entries(block.homes || {})) {
  if (!homes.homes[k] && Array.isArray(v) && v.length) { homes.homes[k] = v; newHomes++; }
}
writeFileSync(feedPath, JSON.stringify(feed, null, 1) + '\n');
writeFileSync(homesPath, JSON.stringify(homes, null, 1) + '\n');
console.log(`${added} days added, ${skipped} already present, ${newHomes} homes added`);
execFileSync('node', [resolve(root, 'daily/resolve.mjs')], { stdio: 'inherit' });
