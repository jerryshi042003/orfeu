// Audits every Spotify playlist the site can link to and writes
// pipeline/reports/playlists-audit.json. build-genres.mjs and build-locations.mjs read
// that report: a playlist that fails is cut, and a genre whose playlist was renamed is
// renamed to match.
//
// A playlist "works" when all three gates pass:
//   1. oEmbed answers 200. A 404 is only believed after three tries, because Spotify
//      sometimes answers 404 for a live playlist.
//   2. The embed player lists at least MIN_TRACKS tracks and at least MIN_PLAYABLE of
//      them are playable (checked three times before failing). The embed page's
//      __NEXT_DATA__ JSON is undocumented, so it is read here only, never by the site.
//   3. The playlist's current title still names the genre or place ("The Pulse of X",
//      "The Sound of X"), ignoring case, accents and a leading "Classic". A title that
//      names something else is reported as drift; it does not cut the page.
//
// Requests are paced 0.3 s apart per endpoint (oEmbed and embed run as two streams).
// Progress is appended to pipeline/.cache/audit-progress.jsonl so an interrupted run
// resumes where it stopped.
//
// Usage: node audit-playlists.mjs [--only genres|places] [--fresh] [--limit N (smoke test; no report)]
//                                 [--min-tracks N] [--min-share 0.7]
import { readFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { readCsv, readJson, writeJson, fold, sleep, mapLimit, playlistId } from './lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const UA = 'OrfeuDataBuild/1.0 (https://github.com/jerryshi042003/orfeu; playlist audit)';
export const MIN_TRACKS = 20;
export const MIN_PLAYABLE = 0.7;
const PACE_MS = 300;
const NOT_PLACES = /christmas|^everything$|^hatecore$|^"?APO /i;

const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const only = arg('--only');
const PROGRESS = ROOT + "pipeline/.cache/audit-progress.jsonl"; // delete it (or pass --fresh) to start over
if (process.argv.includes('--fresh') && existsSync(PROGRESS)) unlinkSync(PROGRESS);

// ---- What to audit ---------------------------------------------------------
function targets() {
  const out = [];
  if (only !== 'places') {
    for (const [name, uri, web] of readCsv(ROOT + 'pipeline/source/filteredPulse.csv').slice(1)) {
      out.push({ kind: 'genre', name: name.trim(), id: playlistId(web) || playlistId(uri) });
    }
    // Extra Pulse genres the picks tab needs (see extra-genres.json).
    const pulse = new Map(readCsv(ROOT + 'pipeline/source/thePulseOf.csv').map(([n, uri, web]) => [n.trim(), playlistId(web) || playlistId(uri)]));
    for (const name of readJson(ROOT + 'pipeline/extra-genres.json', { genres: [] }).genres.map(g => g.name)) {
      if (!pulse.has(name)) throw new Error(`Extra genre ${name} is not in thePulseOf.csv`);
      out.push({ kind: 'genre', name, id: pulse.get(name), extra: true });
    }
  }
  if (only !== 'genres') {
    for (const [raw, uri, web] of readCsv(ROOT + 'pipeline/source/passed_rows.csv').slice(1)) {
      const name = raw.trim();
      if (NOT_PLACES.test(name)) continue;
      out.push({ kind: 'place', name, id: playlistId(web) || playlistId(uri) });
    }
  }
  return out;
}

// ---- Paced fetch -------------------------------------------------------------
const lanes = { oembed: 0, embed: 0 };
// Each lane reserves a start time at least PACE_MS after the previous request's start.
async function paced(lane, url) {
  const start = Math.max(lanes[lane] + PACE_MS, Date.now());
  lanes[lane] = start;
  if (start > Date.now()) await sleep(start - Date.now());
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
    return { status: res.status, text: res.ok ? await res.text() : '' };
  } catch (err) {
    return { status: 'error', text: '', error: String(err) };
  }
}

async function oembed(id) {
  const url = 'https://open.spotify.com/oembed?url=' + encodeURIComponent(`https://open.spotify.com/playlist/${id}`);
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await paced('oembed', url);
    if (last.status === 200) {
      try { return { status: 200, title: JSON.parse(last.text).title ?? null, attempts: attempt }; } catch { last.status = 'bad-json'; }
    }
    if (attempt < 3) await sleep(2000 * attempt);
  }
  return { status: last.status, title: null, attempts: 3 };
}

function parseEmbed(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!m) return null;
  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity;
  if (!entity) return { entity: false, tracks: 0, playable: 0, name: null };
  const list = entity.trackList || [];
  return { entity: true, name: entity.name ?? entity.title ?? null, tracks: list.length, playable: list.filter(t => t.isPlayable).length };
}

const tracksPass = e => e && e.entity && e.tracks >= MIN_TRACKS && e.playable / e.tracks >= MIN_PLAYABLE;

