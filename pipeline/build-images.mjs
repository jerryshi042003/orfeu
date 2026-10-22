// Gives each genre in assets/data/genres.json a freely licensed photo from Wikipedia /
// Wikimedia Commons, with the credit the licence asks for.
//
// Candidates, in order of preference:
//   1. a reviewed override in pipeline/image-overrides.json (a file, or null for none);
//   2. the article's lead image (Wikipedia "page image", free licences only);
//   3. the Wikidata item's image (P18);
//   4. the article's other images, in the order they appear (minus files rejected in
//      review, listed under "_exclude" in image-overrides.json);
//   5. only when 2-4 give nothing at least 800 px wide: files in the Wikidata item's
//      Commons category (P373), flagged in the report for review.
// Only Commons files are used (local en.wikipedia files are fair-use uploads). A file must
// be a photo or painting (no SVG, maps, logos, flags, scores, diagrams), at least
// MIN_WIDTH pixels wide, not extremely tall or wide, and carry a free licence
// (public domain, CC0, CC BY, CC BY-SA, "Attribution", "Copyrighted free use").
// The first candidate at least GOOD_WIDTH wide wins; otherwise the widest one.
// No photo appears on two genres: when two genres share an article, the second gets its
// next-best image, or the poster when there is none.
// Genres with no usable image get none, and the site draws a typographic poster.
//
// The site hotlinks upload.wikimedia.org thumbnails at Wikimedia's standard widths
// (500, 960, 1280, 1920); other widths are refused. Every chosen thumbnail is checked
// with a HEAD request on each build.
//
// Usage: node build-images.mjs   (run after build-genres.mjs)
import { writeFileSync } from 'node:fs';
import { readJson, writeJson, getJson, isCached, sleep, mapLimit, UA } from './lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const GENRES = ROOT + 'assets/data/genres.json';
const OVERRIDES = readJson(ROOT + 'pipeline/image-overrides.json', {});
const FAVOURITES = readJson(ROOT + 'assets/data/favourites.json', { picks: [] }).picks.map(p => p.genre);
export const WIDTHS = [500, 960, 1280, 1920];
const MIN_WIDTH = 450, GOOD_WIDTH = 1200, PRIMARY_ENOUGH = 800;
// Words that mark a file as something other than a photo or painting. Matched as whole
// words of the file name ("photographed" is fine, "graph" is not).
const JUNK_WORDS = 'sheet|partitura|certificate|discogs|logo|logos|icon|icons|flag|flags|map|maps|locator|location|signature|coat of arms|seal|emblem|diagram|chart|charts|graph|score|notation|sheet music|staff|spectrogram|waveform|scale|chord|chords|tablature|tab|cover|album cover|cover art|stamp|banknote|question book|ambox|disambig|wiktionary|portal|crystal clear|nuvola|speaker|loudspeaker|symbol|screenshot|qr code|openclipart|gnome|mime|timeline|poster|ticket|label|record label|cd|lp|vinyl|sleeve|advertisement|ad|text|letter|manuscript';
const JUNK = new RegExp(`(^|[^a-z])(${JUNK_WORDS.replace(/ /g, '[_ -]')})([^a-z]|$)`, 'i');
const MEDIA = /\.(svg|gif|ogg|oga|ogv|webm|mp3|wav|flac|mid|midi|pdf|djvu|stl)$/i;
const FREE = /^(public domain|pd\b|pd-|cc0|cc[- ]by|cc[- ]?by[- ]?sa|attribution|copyrighted free use|no restrictions|free art|fal\b)/i;

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const strip = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const fileKey = f => safeDecode(String(f)).replace(/^(File|Image):/i, '').replace(/ /g, '_');
const EXCLUDE = new Set((OVERRIDES._exclude?.files || []).map(fileKey)); // files rejected in review
let lastCall = 0;
async function api(url) {
  // getJson caches responses in pipeline/.cache; pace only real network calls.
  if (isCached(url)) return getJson(url);
  const wait = lastCall + 1000 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const res = await getJson(url);
  // A call that still fails after the retries would silently drop photos; stop instead.
  if (res.status !== 200 && res.status !== 404) throw new Error(`Wikimedia answered ${res.status} for ${url.slice(0, 140)}…; rerun later`);
  return res;
}

const data = readJson(GENRES);
const genres = data.genres;
const titles = [...new Set(genres.filter(g => g.wiki).map(g => g.wiki.title))];
console.log(`${genres.length} genres, ${titles.length} articles`);

