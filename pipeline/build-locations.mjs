// Builds assets/data/locations.json and assets/map/world.svg from
// pipeline/source/passed_rows.csv.
//
// - Drops rows that are not places (the "Christmas" playlists, "Everything",
//   "Hatecore") and playlists Spotify no longer serves.
// - Geocodes each place once with OpenStreetMap Nominatim (results are cached in
//   pipeline/geocode-cache.json, which is committed, so rebuilds make no requests for
//   places already seen). A result is only kept when OpenStreetMap places it in the
//   country the playlist names.
// - Projects every point onto the same Equal Earth map that world.svg draws, so the
//   site needs no mapping library at runtime.
//
// Usage: node build-locations.mjs [--skip-spotify]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import { readCsv, readJson, writeJson, fold, sleep, UA, mapLimit, playlistId, checkPlaylist } from './lib.mjs';

const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname;
const SOURCE = ROOT + 'pipeline/source/passed_rows.csv';
const CACHE_FILE = ROOT + 'pipeline/geocode-cache.json';
const SKIP_SPOTIFY = process.argv.includes('--skip-spotify');

// "APO Armed Forces Europe, Middle East, & Canada US" is a military postal zone, not a place.
const NOT_PLACES = /christmas|^everything$|^hatecore$|^"?APO /i;

const US_STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'Puerto Rico', 'District of Columbia'];

// ISO 3166-1 alpha-2 -> numeric (world-atlas uses numeric ids).
const NUMERIC = { AR: '032', AT: '040', AU: '036', BE: '056', BG: '100', BO: '068', BR: '076', CA: '124', CH: '756', CL: '152', CN: '156', CO: '170', CR: '188', CY: '196', CZ: '203', DE: '276', DK: '208', DO: '214', EC: '218', EE: '233', EG: '818', ES: '724', FI: '246', FO: '234', FR: '250', GB: '826', GR: '300', GT: '320', HK: '344', HN: '340', HR: '191', HU: '348', ID: '360', IE: '372', IL: '376', IN: '356', IR: '364', IS: '352', IT: '380', KR: '410', LT: '440', LU: '442', LV: '428', MA: '504', MX: '484', MY: '458', NL: '528', NO: '578', NZ: '554', PA: '591', PE: '604', PH: '608', PL: '616', PR: '630', PT: '620', PY: '600', RO: '642', RS: '688', RU: '643', SE: '752', SG: '702', SK: '703', SV: '222', TH: '764', TR: '792', TW: '158', US: '840', UY: '858', VE: '862', ZA: '710' };
// OpenStreetMap files some territories under their own code.
const ALSO_ACCEPT = { US: ['us', 'pr'], DK: ['dk', 'fo', 'gl'], HK: ['hk', 'cn'] };

const regionName = new Intl.DisplayNames(['en'], { type: 'region' });
const COUNTRY_ALIASES = { 'united states of america': 'US', 'czech republic': 'CZ', 'hong kong': 'HK', turkey: 'TR', polska: 'PL' };
function countryCodeFromName(name) {
  const key = name.replace(/^the\s+/i, '').toLowerCase();
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  return Object.keys(NUMERIC).find(code => regionName.of(code).toLowerCase() === key) || null;
}
const countryName = code => ({ US: 'United States', HK: 'Hong Kong', TR: 'Türkiye', CZ: 'Czechia', KR: 'South Korea' }[code] || regionName.of(code));

