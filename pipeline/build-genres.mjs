// Builds assets/data/genres.json from pipeline/source/filteredPulse.csv.
//
// For every genre it finds a Wikipedia article that is actually about the music,
// not a disambiguation page or an unrelated topic that happens to share the name
// (for example "Carnatic" -> "Carnatic music", not the "Carnatic may refer to..." page),
// and checks that the Spotify playlist still exists.
//
// Usage: node build-genres.mjs [--skip-spotify]
import { readCsv, readJson, writeJson, fold, getJson, mapLimit, playlistId, checkPlaylist } from './lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = ROOT + 'pipeline/source/filteredPulse.csv';
const OUT = ROOT + 'assets/data/genres.json';
// Reviewed exceptions: { "Genre": { "title": "Wikipedia title" | null, "reason": "..." } }.
const OVERRIDES = readJson(ROOT + 'pipeline/wiki-overrides.json', {});
const SKIP_SPOTIFY = process.argv.includes('--skip-spotify');

// Words that show an article is about music. Checked against the short description
// and the opening of the extract.
const MUSIC = /\b(music|musical|musicians?|genre|songs?|singing|singers?|vocal|bands?|instrument(al)?|jazz|blues|rock|pop|punk|metal|hip[- ]hop|rap|reggae|funk|soul|folk|disco|techno|house|dance|rhythm|melod\w*|orchestra\w*|choir|choral|opera|composer|harmony|polyphony|sound|record(ings?)?|albums?|radio format|dj|turntabl\w*|guitar|piano|drum\w*|shoegaze|chiptune|beats?)\b/i;

// Short-description head nouns that mean the article is about one thing (a magazine,
// a band, a venue) rather than a style of music: "Danish hip-hop group", "Defunct
// entertainment magazine".
const ENTITY_HEAD = /^(magazine|newspaper|nightclub|festival|series|program|programme|corporation|label|album|single|movie|game|novel|book|band|group|duo|trio|rapper|singer|songwriter|musician|producer|politician|footballer|actor|actress|city|town|village|municipality|region|province|river|mountain|ship)$/i;
// The same idea for the first sentence: "X was a tabloid format entertainment magazine
// published in Boston", "X is an early childhood education music and movement program".
const ENTITY_LEAD = /^(magazine|newspaper|venue|nightclub|festival|series|program|programme|company|corporation|album|single|film|movie|show|game|novel|book|ship)$/i;

const summaryUrl = title => 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_'));

function firstSentence(text) {
  const m = (text || '').match(/^.*?[.!?](\s|$)/s);
  return (m ? m[0] : text || '').slice(0, 300);
}

// Decide whether a REST summary is a usable description of the genre.
export function judge(summary) {
  if (!summary) return 'missing';
  if (summary.type === 'disambiguation') return 'disambiguation';
  if (summary.type !== 'standard') return 'not-standard';
  const extract = (summary.extract || '').trim();
  if (!extract) return 'empty';
  if (/\b(may|most often|commonly|can) refer to\b/i.test(extract.slice(0, 200))) return 'disambiguation';
  const desc = summary.description || '';
  const lead = firstSentence(extract);
  // Some leads open with etymology ("Hyphy is Oakland slang meaning 'hyperactive'. It
  // describes the hip-hop music..."), so look a little past the first sentence.
  if (!MUSIC.test(desc) && !MUSIC.test(extract.slice(0, 320))) return 'off-topic';
  // Head noun of the short description: "Danish hip-hop group" -> group,
  // "1994 studio album by Beck" -> album. Collective phrases such as "Type of band" or
  // "Broad group of electronic-based music genres" describe a kind of thing, not one thing.
  const chunk = desc.split(/\s+(?:in|from|for|by|with|based|founded|formed|that|which|such)\s+|\s+\S+ing\s+/i)[0];
  if (!/\s+of\s+/i.test(chunk)) {
    const headWords = chunk.replace(/[^\p{L}\s-]/gu, '').trim().split(/\s+/);
    if (ENTITY_HEAD.test(headWords[headWords.length - 1] || '')) return 'entity';
  }
  const isA = lead.match(/\b(?:is|was|are|were)\s+(?:an?|the)\s+([^,;.]{0,100})/i);
  if (isA) {
    const words = isA[1].split(/\s+(?:of|for|from|in|on|at|that|which|with|by|where|who)\s+/i)[0].trim().split(/\s+/);
    while (words.length > 1 && /(ed|ing)$|^(based|located|run)$/i.test(words[words.length - 1])) words.pop();
    if (ENTITY_LEAD.test(words[words.length - 1].replace(/[^\p{L}]/gu, ''))) return 'entity';
  }
  return 'ok';
}

async function summary(title) {
  const { status, body } = await getJson(summaryUrl(title));
  return status === 200 ? body : null;
}

async function search(query) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=' + encodeURIComponent(query);
  const { body } = await getJson(url);
  return (body?.query?.search || []).map(r => r.title);
}

