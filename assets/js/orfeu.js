// Orfeu: picks one genre and one place for each day and renders them.
// The data files are built ahead of time by pipeline/ (see README), so the page makes
// no third-party requests: Spotify and Wikipedia are only linked to.
(function () {
  'use strict';

  const page = document.body.dataset.page; // "genre" or "place"
  const base = document.body.dataset.root || './';
  const $ = id => document.getElementById(id);

  // ---- Dates -------------------------------------------------------------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

  function readDate() {
    const today = startOfDay(new Date());
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(new URLSearchParams(location.search).get('date') || '');
    if (!m) return { day: today, today };
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    if (isNaN(d) || iso(d) !== m[0] || d > today) return { day: today, today };
    return { day: d, today };
  }

  // Day number: 1 on 2026-01-01, counting up without resetting each year. During 2026 it
  // equals the day of the year the original site used, so 2026 picks are unchanged, but
  // later years keep moving through the lists instead of repeating the first 366 places.
  // Counted on calendar dates so daylight-saving changes cannot shift it.
  const dayNumber = d => Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2025, 11, 31)) / 86400000);

  function genreIndex(day, count) {
    const x = Math.sin(dayNumber(day)) * 10000;
    return Math.floor((x - Math.floor(x)) * count);
  }
  const placeIndex = (day, count) => ((dayNumber(day) % count) + count) % count;

  // ---- Rendering helpers --------------------------------------------------
  const longDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const fullDate = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  function renderDayNav(day, today) {
    const time = $('day-label');
    time.textContent = longDate.format(day);
    time.dateTime = iso(day);
    time.title = fullDate.format(day);
    const link = d => (iso(d) === iso(today) ? '?' : `?date=${iso(d)}`).replace(/^\?$/, location.pathname);
    $('day-prev').href = link(addDays(day, -1));
    const next = $('day-next');
    const isToday = iso(day) === iso(today);
    if (isToday) { next.setAttribute('aria-disabled', 'true'); next.removeAttribute('href'); }
    else next.href = link(addDays(day, 1));
    $('day-today').hidden = isToday;
    // Keep the chosen day when switching between Genre and Place.
    if (!isToday) document.querySelectorAll('.tabs a').forEach(a => { a.href = a.getAttribute('href') + `?date=${iso(day)}`; });
  }

  function setListen(url, title) {
    const a = $('listen');
    if (url) {
      a.href = url;
      a.removeAttribute('aria-disabled');
      $('listen-note').textContent = title ? `Playlist: ${title}` : '';
    } else {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      $('listen-note').textContent = 'This playlist is no longer on Spotify.';
    }
  }

  function showProblem() {
    $('pick-name').removeAttribute('aria-busy');
    $('pick-name').textContent = 'Not available';
    const p = $('problem');
    p.hidden = false;
  }

  async function load(path) {
    const res = await fetch(base + path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
  }

  const fold = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*\((music|genre|music genre)\)$/, '').replace(/ music$/, '').replace(/[^a-z0-9]/g, '');

  // ---- Genre page ---------------------------------------------------------
  async function renderGenre(day) {
    const { genres } = await load('assets/data/genres.json');
    // Start at the day's pick; if its playlist is gone, use the next genre that has one.
    const start = genreIndex(day, genres.length);
    let genre = genres[start];
    for (let i = 0; i < genres.length && !genre.playlist; i++) genre = genres[(start + i + 1) % genres.length];

    const name = $('pick-name');
    name.textContent = genre.name;
    name.removeAttribute('aria-busy');
    name.classList.add('reveal');
    document.title = `${genre.name} · Orfeu`;
    setListen(genre.playlist, genre.playlistTitle);

    $('about-title').textContent = `About ${genre.name}`;
    const text = $('about-text');
    const source = $('about-source');
    if (genre.wiki) {
      text.textContent = genre.wiki.extract;
      const same = fold(genre.wiki.title) === fold(genre.name);
      source.innerHTML = '';
      source.append(same ? 'From Wikipedia: ' : 'Closest Wikipedia article: ', extLink(genre.wiki.url, genre.wiki.title), ' (CC BY-SA)');
    } else {
      text.textContent = 'No Wikipedia article matches this genre yet, so let the playlist introduce it.';
      source.innerHTML = '';
      source.append(extLink(`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(genre.name + ' music')}`, 'Search Wikipedia'));
    }
    $('about').hidden = false;
  }

  // ---- Place page ---------------------------------------------------------
  async function renderPlace(day) {
    const [data, svgText] = await Promise.all([
      load('assets/data/locations.json'),
      fetch(base + 'assets/map/world.svg').then(r => (r.ok ? r.text() : '')).catch(() => ''),
    ]);
    const { locations, sourceCount } = data;
    // The original list had a few rows that were not places or whose playlists are gone;
    // take the first remaining place at or after the day's position in that list.
    const target = placeIndex(day, sourceCount);
    const place = locations.find(l => l.sourceIndex >= target) || locations[0];

    const name = $('pick-name');
    name.textContent = place.name;
    name.removeAttribute('aria-busy');
    name.classList.add('reveal');
    $('pick-where').textContent = [place.region, place.country].filter(Boolean).join(', ');
    document.title = `${place.name} · Orfeu`;
    setListen(place.playlist, place.playlistTitle);

    const figure = $('map');
    if (svgText && place.point) {
      $('map-frame').innerHTML = svgText;
      const svg = figure.querySelector('svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `World map marking ${place.name}${place.country ? ', ' + place.country : ''}`);
      svg.querySelectorAll('title').forEach(t => t.remove());
      const country = place.map && svg.querySelector(`#c${place.map}`);
      if (country) country.classList.add('is-here');
      figure.hidden = false; // getBBox() needs the map to be rendered
      const view = mapWindow(svg, country, place, data.width);
      svg.setAttribute('viewBox', view.join(' '));
      const ns = 'http://www.w3.org/2000/svg';
      const g = document.createElementNS(ns, 'g');
      const r = view[2] / 90;
      for (const [cls, radius] of [['pin-ring', r], ['pin-dot', r]]) {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('class', cls);
        c.setAttribute('cx', place.point.x);
        c.setAttribute('cy', place.point.y);
        c.setAttribute('r', radius);
        g.append(c);
      }
      svg.append(g);
      const { lat, lon } = place.point;
      $('map-caption').textContent = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
      figure.hidden = false;
    }
  }

  // Zoom the world map to the place: a country's whole outline, or a window around a
  // city (big countries like the United States would otherwise shrink the city to a dot
  // on a continent). Returns an SVG viewBox [x, y, width, height] with a 16:10 shape.
  function mapWindow(svg, country, place, worldWidth) {
    const { x, y } = place.point;
    let box = { x, y, width: 0, height: 0 };
    if (country) {
      const b = country.getBBox();
      const tooBig = place.kind === 'city' && (b.width > 140 || b.height > 90);
      if (b.width > 0 && !tooBig) box = b;
    }
    const x0 = Math.min(box.x, x), y0 = Math.min(box.y, y);
    const x1 = Math.max(box.x + box.width, x), y1 = Math.max(box.y + box.height, y);
    let w = Math.max((x1 - x0) * 1.5, place.kind === 'city' ? 110 : 90);
    let h = Math.max((y1 - y0) * 1.5, 50);
    if (w / h < 1.6) w = h * 1.6; else h = w / 1.6;
    w = Math.min(w, worldWidth); h = w / 1.6;
    const r = v => Math.round(v * 10) / 10;
    return [r((x0 + x1) / 2 - w / 2), r((y0 + y1) / 2 - h / 2), r(w), r(h)];
  }

  function extLink(href, label) {
    const a = document.createElement('a');
    a.href = href;
    a.className = 'ext';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    const hint = document.createElement('span');
    hint.className = 'visually-hidden';
    hint.textContent = ' (opens in a new tab)';
    a.append(hint);
    return a;
  }

  // ---- Start --------------------------------------------------------------
  const { day, today } = readDate();
  renderDayNav(day, today);
  $('problem-retry').addEventListener('click', () => location.reload());
  (page === 'place' ? renderPlace(day) : renderGenre(day)).catch(err => {
    console.error('Orfeu could not load its data.', err);
    showProblem();
  });
})();
