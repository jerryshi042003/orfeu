// Builds assets/data/genres.json from pipeline/source/filteredPulse.csv plus the few
// extra Pulse genres in extra-genres.json.
//
// - Reads pipeline/reports/playlists-audit.json (run audit-playlists.mjs first): a genre
//   whose playlist failed the audit is cut, and a genre whose playlist Spotify renamed
//   takes the playlist's current name ("Forro" -> "Forró", "Pipe Band" -> "Bagpipe").
// - Finds a Wikipedia article that is actually about the music, not a disambiguation page
//   or an unrelated topic that happens to share the name (for example "Carnatic" ->
//   "Carnatic music", not the "Carnatic may refer to..." page).
// - Adds a URL slug and the families the Explore filters use.
//
// Usage: node build-genres.mjs
import { readCsv, readJson, writeJson, fold, getJson, mapLimit, playlistId, slugify } from './lib.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = ROOT + 'pipeline/source/filteredPulse.csv';
const OUT = ROOT + 'assets/data/genres.json';
// Reviewed exceptions: { "Genre": { "title": "Wikipedia title" | null, "reason": "..." } }.
const OVERRIDES = readJson(ROOT + 'pipeline/wiki-overrides.json', {});
const AUDIT = readJson(ROOT + 'pipeline/reports/playlists-audit.json', null);
if (!AUDIT) throw new Error('Run audit-playlists.mjs first: pipeline/reports/playlists-audit.json is missing');
const audited = new Map(AUDIT.items.filter(r => r.kind === 'genre').map(r => [r.id, r]));
const EXTRA = readJson(ROOT + 'pipeline/extra-genres.json', { genres: [] }).genres;

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