// 1. Lead image and Wikidata item for every article (50 titles per call).
const lead = new Map(), item = new Map();
for (const batch of chunk(titles, 50)) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages|pageprops&piprop=name|original&pilicense=free&ppprop=wikibase_item&titles=' + encodeURIComponent(batch.join('|'));
  const { body } = await api(url);
  const alias = new Map();
  for (const n of [...(body?.query?.normalized || []), ...(body?.query?.redirects || [])]) alias.set(n.to, n.from);
  for (const p of body?.query?.pages || []) {
    let t = p.title;
    while (alias.has(t) && !batch.includes(t)) t = alias.get(t);
    if (p.pageimage && p.original?.source?.includes('/wikipedia/commons/')) lead.set(t, fileKey(p.pageimage));
    if (p.pageprops?.wikibase_item) item.set(t, p.pageprops.wikibase_item);
  }
}

console.log(`Lead images: ${lead.size}`);

// 2. Wikidata P18 (50 items per call).
const p18 = new Map(), commonsCat = new Map();
for (const batch of chunk([...new Set(item.values())], 50)) {
  const { body } = await api('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=' + batch.join('|'));
  for (const [id, e] of Object.entries(body?.entities || {})) {
    const files = (e.claims?.P18 || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean).map(fileKey);
    if (files.length) p18.set(id, files);
    const cat = e.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
    if (cat) commonsCat.set(id, cat);
  }
}

console.log(`Wikidata images: ${p18.size}`);

// 3. The article's own images, in page order.
const body = new Map();
await mapLimit(titles, 1, async t => {
  const { body: list } = await api('https://en.wikipedia.org/api/rest_v1/page/media-list/' + encodeURIComponent(t.replace(/ /g, '_')));
  body.set(t, (list?.items || []).filter(i => i.type === 'image' && i.title).map(i => fileKey(i.title)));
});

const category = new Map(); // filled in step 4b

// 4. Commons file info for every candidate (50 files per call).
const candidatesOf = g => {
  const o = OVERRIDES[g.name];
  if (o && Object.prototype.hasOwnProperty.call(o, 'file')) return { forced: true, files: o.file ? [fileKey(o.file)] : [] };
  if (!g.wiki) return { forced: false, files: [] };
  const t = g.wiki.title;
  const tagged = [];
  if (lead.has(t)) tagged.push([lead.get(t), 'lead']);
  for (const f of p18.get(item.get(t)) || []) tagged.push([f, 'p18']);
  for (const f of body.get(t) || []) tagged.push([f, 'article']);
  for (const f of category.get(t) || []) tagged.push([f, 'commons-category']);
  const seen = new Set();
  return { forced: false, files: tagged.filter(([f]) => !seen.has(f) && seen.add(f)).map(([f, via]) => ({ f, via })) };
};
const info = new Map();
async function fetchInfo(files) {
  const wanted = [...new Set(files)].filter(f => !MEDIA.test(f) && !info.has(f));
  for (const batch of chunk(wanted, 50)) {
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=500'
      + '&iiextmetadatafilter=' + encodeURIComponent('LicenseShortName|LicenseUrl|Artist|Credit|AttributionRequired|NonFree|ObjectName|Restrictions')
      + '&titles=' + encodeURIComponent(batch.map(f => 'File:' + f).join('|'));
    const { body: res } = await api(url);
    const alias = new Map((res?.query?.normalized || []).map(n => [n.to, n.from]));
    for (const p of res?.query?.pages || []) {
      const ii = p.imageinfo?.[0];
      if (!ii || p.missing) continue;
      const key = fileKey(alias.get(p.title) || p.title);
      const md = Object.fromEntries(Object.entries(ii.extmetadata || {}).map(([k, v]) => [k, v.value]));
      info.set(key, { file: fileKey(p.title), w: ii.width, h: ii.height, mime: ii.mime, size: ii.size, url: ii.url, thumb500: ii.thumburl, page: ii.descriptionurl, md });
    }
  }
}
await fetchInfo(genres.flatMap(g => candidatesOf(g).files.map(c => (typeof c === 'string' ? c : c.f))));

// 4b. For articles with no usable image of their own at least PRIMARY_ENOUGH wide: the
// files in the item's Commons category (Wikidata P373). These are less certain, so they
// rank last and the report lists them for review.
const needsMore = titles.filter(t => commonsCat.has(item.get(t)) && ![lead.get(t), ...(p18.get(item.get(t)) || []), ...(body.get(t) || [])].some(f => f && usable(f).ok && info.get(f).w >= PRIMARY_ENOUGH));
await mapLimit(needsMore, 1, async t => {
  const cat = commonsCat.get(item.get(t));
  const { body: res } = await api('https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&list=categorymembers&cmtype=file&cmlimit=40&cmtitle=' + encodeURIComponent('Category:' + cat));
  category.set(t, (res?.query?.categorymembers || []).map(m => fileKey(m.title)));
});
await fetchInfo([...category.values()].flat());
console.log(`Commons categories searched for ${needsMore.length} articles`);

