// Check and complete the cloud-added Orfeu days in daily/feed.json.
//
//   node daily/resolve.mjs           # check, fill, write back
//   node daily/resolve.mjs --dry     # check only
//
// Muse writes the minimum (date, culture slug or label, place slug, Instagram reel
// links, captions). This fills names and playlists from assets/data and marks each
// day ok or rejected with the reasons, so the page only ever shows checked days.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
const feedPath = resolve(root, 'daily/feed.json');
const feed = read('daily/feed.json');
const homes = read('daily/homes.json').homes;
const genres = new Map(read('assets/data/genres.json').genres.map(g => [g.slug, g]));
const places = new Map(read('assets/data/locations.json').locations.map(p => [p.slug, p]));
const playlistId = url => (url || '').split('/').pop().split('?')[0];
const REEL = /^https:\/\/www\.instagram\.com\/(reel|p)\/[\w-]+\/?$/;

// Dates the site already has (hosted clips) win; a cloud day for them is pointless.
let siteDates = new Set();
try {
  const r = await fetch('https://jerrythegoat.com/orfeu/days.json', { signal: AbortSignal.timeout(10000) });
  if (r.ok) siteDates = new Set((await r.json()).days.map(d => d.date));
} catch {}

const seen = new Set();
let ok = 0, rejected = 0;
for (const d of feed.days) {
  const problems = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) problems.push('date must be YYYY-MM-DD');
  if (seen.has(d.date)) problems.push('duplicate date in feed');
  seen.add(d.date);
  if (siteDates.has(d.date)) problems.push('the site already has this date');
  const c = d.culture ||= {}, p = d.place ||= {};

  const key = c.genre || c.label;
  const g = c.genre && genres.get(c.genre);
  if (c.genre && !g) problems.push(`unknown genre slug ${c.genre}`);
  if (g) {
    c.name = g.name;
    c.spotify ||= `playlist/${playlistId(g.playlist)}`;
    c.playlistTitle = g.playlistTitle;
    c.wiki = g.wiki?.url;
    if (g.image) { c.image = g.image.thumb.replace('{w}', '1280'); c.credit = [g.image.title, g.image.artist, g.image.licence].filter(Boolean).join(' · '); c.imagePage = g.image.page; }
  } else if (c.label) {
    c.name = c.label;
    if (!/^(track|playlist)\/\w+$/.test(c.spotify || '')) problems.push(`${c.label}: a culture without a genre slug needs spotify "track/ID" or "playlist/ID"`);
  } else if (!c.genre) problems.push('culture needs a genre slug or a label');

  const pl = places.get(p.place);
  if (!pl) problems.push(`unknown place slug ${p.place}`);
  else {
    p.name = pl.region ? `${pl.name}, ${pl.region}` : pl.name;
    p.country = pl.country;
    p.spotify = `playlist/${playlistId(pl.playlist)}`;
    p.playlistTitle = pl.playlistTitle;
  }

  if (key && pl) {
    const home = homes[key];
    if (!home) problems.push(`${key} has no entry in daily/homes.json`);
    else if (!home.includes(pl.country)) problems.push(`${key} is from ${home.join(' / ')}, not ${pl.country}`);
  }
  if (c.reel && !REEL.test(c.reel)) problems.push(`culture reel is not an Instagram post link: ${c.reel}`);
  if (!p.reel) problems.push('place needs an Instagram reel link');
  else if (!REEL.test(p.reel)) problems.push(`place reel is not an Instagram post link: ${p.reel}`);
  if (c.reel && c.reel === p.reel) problems.push('culture and place use the same reel');
  for (const [k, x] of [['culture', c], ['place', p]]) if (x.reel && !x.caption) problems.push(`${k} reel needs a caption (creator · where)`);

  d.status = problems.length ? 'rejected' : 'ok';
  if (problems.length) { d.problems = problems; rejected++; } else { delete d.problems; ok++; }
}
feed.days.sort((a, b) => String(a.date).localeCompare(String(b.date)));

console.log(`${ok} ok, ${rejected} rejected`);
for (const d of feed.days) if (d.problems) console.log(`- ${d.date}: ${d.problems.join('; ')}`);
if (!process.argv.includes('--dry')) writeFileSync(feedPath, JSON.stringify(feed, null, 1) + '\n');