async function resolve(name, display = name) {
  const tried = [];
  const key = [display, name].find(k => Object.prototype.hasOwnProperty.call(OVERRIDES, k));
  if (key) {
    const forced = OVERRIDES[key].title;
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

// Families for the Explore filters: a reviewed entry in family-overrides.json first, then
// the genre's own name; only when both say nothing, the opening of its Wikipedia article.
const FAMILIES = [
  ['rock', 'Rock', /rock|grunge|shoegaze|britpop|indie|garage rock|garage punk|psychedel|\bsurf|\bemo\b|krautrock|new wave|post-punk|madchester|c86|jangle|freakbeat|merseybeat|mod revival|noise pop|dream pop|slowcore|space rock|art rock|\bprog\b|progressive rock|jam band/i],
  ['metal-punk', 'Metal & punk', /metal|punk|hardcore|grind|djent|thrash|doom|sludge|crust|screamo|powerviolence|\boi\b|deathcore|neue deutsche h|black ?gaze|drone|noise|industrial|zeuhl/i],
  ['pop', 'Pop', /pop\b|boy band|girl group|idol|schlager|europop|italo|chanson|teen|adult standards|easy listening|iskelm|dansband|la[iï]ko|levenslied|cabaret|lounge|exotica|tin pan|brill building|crooner|vocal jazz|sunshine|barbershop|napoletan|dansktop|mellow gold/i],
  ['hip-hop', 'Hip hop', /hip[- ]?hop|\brap\b|rap$|\btrap\b|grime|\bdrill|crunk|hyphy|g funk|gangst|turntabl|boom bap|horrorcore|bounce|phonk|chopped|screw/i],
  ['electronic', 'Electronic', /house|techno|trance|electr|edm|dubstep|drum and bass|jungle|breakbeat|ambient|idm|intelligent dance|downtempo|trip hop|synth|chiptune|bassline|hardstyle|gabber|disco|glitch|vaporwave|witch house|big beat|eurobeat|hi-nrg|minimal techno|footwork|juke|moombahton|kuduro|rave|lo-fi|chillwave|dark ?wave|tekno|new beat|ebm|hardcore techno|happy hardcore|uk garage|2-step|speed garage|dub techno|acid|balearic|broken beat|nu jazz|future/i],
  ['jazz-blues', 'Jazz & blues', /jazz|blues|swing|bebop|\bbop|big band|brass band|dixieland|ragtime|boogie|stride|bossa nova|free improvisation/i],
  ['soul-funk', 'Soul & funk', /soul|funk|r&b|rhythm and blues|motown|gospel|doo-?wop|new jack|quiet storm|disco|boogaloo/i],
  ['folk-country', 'Folk & country', /folk|country|bluegrass|americana|cajun|zydeco|celtic|irish|scottish|appalachian|old-time|honky|outlaw|western|singer-songwriter|shant|polka|bagpipe|pipe band|skiffle|fado|rebetiko|accordion|yodel|newgrass|fingerstyle/i],
  ['latin', 'Latin & Spanish', /latin|salsa|cumbia|reggaet|bachata|merengue|tango|bolero|mariachi|ranchera|norte[nñ]o|\bbanda\b|corrido|son cubano|cuban|mambo|cha-cha|vallenato|tejano|nueva canci|flamenco|rumba|tropical|mexican|m[uú]sica mexicana|duranguense|spanish|argentin|chilean|colombian|peruvian|puerto ric|dominican|timba|joropo|copla|trova|guaracha|bomba|plena|latino/i],
  ['brazilian', 'Brazilian', /brazil|samba|bossa|pagode|forr[oó]|\bmpb\b|ax[eé](?![a-z])|sertanejo|choro|frevo|bai[aã]o|carioca|funk das|tropic[aá]lia|lambada|maracatu|piseiro|brega|ostenta/i],
  ['classical', 'Classical', /classical|baroque|opera|orchestra|symphon|chamber|choir|choral|piano|string quartet|minimalism|renaissance|medieval|early music|requiem|sacred|organ|violin|cello|clarinet|harp|romantic era|avant-garde|musique|impressionis|serialism|neoclassical|soundtrack|score|military band|polyphon/i],
  ['world', 'World', /afro|africa|highlife|soukous|reggae|dancehall|\bska\b|calypso|soca|mento|zouk|bhangra|bollywood|filmi|qawwali|carnatic|hindustani|indian|arab|\bra[iï]\b|turkish|klezmer|balkan|chalga|gypsy|j-|k-|japan|korea|chin|enka|gamelan|world|kizomba|mbalax|gnawa|desert|tuareg|hawai|polynes|maori|aborig|tuvan|throat|persian|greek|celtic|flamenco|mandopop|cantopop|v-pop|thai|indonesia|filipin|opm|dangdut|kwaito|amapiano|gqom|zouglou|coup[eé]|rumba congo|benga|taarab|chaabi|dabke|mizrahi|anatolian|bulgarian|romanian|manele|turbo|sevdah|kompa|semba|klapa|yoik|steelpan|napoletan/i],
];
const FAMILY_OVERRIDES = readJson(ROOT + 'pipeline/family-overrides.json', { families: {} }).families;
export function familiesOf(name, extract = '', display = name) {
  if (FAMILY_OVERRIDES[display]) return FAMILY_OVERRIDES[display];
  const byName = FAMILIES.filter(([, , re]) => re.test(name)).map(([id]) => id);
  if (byName.length) return byName;
  const lead = (extract || '').split(/(?<=[.!?])\s/).slice(0, 2).join(' ');
  const byText = FAMILIES.filter(([, , re]) => re.test(lead)).map(([id]) => id);
  return byText.length ? byText.slice(0, 2) : ['other'];
}
export const FAMILY_LABELS = Object.fromEntries([...FAMILIES.map(([id, label]) => [id, label]), ['other', 'Other']]);

const rows = [
  ...readCsv(SOURCE).slice(1).map(([name, uri, web]) => ({ name: name.trim(), id: playlistId(web) || playlistId(uri) })),
  ...EXTRA.map(e => ({ name: e.name, id: AUDIT.items.find(r => r.kind === 'genre' && r.extra && r.name === e.name)?.id, extra: e })),
];
const log = [];
const cut = [];
const kept = rows.filter(r => {
  const a = audited.get(r.id);
  if (!a) throw new Error(`${r.name} (${r.id}) is not in the playlist audit; rerun audit-playlists.mjs`);
  if (a.verdict === 'error') throw new Error(`${r.name}: Spotify could not be reached during the audit; rerun it`);
  if (a.verdict === 'cut') { cut.push({ name: r.name, id: r.id, reasons: a.reasons, tracks: a.tracks, playable: a.playable }); return false; }
  return true;
});
const items = await mapLimit(kept, 2, async r => {
  const a = audited.get(r.id);
  const display = a.verdict === 'rename' || a.verdict === 'drift' ? a.current : r.name;
  let wiki = null, tried = ['extra:none'];
  if (!r.extra) ({ wiki, tried } = await resolve(r.name, display));
  else if (r.extra.wiki) {
    // extra-genres.json names a reviewed article, like an override.
    const s = await summary(r.extra.wiki);
    if (!s || s.type !== 'standard') throw new Error(`Extra genre ${r.name} -> ${r.extra.wiki} is not a standard article`);
    wiki = pick(s); tried = ['extra:' + r.extra.wiki];
  }
  log.push({ name: display, source: r.name, wiki: wiki?.title ?? null, verdict: a.verdict, playlistTitle: a.title, tried });
  return {
    name: display,
    ...(display !== r.name ? { formerly: r.name } : {}),
    playlist: `https://open.spotify.com/playlist/${r.id}`,
    playlistTitle: a.title,
    tracks: a.tracks,
    wiki,
    family: familiesOf(display + ' ' + r.name, wiki?.extract, display),
    ...(r.extra ? { extra: true } : {}),
  };
});

// Slugs: unique, stable for a given name.
const seen = new Set();
for (const g of items.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
  let slug = slugify(g.name), n = 2;
  while (seen.has(slug)) slug = slugify(g.name) + '-' + n++;
  seen.add(slug);
  g.slug = slug;
}
const genres = items.map(({ slug, ...rest }) => ({ slug, ...rest }));

writeJson(OUT, { source: 'pipeline/source/filteredPulse.csv + pipeline/extra-genres.json', generated: new Date().toISOString().slice(0, 10), audited: AUDIT.checkedAt.slice(0, 10), families: FAMILY_LABELS, genres }, false);
writeJson(ROOT + 'pipeline/reports/genres-report.json', { kept: genres.length, cut, renamed: genres.filter(g => g.formerly).map(g => `${g.formerly} -> ${g.name}`), genres: log.sort((a, b) => a.name.localeCompare(b.name)) });
const noWiki = genres.filter(g => !g.wiki).map(g => g.name);
console.log(`${genres.length} genres kept, ${cut.length} cut; ${genres.length - noWiki.length} with a Wikipedia description`);
console.log('Cut:', cut.map(c => `${c.name} (${c.reasons.join(',')})`).join('; '));
console.log('Renamed:', genres.filter(g => g.formerly).map(g => `${g.formerly} -> ${g.name}`).join('; '));
console.log('No description:', noWiki.join(', '));
const fam = {};
for (const g of genres) for (const f of g.family) fam[f] = (fam[f] || 0) + 1;
console.log('Families:', JSON.stringify(fam));