function usable(f) {
  if (EXCLUDE.has(f)) return { ok: false, why: 'rejected in review' };
  const i = info.get(f);
  if (!i) return { ok: false, why: 'not on Commons' };
  if (!/^image\/(jpeg|png|webp|tiff)$/.test(i.mime)) return { ok: false, why: 'type ' + i.mime };
  if (MEDIA.test(f) || JUNK.test(f.replace(/\.[a-z]+$/i, ''))) return { ok: false, why: 'not a photo' };
  const lic = strip(i.md.LicenseShortName);
  if (String(i.md.NonFree).toLowerCase() === 'true' || !FREE.test(lic)) return { ok: false, why: 'licence ' + lic };
  if (i.w < MIN_WIDTH) return { ok: false, why: `${i.w}px wide` };
  const ratio = i.w / i.h;
  if (ratio > 2.6 || ratio < 0.45) return { ok: false, why: 'shape ' + ratio.toFixed(2) };
  // Files narrower than 500 px have no 500 px thumbnail; the site shows the original.
  if (!i.thumb500 || (!/\/thumb\//.test(i.thumb500) && (i.w >= 500 || !/^image\/(jpeg|png|webp)$/.test(i.mime)))) return { ok: false, why: 'no thumbnail' };
  return { ok: true };
}

// Commons author fields carry boilerplate and wiki markup that reads badly in a credit
// line: "No machine-readable author provided. X assumed (based on copyright claims).",
// "Unknown author Unknown author", "( talk )", "( contact me )", "([https://… facebook]".
function cleanArtist(raw) {
  let a = String(raw || '')
    .replace(/No machine-readable author provided\.\s*(.+?)\s+assumed \(based on copyright claims\)\.?/i, '$1')
    .replace(/\s*\(\s*\[?https?:\/\/\S+.*$/i, '')
    .replace(/\(\s*(talk|diskussion|discussion|contribs|contact me|msg)\s*\)/gi, '')
    .replace(/\s+([,.;:)])/g, '$1').replace(/\(\s+/g, '(')
    .replace(/\s{2,}/g, ' ').replace(/[\s,;]+$/, '').trim();
  if (/^(unknown( author| artist| photographer)?\s*){1,2}$/i.test(a) || !a) a = 'Unknown author';
  return a;
}

function describe(f, via, extra = {}) {
  const i = info.get(f);
  // The API now answers with thumb.wikimedia.org URLs carrying utm_ query strings; use the
  // canonical upload.wikimedia.org host without them.
  const clean = u => u && u.split('?')[0].replace('://thumb.wikimedia.org/', '://upload.wikimedia.org/');
  const template = clean(i.thumb500).replace(/\/((?:lossy-|lossless-)?(?:page\d+-)?)500px-([^/]+)$/, '/$1{w}px-$2');
  const widths = WIDTHS.filter(w => w <= i.w);
  // Browsers cannot show TIFF; a JPEG/PNG/WebP original narrower than 1920 px and under
  // 3 MB is offered as the largest size.
  const original = /^image\/(jpeg|png|webp)$/.test(i.mime) && i.w < 1920 && i.size < 3e6 ? clean(i.url) : null;
  const artist = clip(cleanArtist(strip(i.md.Artist) || strip(i.md.Credit)), 90);
  const title = clip(strip(i.md.ObjectName) || f.replace(/\.[a-z]+$/i, '').replace(/_/g, ' '), 70);
  return {
    file: i.file, page: clean(i.page), w: i.w, h: i.h, thumb: template, widths, original,
    title, artist, licence: strip(i.md.LicenseShortName), licenceUrl: strip(i.md.LicenseUrl) || null, via, ...extra,
  };
}

// 5. Choose. Favourites first so they get first pick of shared images, then A to Z.
const order = [...genres].sort((a, b) => {
  const fa = FAVOURITES.indexOf(a.slug), fb = FAVOURITES.indexOf(b.slug);
  return (fa < 0 ? 1e9 : fa) - (fb < 0 ? 1e9 : fb) || a.name.localeCompare(b.name);
});
const used = new Map(); // file -> genre name
const report = [];
for (const g of order) {
  const { forced, files } = candidatesOf(g);
  const o = OVERRIDES[g.name];
  let chosen = null;
  const rejected = [];
  if (forced) {
    const f = files[0];
    if (f) {
      const u = usable(f);
      if (!u.ok && !/px wide|shape/.test(u.why)) throw new Error(`Override for ${g.name} (${f}) is not usable: ${u.why}`);
      chosen = describe(f, 'override', o.position ? { position: o.position } : {});
    }
  } else {
    const ok = files.filter(c => { const u = usable(c.f); if (!u.ok && c.via !== 'commons-category') rejected.push(`${c.f}: ${u.why}`); return u.ok; });
    // Never show the same photo on two genres: a genre whose only usable photos are taken gets the poster.
    const all = ok.filter(c => !used.has(c.f));
    if (!all.length && ok.length) rejected.push(`all usable photos already used by ${used.get(ok[0].f)}`);
    // The article's own images first; the Commons category only when they are missing or small.
    const primary = all.filter(c => c.via !== 'commons-category');
    const widest = list => [...list].sort((a, b) => info.get(b.f).w - info.get(a.f).w)[0];
    const pool = primary.length && info.get(widest(primary).f).w >= PRIMARY_ENOUGH ? primary : all;
    const pick = pool.length ? pool.find(c => info.get(c.f).w >= GOOD_WIDTH) || widest(pool) : null;
    if (pick) chosen = describe(pick.f, pick.via, o?.position ? { position: o.position } : {});
  }
  if (chosen) used.set(chosen.file, used.get(chosen.file) || g.name);
  g.image = chosen;
  report.push({ name: g.name, article: g.wiki?.title || null, via: chosen?.via || 'poster', file: chosen?.file || null, size: chosen ? `${chosen.w}x${chosen.h}` : null, licence: chosen?.licence || null, sharedWith: chosen && used.get(chosen.file) !== g.name ? used.get(chosen.file) : null, rejected: rejected.slice(0, 6) });
}

console.log('Chosen; checking thumbnails');

// 6. Check that each chosen file serves a thumbnail (one request per image, paced, since
// upload.wikimedia.org rate-limits bursts). 400/404 means the URL is wrong: use the poster.
// 429 or a network error after retries proves nothing either way, so the image is kept and
// listed as unverified in the report.
const thumbUrl = (img, w) => img.thumb.replace('{w}', w);
const failures = [], unverified = [];
let checked = 0;
// A thumbnail that answered 200 in the last 24 hours is not asked again (reruns on the same
// day would otherwise hit the rate limit); anything older is checked again.
const OK_FILE = new URL('./.cache/thumbs-ok.json', import.meta.url).pathname;
const okBefore = readJson(OK_FILE, {});
const okNow = {};
await mapLimit(genres.filter(g => g.image), 1, async g => {
  const url = g.image.widths.length ? thumbUrl(g.image, g.image.widths[0]) : g.image.original;
  if (Date.now() - (okBefore[url] || 0) < 864e5) { okNow[url] = okBefore[url]; return; }
  let status = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt ? 4000 * attempt : 450);
    try { status = (await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA, Referer: 'https://jerryshi042003.github.io/' }, signal: AbortSignal.timeout(20000) })).status; } catch { status = 0; }
    if (status === 200 || status === 400 || status === 404) break;
  }
  if (++checked % 100 === 0) console.log(`  ${checked} thumbnails checked`);
  if (status === 200) okNow[url] = Date.now();
  if (status === 400 || status === 404) { failures.push(`${g.name}: ${status} ${url}`); g.image = null; }
  else if (status !== 200) unverified.push(`${g.name}: ${status} ${url}`);
});

