// Places: the place of the day (?date=) or any place (?p=slug), its map, nearby places,
// and an atlas of every place with search.
(async function () {
  'use strict';
  const O = window.Orfeu;
  const { $, el } = O;
  const params = new URLSearchParams(location.search);
  const fixed = params.get('p');
  const { day, today, isToday } = O.readDate();
  const NS = 'http://www.w3.org/2000/svg';

  let data, svgText, schedule;
  try {
    [data, svgText, schedule] = await Promise.all([O.data.places(), O.data.map().catch(() => ''), O.data.schedule().catch(() => null)]);
  } catch (err) {
    console.error('Orfeu could not load its data.', err);
    $('#pick-name').removeAttribute('aria-busy');
    $('#pick-name').textContent = 'Not available';
    $('#problem').hidden = false;
    $('#problem-retry').addEventListener('click', () => location.reload());
    return;
  }
  const places = data.locations;
  const bySlug = new Map(places.map(p => [p.slug, p]));
  let place = fixed ? bySlug.get(fixed) : O.scheduled(schedule, 'places', day, bySlug, places);
  const missing = fixed && !place;
  if (missing) place = O.scheduled(schedule, 'places', today, bySlug, places);
  document.body.dataset.place = place.slug;

  const where = p => [p.region, p.country].filter(Boolean).join(', ');
  renderDayNav();
  renderPlace();
  renderNearby();
  renderAtlas();
  if (missing) O.toast(`No place called “${fixed}” any more; here is today’s.`);

  function renderDayNav() {
    const label = $('#day-label');
    if (fixed && !missing) {
      $('#kicker').textContent = place.kind === 'country' ? 'Country' : 'City';
      label.hidden = true;
      label.previousSibling.textContent = '';
      $('#day-prev').hidden = true;
      $('#day-next').hidden = true;
      const back = $('#day-today');
      back.hidden = false;
      back.textContent = 'See today’s place';
      return;
    }
    label.textContent = isToday ? `Today, ${O.fmt.long.format(day)}` : O.fmt.long.format(day);
    label.dateTime = O.iso(day);
    label.title = O.fmt.full.format(day);
    const link = d => (O.iso(d) === O.iso(today) ? location.pathname : `?date=${O.iso(d)}`);
    const prev = $('#day-prev');
    const start = O.firstDay(schedule);
    const prevDay = O.addDays(day, -1);
    if (start && prevDay < start) prev.setAttribute('aria-disabled', 'true'); else prev.href = link(prevDay);
    const next = $('#day-next');
    if (isToday) next.setAttribute('aria-disabled', 'true'); else next.href = link(O.addDays(day, 1));
    $('#day-today').hidden = isToday;
    if (!isToday) document.querySelectorAll('.nav a[href="../"], .tabbar a[href="../"]').forEach(a => { a.href = `../?date=${O.iso(day)}`; });
    document.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, iframe')) return;
      const target = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
      if (target && target.href) { e.preventDefault(); location.href = target.href; }
    });
  }

  function renderPlace() {
    const name = $('#pick-name');
    name.textContent = place.name;
    name.removeAttribute('aria-busy');
    name.classList.add('reveal');
    $('#pick-where').textContent = where(place);
    document.title = `${place.name} · Orfeu place`;
    const listen = $('#listen');
    listen.href = place.playlist;
    listen.removeAttribute('aria-disabled');
    $('#place-note').textContent = `${place.playlistTitle || 'The Sound of ' + place.name}${place.tracks ? ` · ${place.tracks} tracks` : ''}`;
    const player = O.player($('#player'), place.playlist, place.playlistTitle || place.name);
    $('#play-here').addEventListener('click', () => {
      player.load(false);
      $('#player').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    });
    $('#share').addEventListener('click', () => O.share({ title: `${place.name} · Orfeu`, text: `The sound of ${place.name} on Orfeu`, link: O.absolute(O.placeUrl(place.slug)) }));

    if (!svgText || !place.point) return;
    const figure = $('#map');
    $('#map-frame').innerHTML = svgText;
    const svg = figure.querySelector('svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `World map marking ${place.name}${place.country ? ', ' + place.country : ''}`);
    svg.querySelectorAll('title').forEach(t => t.remove());
    const country = place.map && svg.querySelector(`#c${place.map}`);
    if (country) { country.classList.add('is-here'); country.parentNode.append(country); }
    figure.hidden = false; // getBBox() needs the map to be rendered
    const view = mapWindow(country, place, data.width);
    svg.setAttribute('viewBox', view.join(' '));
    const g = document.createElementNS(NS, 'g');
    const r = view[2] / 90;
    for (const cls of ['pin-ring', 'pin-dot']) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', place.point.x);
      c.setAttribute('cy', place.point.y);
      c.setAttribute('r', r);
      g.append(c);
    }
    svg.append(g);
    const { lat, lon } = place.point;
    $('#map-caption').textContent = `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;
  }

  // Zoom the world map to the place: a country's whole outline, or a window around a city
  // (the United States would otherwise shrink a city to a dot on a continent).
  function mapWindow(country, p, worldWidth) {
    const { x, y } = p.point;
    let box = { x, y, width: 0, height: 0 };
    if (country) {
      const b = country.getBBox();
      const tooBig = p.kind === 'city' && (b.width > 140 || b.height > 90);
      if (b.width > 0 && !tooBig) box = b;
    }
    const x0 = Math.min(box.x, x), y0 = Math.min(box.y, y);
    const x1 = Math.max(box.x + box.width, x), y1 = Math.max(box.y + box.height, y);
    let w = Math.max((x1 - x0) * 1.5, p.kind === 'city' ? 110 : 90);
    let h = Math.max((y1 - y0) * 1.5, 50);
    if (w / h < 1.6) w = h * 1.6; else h = w / 1.6;
    w = Math.min(w, worldWidth); h = w / 1.6;
    const rd = v => Math.round(v * 10) / 10;
    return [rd((x0 + x1) / 2 - w / 2), rd((y0 + y1) / 2 - h / 2), rd(w), rd(h)];
  }

  // Great-circle distance in km.
  function km(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }
  function renderNearby() {
    if (!place.point) return;
    const near = places.filter(p => p !== place && p.point && p.kind === 'city')
      .map(p => [km(place.point, p.point), p]).sort((a, b) => a[0] - b[0]).slice(0, 8);
    if (!near.length) return;
    $('#nearby-list').replaceChildren(...near.map(([d, p]) => el('li', {}, el('a', { href: O.placeUrl(p.slug) },
      el('strong', {}, p.name), el('span', {}, `${where(p) || p.country || ''} · ${d < 10 ? Math.round(d * 10) / 10 : Math.round(d).toLocaleString('en-US')} km`)))));
    $('#nearby-title').textContent = `Near ${place.name}`;
    $('#nearby').hidden = false;
  }

  function renderAtlas() {
    $('#atlas-title').textContent = `All ${places.length} places`;
    const input = $('#pq');
    const results = $('#place-results');
    const index = places.map(p => ({ p, text: ' ' + O.fold([p.name, p.region, p.country, p.source].filter(Boolean).join(' ')) }));
    function search() {
      const q = O.fold(input.value);
      if (!q) { results.replaceChildren(); return; }
      const hits = index.filter(({ text }) => text.includes(' ' + q)).map(({ p }) => p)
        .sort((a, b) => (O.fold(b.name).startsWith(q) - O.fold(a.name).startsWith(q)) || a.name.localeCompare(b.name)).slice(0, 12);
      results.replaceChildren(...(hits.length ? hits.map(p => el('li', {}, el('a', { href: O.placeUrl(p.slug) }, el('strong', {}, p.name), el('span', {}, where(p) || (p.kind === 'country' ? 'Country' : ''))))) : [el('li', { class: 'empty' }, `No place matches “${input.value.trim()}”.`)]));
    }
    input.addEventListener('input', search);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { const a = results.querySelector('a'); if (a) location.href = a.href; } });

    if (!svgText) return;
    const frame = $('#atlas-frame');
    // A second copy of the map, without ids (they belong to the zoomed map) or country titles.
    frame.innerHTML = svgText.replace(/ id="c\d+"/g, '').replace(/<title>[^<]*<\/title>/g, '');
    const svg = frame.querySelector('svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `World map with a dot for each of the ${places.length} places. Use the search above to open one.`);
    const dots = document.createElementNS(NS, 'g');
    const located = places.filter(p => p.point);
    const nodes = new Map();
    for (const p of located) {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', p.point.x);
      c.setAttribute('cy', p.point.y);
      c.setAttribute('r', p === place ? 5 : p.kind === 'country' ? 4 : 2.4);
      c.setAttribute('class', 'dot' + (p.kind === 'country' ? ' is-country' : '') + (p === place ? ' is-today' : ''));
      dots.append(c);
      nodes.set(p, c);
    }
    svg.append(dots);
    const pop = $('#atlas-pop');
    let hover = null;
    function nearest(evt) {
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const pt = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(ctm.inverse());
      let best = null, bestD = Infinity;
      for (const p of located) {
        const d = (p.point.x - pt.x) ** 2 + (p.point.y - pt.y) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      // Within about 18 screen pixels.
      const limit = 18 / ctm.a;
      return bestD <= limit * limit ? best : null;
    }
    function show(p, sticky) {
      if (hover) nodes.get(hover).classList.remove('is-hover');
      hover = p;
      if (!p) { pop.hidden = true; return; }
      nodes.get(p).classList.add('is-hover');
      const ctm = svg.getScreenCTM();
      const s = new DOMPoint(p.point.x, p.point.y).matrixTransform(ctm);
      const box = frame.getBoundingClientRect();
      const half = Math.min(130, box.width / 2 - 4);
      const x = Math.max(half, Math.min(box.width - half, s.x - box.left));
      const y = s.y - box.top;
      pop.style.left = x + 'px';
      pop.style.top = y + 'px';
      pop.style.transform = y < 110 ? 'translate(-50%, 14px)' : '';
      pop.replaceChildren(el('strong', {}, p.name), el('span', {}, where(p) || 'Country'), el('a', { href: O.placeUrl(p.slug) }, p === place ? 'Shown above' : `Open ${p.name} →`));
      pop.hidden = false;
      pop.dataset.sticky = sticky ? '1' : '';
    }
    svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !pop.dataset.sticky) show(nearest(e), false); });
    svg.addEventListener('pointerleave', () => { if (!pop.dataset.sticky) show(null); });
    svg.addEventListener('click', e => { const p = nearest(e); show(p, Boolean(p)); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { pop.dataset.sticky = ''; show(null); } });
    document.addEventListener('click', e => { if (!e.target.closest('#atlas-frame, #atlas-pop')) { pop.dataset.sticky = ''; show(null); } });
  }
})();