// Candidate titles in order of preference. Explicit music disambiguators come first so
// "Bachata" resolves to "Bachata (music)" instead of the dance or the disambiguation page.
function candidates(name) {
  const joined = name.includes(' ') ? [name[0] + name.slice(1).toLowerCase().replace(/ /g, '')] : []; // "Rock Steady" -> "Rocksteady"
  return [`${name} (music)`, `${name} (genre)`, `${name} (music genre)`, name, `${name} music`, ...joined];
}

const bareTitle = title => fold(title.replace(/\s*\((music|genre|music genre|musical genre|style)\)$/i, '').replace(/\s+music$/i, ''));
// A redirect to an article with a non-music qualifier is a redirect to one specific thing
// ("Armenian Folk" -> "Dashterov (project)"), not to a genre article.
function related(name, s) {
  const qualifier = (s.title.match(/\(([^)]+)\)$/) || [])[1];
  return !qualifier || /music|genre|style|dance/i.test(qualifier);
}

async function resolve(name) {
  const tried = [];
  if (Object.prototype.hasOwnProperty.call(OVERRIDES, name)) {
    const forced = OVERRIDES[name].title;
    if (forced === null) return { wiki: null, tried: ['override:none'] };
    // An override is a reviewed choice, so it only has to be a real article.
    const s = await summary(forced);
    if (!s || s.type !== 'standard') throw new Error(`Override for ${name} -> ${forced} is not a standard article`);
    return { wiki: pick(s), tried: ['override:' + forced] };
  }
  for (const title of candidates(name)) {
    const s = await summary(title);
    let verdict = judge(s);
    // "Pagode (music)" or "Abstract music" can redirect to a different article
    // ("Caipira pagode", "Absolute music"). Only the bare name may redirect elsewhere
    // ("R&B" -> "Rhythm and blues"); a qualified guess must land on the genre itself.
    if (verdict === 'ok' && title !== name && bareTitle(s.title) !== fold(name)) verdict = 'broader-redirect';
    // The bare name may redirect ("R&B" -> "Rhythm and blues", "Dutch House" -> "Electro
    // house"), but not to something unrelated ("Armenian Folk" -> "Dashterov (project)").
    if (verdict === 'ok' && title === name && !related(name, s)) verdict = 'unrelated-redirect';
    tried.push(`${title}:${verdict}${s && s.title !== title ? ' (' + s.title + ')' : ''}`);
    if (verdict === 'ok') return { wiki: pick(s), tried };
  }
  // Fall back to search, but only accept an article whose title is the genre's name
  // (ignoring case, accents, spacing, a trailing "music" and a "(music)"-style qualifier),
  // so a search cannot land on "Dark cabaret" for "Cabaret" or a film soundtrack.
  for (const title of await search(`${name} music genre`)) {
    if (bareTitle(title) !== fold(name)) continue;
    const s = await summary(title);
    const verdict = judge(s);
    tried.push(`search:${title}:${verdict}`);
    if (verdict === 'ok') return { wiki: pick(s), tried };
  }
  return { wiki: null, tried };
}

function pick(s) {
  return {
    title: s.title,
    url: s.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`,
    extract: trimExtract(s.extract),
  };
}

// Keep whole sentences up to about 650 characters; the page links to the full article.
function trimExtract(text) {
  const sentences = text.trim().replace(/\s*\n+\s*/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘(¡¿])/);
  let out = '';
  for (const sentence of sentences) {
    if (out && (out + ' ' + sentence).length > 650) break;
    out = out ? out + ' ' + sentence : sentence;
  }
  return out;
}

const rows = readCsv(SOURCE).slice(1);
const log = [];
const items = await mapLimit(rows, 2, async ([name, uri, web]) => {
  name = name.trim();
  const id = playlistId(web) || playlistId(uri);
  const { wiki, tried } = await resolve(name);
  let live = true, playlistTitle = null;
  if (!SKIP_SPOTIFY && id) ({ live, title: playlistTitle } = await checkPlaylist(id));
  log.push({ name, wiki: wiki?.title ?? null, live, playlistTitle, tried });
  return { name, playlist: id && live ? `https://open.spotify.com/playlist/${id}` : null, playlistTitle: live ? playlistTitle : null, wiki };
});

writeJson(OUT, { source: 'pipeline/source/filteredPulse.csv', generated: new Date().toISOString().slice(0, 10), genres: items }, false);
writeJson(ROOT + 'pipeline/reports/genres-report.json', log.sort((a, b) => a.name.localeCompare(b.name)));
const noWiki = items.filter(g => !g.wiki).map(g => g.name);
const dead = items.filter(g => !g.playlist).map(g => g.name);
console.log(`${items.length} genres; ${items.length - noWiki.length} with a Wikipedia description; ${dead.length} without a live playlist`);
console.log('No description:', noWiki.join(', '));
console.log('Dead playlist:', dead.join(', '));
