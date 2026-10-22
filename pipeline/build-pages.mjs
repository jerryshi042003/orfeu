// Builds two things from assets/data:
//
// 1. assets/data/schedule.json: the genre and place for every date. Until 2026-10-21 the
//    site chose the day's pick with a formula over the list, so changing the list would
//    have changed every earlier ?date= link. The schedule freezes those dates to what the
//    old site showed (computed from the list as it was at commit LEGACY_COMMIT) and lays
//    out the days after that as shuffled rounds through the whole list. It is append-only:
//    a rebuild keeps every date already in the file and only adds days at the end. A
//    scheduled genre that is later cut is skipped by the site at run time.
//
// 2. g/<slug>/index.html for every genre: a copy of index.html with the genre's own title,
//    description and Open Graph image, so a shared link previews with its photo. A page
//    whose genre has been cut is replaced by a short "no longer here" page instead of
//    disappearing, so old links still land somewhere useful.
//
// Usage: node build-pages.mjs   (run after build-genres, build-images and build-locations)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readJson, writeJson } from './lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = 'https://jerryshi042003.github.io/orfeu/';
const LEGACY_COMMIT = 'f82bab7';
const LEGACY_LAST = '2026-10-21';
const START = '2025-01-01';
const AHEAD_DAYS = 800;

const { genres } = readJson(ROOT + 'assets/data/genres.json');
const { locations } = readJson(ROOT + 'assets/data/locations.json');

// ---- Dates (UTC calendar dates, so no daylight-saving drift) --------------------------
const toDate = s => new Date(s + 'T00:00:00Z');
const toIso = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => toIso(new Date(toDate(s).getTime() + n * 86400000));
const between = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