function parse(raw) {
  const m = raw.match(/^(.*) ([A-Z]{2})$/);
  if (!m) {
    const code = countryCodeFromName(raw);
    return code ? { kind: 'country', place: raw.replace(/^the\s+/i, ''), region: null, code } : null;
  }
  let [, rest, code] = m;
  let region = null;
  if (code === 'US') {
    const state = US_STATES.slice().sort((a, b) => b.length - a.length).find(s => rest.endsWith(' ' + s));
    if (state) { region = state; rest = rest.slice(0, -state.length - 1); }
  }
  return { kind: 'city', place: rest.replace(/^"/, '').trim(), region, code };
}

const SETTLEMENT = /^(city|town|village|municipality|suburb|borough|city_district|quarter|neighbourhood|hamlet|county|state|state_district|province|administrative|country|region|census|statistical|district|territory)$/;
// Names that geocode to a different, better-known place without more context.
const QUERY_HINTS = {
  'Aalesund NO': 'Ålesund',
  'Montreuil FR': 'Montreuil, Seine-Saint-Denis',
  'Saint Kilda AU': 'St Kilda, Victoria',
  'Nunez AR': 'Núñez, Buenos Aires',
  'Parana AR': 'Paraná, Entre Ríos',
};

const cache = readJson(CACHE_FILE, {});
let lastRequest = 0;
async function geocode(entry) {
  const key = `${entry.place}|${entry.region || ''}|${entry.code}`;
  if (QUERY_HINTS[entry.source] && cache[key] && cache[key].query !== QUERY_HINTS[entry.source]) delete cache[key];
  if (cache[key] !== undefined) return cache[key];
  const params = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'en' });
  if (entry.kind === 'country') { params.set('country', entry.place); params.set('featureType', 'country'); }
  else {
    params.set('q', QUERY_HINTS[entry.source] || [entry.place, entry.region].filter(Boolean).join(', '));
    params.set('countrycodes', (ALSO_ACCEPT[entry.code] || [entry.code.toLowerCase()]).join(','));
  }
  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  const res = await fetch('https://nominatim.openstreetmap.org/search?' + params, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for ${key}`);
  let results = await res.json();
  if (!results.length && entry.kind === 'country') {
    // "Hong Kong" is not tagged as a country in OpenStreetMap; fall back to a plain search.
    await sleep(1100);
    lastRequest = Date.now();
    const retry = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', limit: '5', 'accept-language': 'en', q: entry.place });
    results = await (await fetch('https://nominatim.openstreetmap.org/search?' + retry, { headers: { 'User-Agent': UA } })).json();
  }
  const accepted = ALSO_ACCEPT[entry.code] || [entry.code.toLowerCase()];
  // Prefer a settlement or administrative area over a shop, station or road that shares
  // the name ("Aalesund Protective Wear AS", "Iligan City" road on the wrong island).
  const inCountry = results.filter(r => accepted.includes(r.address?.country_code));
  const hit = inCountry.find(r => SETTLEMENT.test(r.addresstype || r.type)) || inCountry[0];
  cache[key] = hit ? { lat: +(+hit.lat).toFixed(4), lon: +(+hit.lon).toFixed(4), name: hit.name, osm: `${hit.osm_type}/${hit.osm_id}`, type: hit.addresstype || hit.type, ...(QUERY_HINTS[entry.source] ? { query: QUERY_HINTS[entry.source] } : {}) } : null;
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1) + '\n');
  return cache[key];
}

// Map: Equal Earth projection of Natural Earth 1:110m countries, Antarctica removed.
const W = 960, H = 470;
const world = require('world-atlas/countries-110m.json');
const countries = feature(world, world.objects.countries).features.filter(f => f.id !== '010');
const projection = geoEqualEarth().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'FeatureCollection', features: countries });
const path = geoPath(projection).digits(1);

const rows = readCsv(SOURCE).slice(1);
const skipped = { notPlace: [], unparsed: [], dead: [], noGeo: [] };
const parsed = [];
for (const [sourceIndex, [raw, uri, web]] of rows.entries()) {
  const name = raw.trim();
  if (NOT_PLACES.test(name)) { skipped.notPlace.push(name); continue; }
  const entry = parse(name);
  if (!entry) { skipped.unparsed.push(name); continue; }
  parsed.push({ source: name, sourceIndex, id: playlistId(web) || playlistId(uri), ...entry });
}

const checks = SKIP_SPOTIFY ? parsed.map(() => ({ live: true, title: null })) : await mapLimit(parsed, 2, p => checkPlaylist(p.id));
const locations = [];
for (const [i, p] of parsed.entries()) {
  if (!checks[i].live) { skipped.dead.push(p.source); continue; }
  const geo = await geocode(p);
  if (!geo) { skipped.noGeo.push(p.source); }
  // Keep the playlist's own spelling, but take OpenStreetMap's capitalisation when it is
  // the same name ("Aix-en-provence" -> "Aix-en-Provence").
  const place = geo && fold(geo.name) === fold(p.place) ? geo.name : p.place;
  const [x, y] = geo ? projection([geo.lon, geo.lat]).map(v => Math.round(v * 10) / 10) : [null, null];
  locations.push({
    name: p.kind === 'country' ? countryName(p.code) : place,
    region: p.region,
    country: p.kind === 'country' ? null : countryName(p.code),
    code: p.code,
    map: NUMERIC[p.code] || null,
    kind: p.kind,
    playlist: `https://open.spotify.com/playlist/${p.id}`,
    playlistTitle: checks[i].title,
    point: geo ? { x, y, lat: geo.lat, lon: geo.lon } : null,
    source: p.source,
    sourceIndex: p.sourceIndex,
  });
}

writeJson(ROOT + 'assets/data/locations.json', { source: 'pipeline/source/passed_rows.csv', sourceCount: rows.length, generated: new Date().toISOString().slice(0, 10), width: W, height: H, locations }, false);

// The SVG: one path per country, id "c" + ISO numeric code. The page zooms the viewBox
// to the day's place.
const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`, '<g class="land">',
  ...countries.map(f => `<path id="c${f.id}" d="${path(f)}"><title>${f.properties.name}</title></path>`), '</g></svg>'].join('\n');
mkdirSync(ROOT + 'assets/map', { recursive: true });
writeFileSync(ROOT + 'assets/map/world.svg', svg + '\n');

writeJson(ROOT + 'pipeline/reports/locations-report.json', { kept: locations.length, skipped, unmapped: locations.filter(l => !l.point).map(l => l.source) });
console.log(`${locations.length} locations kept. Skipped: ${Object.entries(skipped).map(([k, v]) => `${k}=${v.length}`).join(', ')}`);
for (const [k, v] of Object.entries(skipped)) if (v.length) console.log(` ${k}: ${v.join('; ')}`);