writeJson(OK_FILE, okNow, false);

// CREDITS.md: every photo the site shows, with its author, licence and Commons page.
const mdEscape = s => String(s).replace(/([\\`*_[\]|<>])/g, '\\$1');
const credited = genres.filter(g => g.image).sort((a, b) => a.name.localeCompare(b.name, 'en'));
writeFileSync(ROOT + 'CREDITS.md', [
  '# Photo credits',
  '',
  `Orfeu shows ${credited.length} photos from Wikimedia Commons, one per genre page. Each page credits its photo under the picture; this list is generated by \`pipeline/build-images.mjs\`. The genres without a free photo (${genres.length - credited.length}) show a drawn poster instead.`,
  '',
  '| Genre | Photo | Author | Licence |',
  '|---|---|---|---|',
  ...credited.map(g => `| ${mdEscape(g.name)} | [${mdEscape(g.image.title)}](${g.image.page}) | ${mdEscape(g.image.artist)} | ${g.image.licenceUrl ? `[${mdEscape(g.image.licence)}](${g.image.licenceUrl})` : mdEscape(g.image.licence)} |`),
  '',
].join('\n'));
writeJson(GENRES, data, false);
const tally = genres.reduce((m, g) => ((m[g.image?.via || 'poster'] = (m[g.image?.via || 'poster'] || 0) + 1), m), {});
writeJson(ROOT + 'pipeline/reports/images-report.json', { built: new Date().toISOString(), tally, failures, unverified, genres: report.sort((a, b) => a.name.localeCompare(b.name)) });
console.log('Images:', tally);
if (failures.length) console.log('Thumbnail check failed (poster used):\n ' + failures.join('\n '));
if (unverified.length) console.log(`${unverified.length} thumbnails could not be checked (rate-limited); kept:\n ` + unverified.join('\n '));