// ---- Seeded shuffle ----------------------------------------------------------------------
function rng(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(list, seed) {
  const r = rng(seed), out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
// Extend `days` with shuffled rounds through `slugs`, never repeating one shown in the last
// `gap` days.
function extend(days, slugs, count, seed, gap = 60) {
  const out = [...days];
  let round = 0;
  while (out.length < count) {
    const recent = new Set(out.slice(-gap));
    const deck = shuffle(slugs, `${seed}:${out.length}:${round++}`);
    const fresh = deck.filter(s => !recent.has(s));
    const later = deck.filter(s => recent.has(s));
    for (const s of [...fresh, ...later]) { if (out.length >= count) break; out.push(s); }
  }
  return out;
}

// ---- The old site's picks (for dates up to LEGACY_LAST) -----------------------------------
function legacy() {
  const git = path => JSON.parse(execFileSync('git', ['-C', ROOT, 'show', `${LEGACY_COMMIT}:${path}`], { encoding: 'utf8', maxBuffer: 64e6 }));
  const oldGenres = git('assets/data/genres.json').genres;
  const oldPlaces = git('assets/data/locations.json');
  // Old name -> new slug ("Forro" -> "forro", "Pipe Band" -> "bagpipe"); cut genres are absent.
  const genreSlug = new Map(genres.map(g => [g.formerly || g.name, g.slug]));
  const placeSlug = new Map(locations.map(l => [l.source, l.slug]));
  const dayNumber = iso => between('2025-12-31', iso);
  const out = { genres: [], places: [] };
  for (let d = START; d <= LEGACY_LAST; d = addDays(d, 1)) {
    // Genre: index = frac(sin(dayNumber) * 10000) * count, then the next genre with a playlist.
    const x = Math.sin(dayNumber(d)) * 10000;
    let i = Math.floor((x - Math.floor(x)) * oldGenres.length);
    for (let n = 0; n < oldGenres.length && !oldGenres[i].playlist; n++) i = (i + 1) % oldGenres.length;
    // If that genre has since been cut, take the next one that survives (as the old site did for dead ones).
    let g = null;
    for (let n = 0; n < oldGenres.length && !g; n++) g = genreSlug.get(oldGenres[(i + n) % oldGenres.length].name) || null;
    out.genres.push(g);
    // Place: position dayNumber mod sourceCount, then the first kept place at or after it.
    const target = ((dayNumber(d) % oldPlaces.sourceCount) + oldPlaces.sourceCount) % oldPlaces.sourceCount;
    const ordered = oldPlaces.locations;
    let j = ordered.findIndex(l => l.sourceIndex >= target);
    if (j < 0) j = 0;
    let p = null;
    for (let n = 0; n < ordered.length && !p; n++) p = placeSlug.get(ordered[(j + n) % ordered.length].source) || null;
    out.places.push(p);
  }
  return out;
}

const FILE = ROOT + 'assets/data/schedule.json';
let schedule = readJson(FILE, null);
if (!schedule) {
  const old = legacy();
  schedule = { start: START, legacyUntil: LEGACY_LAST, note: 'Dates up to legacyUntil reproduce the picks of the site before the schedule existed. Append-only.', genres: old.genres, places: old.places };
}
const today = toIso(new Date());
const want = between(schedule.start, today) + AHEAD_DAYS;
const before = schedule.genres.length;
schedule.genres = extend(schedule.genres, genres.map(g => g.slug), want, 'genres');
schedule.places = extend(schedule.places, locations.map(l => l.slug), want, 'places');
writeJson(FILE, schedule, false);
console.log(`Schedule: ${schedule.start} to ${addDays(schedule.start, schedule.genres.length - 1)} (${schedule.genres.length - before} days added)`);

// ---- Share pages ---------------------------------------------------------------------------
const template = readFileSync(ROOT + 'index.html', 'utf8');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MARK = '<meta name="generator" content="orfeu pipeline/build-pages.mjs">';
function firstSentence(text) {
  const m = (text || '').match(/^.*?[.!?](\s|$)/s);
  const sentence = (m ? m[0] : text || '').trim();
  return sentence.length <= 200 ? sentence : sentence.slice(0, 197).replace(/\s+\S*$/, '') + '…';
}
function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(">)`);
  return re.test(html) ? html.replace(re, `$1${esc(value)}$2`) : html.replace('</head>', `  <meta ${attr}="${key}" content="${esc(value)}">\n</head>`);
}
function page(g) {
  const url = `${SITE}g/${g.slug}/`;
  const description = g.wiki ? firstSentence(g.wiki.extract) : `Listen to ${g.name}: a Spotify playlist on Orfeu.`;
  let html = template
    .replace(/(href|src)="\.\//g, '$1="../../')
    .replace('<body data-page="today" data-root="./">', `<body data-page="genre" data-root="../../" data-genre="${g.slug}">`)
    .replace(/<a href="\.\.\/\.\.\/" aria-current="page">/g, '<a href="../../">')
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(g.name)} · Orfeu</title>`)
    .replace(/(<link rel="canonical" href=")[^"]*(">)/, `$1${url}$2`)
    .replace('<h1 id="pick-name" class="hero-title" aria-busy="true">&hellip;</h1>', `<h1 id="pick-name" class="hero-title" aria-busy="true">${esc(g.name)}</h1>`)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${MARK}`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:title', `${g.name} · Orfeu`);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:url', url);
  if (g.image) {
    const w = g.image.widths.filter(x => x <= 1280).pop();
    const og = g.image.original && (!w || (g.image.w > w && g.image.w <= 1600)) ? g.image.original : g.image.thumb.replace('{w}', w);
    html = setMeta(html, 'property', 'og:image', og);
    html = setMeta(html, 'property', 'og:image:alt', g.image.title);
  }
  if (!html.includes(`data-genre="${g.slug}"`)) throw new Error('index.html changed shape; update build-pages.mjs');
  return html;
}
function gone(slug) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${MARK}
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>No longer on Orfeu</title>
  <link rel="stylesheet" href="../../assets/css/orfeu.css?v=5">
</head>
<body data-root="../../">
  <main class="page"><div class="wrap"><header class="page-head">
    <p class="kicker">Orfeu</p>
    <h1 class="page-title">This genre is no longer here</h1>
    <p class="page-lede">“${esc(slug)}” was taken off Orfeu because its Spotify playlist stopped working.</p>
    <p class="place-actions"><a class="btn btn-quiet" href="../../explore/">Explore all genres</a> <a class="btn btn-quiet" href="../../">Today’s genre</a></p>
  </header></div></main>
</body>
</html>
`;
}

const dir = ROOT + 'g/';
mkdirSync(dir, { recursive: true });
const live = new Set();
for (const g of genres) {
  mkdirSync(dir + g.slug, { recursive: true });
  writeFileSync(dir + g.slug + '/index.html', page(g));
  live.add(g.slug);
}
let retired = 0;
for (const name of readdirSync(dir)) {
  const file = dir + name + '/index.html';
  if (live.has(name) || !existsSync(file)) continue;
  if (!readFileSync(file, 'utf8').includes(MARK)) continue; // never touch a page this script did not write
  writeFileSync(file, gone(name));
  retired++;
}
console.log(`Share pages: ${live.size} genres${retired ? `, ${retired} retired` : ''}`);