async function embed(id) {
  let best = null, status = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await paced('embed', `https://open.spotify.com/embed/playlist/${id}`);
    status = res.status;
    let e = null;
    if (res.status === 200) { try { e = parseEmbed(res.text); } catch { e = null; } }
    if (e && (!best || e.tracks > best.tracks)) best = e;
    if (tracksPass(best)) return { status, ...best, attempts: attempt };
    if (attempt < 3) await sleep(2000 * attempt);
  }
  return { status, ...(best || { entity: false, tracks: 0, playable: 0, name: null }), attempts: 3 };
}

// ---- Title gate ------------------------------------------------------------------
const PREFIX = { genre: /^the pulse of\s+/i, place: /^the sound of\s+/i };
export function titleCheck(kind, name, title) {
  if (!title) return { match: 'missing', current: null };
  const current = title.replace(PREFIX[kind], '').trim();
  if (current === name) return { match: 'exact', current };
  if (fold(current) === fold(name)) return { match: 'spelling', current };
  if (kind === 'genre' && fold(current.replace(/^classic\s+/i, '')) === fold(name)) return { match: 'classic', current };
  return { match: 'drift', current };
}

// ---- Run -------------------------------------------------------------------------
const limit = Number(arg('--limit')) || Infinity;
const list = targets().slice(0, limit);
const done = new Map();
if (existsSync(PROGRESS)) for (const line of readFileSync(PROGRESS, 'utf8').split('\n')) if (line) { const r = JSON.parse(line); if (r.verdict !== 'error') done.set(r.kind + ':' + r.id, r); }
mkdirSync(ROOT + 'pipeline/.cache', { recursive: true });
console.log(`Auditing ${list.length} playlists (${done.size} already checked in this run)`);

// The verdict is derived from the raw fields, so thresholds can change without refetching.
export function judgeRow(r, minTracks = MIN_TRACKS, minShare = MIN_PLAYABLE) {
  const reasons = [];
  if (r.oembed === 404) reasons.push('oembed-404');
  else if (r.oembed !== 200) reasons.push('oembed-' + r.oembed);
  if (!r.entity) reasons.push('embed-no-entity');
  else if (r.tracks < minTracks) reasons.push(`tracks-${r.tracks}`);
  else if (r.playable / r.tracks < minShare) reasons.push(`playable-${r.playable}/${r.tracks}`);
  // "error" = Spotify could not be reached; rerun before deciding anything.
  const unreachable = r.oembed !== 200 && r.oembed !== 404;
  const verdict = unreachable ? 'error' : reasons.length ? 'cut' : r.titleMatch === 'drift' ? 'drift' : r.titleMatch === 'exact' ? 'pass' : 'rename';
  return { ...r, verdict, reasons };
}

let count = 0;
const t0 = Date.now();
const raw = await mapLimit(list, 2, async t => {
  const key = t.kind + ':' + t.id;
  if (done.has(key)) return done.get(key);
  const [o, e] = await Promise.all([oembed(t.id), embed(t.id)]);
  const title = o.title || e.name;
  const tc = titleCheck(t.kind, t.name, title);
  const row = judgeRow({
    kind: t.kind, name: t.name, id: t.id, ...(t.extra ? { extra: true } : {}),
    oembed: o.status, oembedAttempts: o.attempts, title, current: tc.current, titleMatch: tc.match,
    embed: e.status, entity: e.entity, tracks: e.tracks, playable: e.playable, embedAttempts: e.attempts,
    checkedAt: new Date().toISOString(),
  });
  appendFileSync(PROGRESS, JSON.stringify(row) + '\n');
  if (++count % 50 === 0) console.log(`${count} checked, ${Math.round((Date.now() - t0) / 1000)} s`);
  return row;
});
const minTracks = Number(arg('--min-tracks')) || MIN_TRACKS;
const minShare = Number(arg('--min-share')) || MIN_PLAYABLE;
const results = raw.map(r => judgeRow(r, minTracks, minShare));

if (limit !== Infinity) { console.log(JSON.stringify(results, null, 1)); process.exit(0); }
const tally = results.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] || 0) + 1), m), {});
const previous = readJson(ROOT + 'pipeline/reports/playlists-audit.json', { items: [] }).items;
const keep = only ? previous.filter(r => r.kind !== (only === 'genres' ? 'genre' : 'place')) : [];
const items = [...keep, ...results].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
writeJson(ROOT + 'pipeline/reports/playlists-audit.json', {
  checkedAt: new Date().toISOString(),
  gates: { oembed: '200, a 404 confirmed three times', minTracks, minPlayableShare: minShare, title: 'names the genre or place, ignoring case, accents and a leading "Classic"' },
  tally: items.reduce((m, r) => ((m[r.kind + ':' + r.verdict] = (m[r.kind + ':' + r.verdict] || 0) + 1), m), {}),
  items,
});
console.log('Done in', Math.round((Date.now() - t0) / 1000), 's', tally);
for (const r of results.filter(r => r.verdict !== 'pass')) console.log(`${r.verdict}\t${r.kind}\t${r.name}\t${r.title}\t${r.tracks}/${r.playable}\t${r.reasons.join(',')}`);
if (results.some(r => r.verdict === 'error')) { console.error('Some playlists could not be reached; rerun to retry them.'); process.exitCode = 2; }
