// Orfeu core: data loading, dates and the frozen schedule, routing, saved/recent lists,
// sharing, the click-to-load Spotify player and the shared header controls.
// No build step: every page loads this file, then its own script.
(function () {
  'use strict';

  const root = document.body.dataset.root || './';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  // ---- Per-viewer storage (never required: private windows may refuse it) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('orfeu.' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('orfeu.' + key, JSON.stringify(value)); return true; } catch { return false; }
    },
  };
  const saved = {
    list: () => { const v = store.get('saved', []); return Array.isArray(v) ? v : []; },
    has: slug => saved.list().includes(slug),
    toggle(slug) {
      const list = saved.list();
      const on = !list.includes(slug);
      const next = on ? [slug, ...list] : list.filter(s => s !== slug);
      const ok = store.set('saved', next.slice(0, 500));
      document.dispatchEvent(new CustomEvent('orfeu:saved', { detail: { slug, on } }));
      return { on, ok };
    },
  };
  const recent = {
    list: () => { const v = store.get('recent', []); return Array.isArray(v) ? v : []; },
    push(slug) { store.set('recent', [slug, ...recent.list().filter(s => s !== slug)].slice(0, 16)); },
  };

  // ---- Data ------------------------------------------------------------------------
  const cache = {};
  function load(path) {
    if (!cache[path]) {
      cache[path] = fetch(root + path, { cache: 'no-cache' }).then(res => {
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return path.endsWith('.svg') ? res.text() : res.json();
      });
      cache[path].catch(() => { delete cache[path]; });
    }
    return cache[path];
  }
  const data = {
    genres: () => load('assets/data/genres.json'),
    places: () => load('assets/data/locations.json'),
    schedule: () => load('assets/data/schedule.json'),
    picks: () => load('assets/data/favourites.json'),
    map: () => load('assets/map/world.svg'),
  };

  // ---- Dates and the schedule --------------------------------------------------------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const parseIso = s => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) || iso(d) !== m[0] ? null : d;
  };
  // ?date=YYYY-MM-DD picks an earlier day; a future or malformed date means today.
  function readDate() {
    const today = startOfDay(new Date());
    const asked = parseIso(new URLSearchParams(location.search).get('date'));
    if (!asked || asked > today) return { day: today, today, isToday: true };
    return { day: asked, today, isToday: iso(asked) === iso(today) };
  }
  const daysBetween = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);

  // FNV-1a, for stable colours and the fallback pick.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // The schedule (built once by pipeline/build-pages.mjs and only ever extended) fixes the
  // genre and place for every date, so an old ?date= link keeps showing what it showed.
  function scheduled(schedule, key, day, bySlug, list) {
    if (schedule) {
      const i = daysBetween(parseIso(schedule.start), day);
      const slug = schedule[key]?.[i];
      if (slug && bySlug.has(slug)) return bySlug.get(slug);
      // A scheduled pick that has since been cut: step to the next scheduled one that exists.
      if (slug) for (let j = i + 1; j < schedule[key].length; j++) if (bySlug.has(schedule[key][j])) return bySlug.get(schedule[key][j]);
    }
    return list[hash(iso(day) + key) % list.length];
  }
  const firstDay = schedule => (schedule ? parseIso(schedule.start) : null);

  // ---- Formatting --------------------------------------------------------------------
  const fmt = {
    long: new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    full: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    short: new Intl.DateTimeFormat('en-US', { weekday: 'short' }),
  };
  const fold = s => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  function firstSentences(text, max = 220) {
    const parts = (text || '').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
    let out = '';
    for (const p of parts) { if (out && (out + ' ' + p).length > max) break; out = out ? out + ' ' + p : p; }
    return out.length > max + 80 ? out.slice(0, max).replace(/\s+\S*$/, '') + '…' : out;
  }

  // ---- Links -------------------------------------------------------------------------
  const url = path => root + path;
  const genreUrl = slug => root + 'g/' + slug + '/';
  const placeUrl = slug => root + 'locations/?p=' + encodeURIComponent(slug);
  const absolute = rel => new URL(rel, location.href).href;
  const playlistId = link => (String(link || '').match(/playlist\/([A-Za-z0-9]{22})/) || [])[1] || null;

  // ---- Images ------------------------------------------------------------------------
  // Wikimedia serves thumbnails only at standard widths, so srcset uses those.
  function srcset(img) {
    const parts = img.widths.map(w => `${img.thumb.replace('{w}', w)} ${w}w`);
    if (img.original && (!img.widths.length || img.w > img.widths[img.widths.length - 1])) parts.push(`${img.original} ${img.w}w`);
    return parts.join(', ');
  }
  function thumb(img, want = 500) {
    const fit = img.widths.filter(w => w >= want)[0] || img.widths[img.widths.length - 1];
    return fit ? img.thumb.replace('{w}', fit) : img.original;
  }
  const hue = slug => hash(slug) % 360;

  function el(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) node.style.setProperty(p, val);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
    return node;
  }
  function extLink(href, label, cls = 'ext') {
    return el('a', { href, class: cls, target: '_blank', rel: 'noopener noreferrer' }, label, el('span', { class: 'visually-hidden' }, ' (opens in a new tab)'));
  }

  // Poster for genres without a free photo: a colour field seeded by the slug.
  function poster(slug, name, { mark = false } = {}) {
    return el('div', { class: 'poster', style: { '--h': hue(slug) }, 'aria-hidden': 'true' },
      mark ? el('div', { class: 'poster-mark' }) : null,
      el('p', { class: 'poster-word' }, name));
  }

  // A genre card (Explore grid, shelves, picks).
  function genreCard(g, { meta, day, families, saveButton = true, eager = false } = {}) {
    const media = el('span', { class: 'card-media' });
    if (g.image) {
      const img = el('img', { src: thumb(g.image, 500), alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async', style: g.image.position ? { 'object-position': g.image.position } : null });
      img.addEventListener('error', () => { media.replaceChildren(poster(g.slug, g.name)); }, { once: true });
      media.append(img);
    } else media.append(poster(g.slug, g.name));
    const metaText = meta ?? (families ? g.family.map(f => families[f]).filter(Boolean).slice(0, 2).join(' · ') : '');
    const link = el('a', { class: 'card', href: genreUrl(g.slug) },
      media,
      day ? el('span', { class: 'card-day' }, day) : null,
      el('span', { class: 'card-text' }, el('span', { class: 'card-name' }, g.name), metaText ? el('span', { class: 'card-meta' }, metaText) : null));
    const wrap = el('div', { class: 'card-wrap' }, link);
    if (saveButton) wrap.append(saveToggle(g, 'card-save'));
    return wrap;
  }

  function saveToggle(g, cls) {
    const b = el('button', { type: 'button', class: cls, 'aria-pressed': String(saved.has(g.slug)), 'aria-label': `Save ${g.name}` , html: icon('heart') });
    b.addEventListener('click', e => {
      e.preventDefault();
      const { on, ok } = saved.toggle(g.slug);
      b.setAttribute('aria-pressed', String(on));
      toast(ok ? (on ? `Saved ${g.name}` : `Removed ${g.name}`) : 'This browser is not keeping saved genres (private mode?)');
    });
    document.addEventListener('orfeu:saved', e => { if (e.detail.slug === g.slug) b.setAttribute('aria-pressed', String(e.detail.on)); });
    return b;
  }

  // ---- Toast and share -----------------------------------------------------------------
  let toastTimer;
  function toast(message) {
    let t = $('.toast');
    if (!t) { t = el('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
    t.textContent = message;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
  }
  async function share({ title, text, link }) {
    if (navigator.share) {
      try { await navigator.share({ title, text, url: link }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { toast(link); }
  }

  // ---- Click-to-load Spotify player ----------------------------------------------------
  // Nothing from Spotify loads until the visitor asks for it.
  function player(container, playlist, label) {
    const id = playlistId(playlist);
    container.replaceChildren();
    if (!id) return { load() {} };
    const button = el('button', { type: 'button', class: 'btn btn-spotify', html: icon('play', 'fill') + '<span>Load the player</span>' });
    const cta = el('div', { class: 'player-cta' }, button, el('p', {}, `Plays ${label} right here. This loads Spotify's player, which uses Spotify's cookies.`));
    container.append(cta);
    let loaded = false;
    function load(focus) {
      if (loaded) return;
      loaded = true;
      const frame = el('iframe', {
        src: `https://open.spotify.com/embed/playlist/${id}?utm_source=orfeu`,
        title: `Spotify player: ${label}`,
        allow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
        loading: 'lazy',
      });
      container.replaceChildren(frame);
      if (focus) frame.focus();
    }
    button.addEventListener('click', () => load(true));
    return { load };
  }

  // ---- Icons ---------------------------------------------------------------------------
  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
    heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z"/>',
    share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    spotify: '<path d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm4.82 15.15a.65.65 0 0 1-.9.22c-2.46-1.5-5.56-1.84-9.21-1.01a.66.66 0 0 1-.29-1.28c4-.91 7.42-.52 10.18 1.17.31.19.41.59.22.9Zm1.28-2.86a.82.82 0 0 1-1.12.27c-2.82-1.73-7.11-2.23-10.44-1.22a.82.82 0 1 1-.47-1.57c3.8-1.15 8.54-.6 11.77 1.39.38.24.5.74.26 1.13Zm.11-2.97C14.83 8.8 9.27 8.62 6.05 9.6a.98.98 0 1 1-.57-1.88c3.7-1.12 9.83-.9 13.71 1.4a.98.98 0 0 1-1 1.7Z"/>',
  };
  const icon = (name, extra = '') => `<svg class="icon ${name === 'spotify' ? 'fill' : ''} ${extra}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

  // ---- Shared header controls ------------------------------------------------------------
  async function surprise() {
    try {
      const { genres } = await data.genres();
      const current = document.body.dataset.current;
      let g;
      do { g = genres[Math.floor(Math.random() * genres.length)]; } while (genres.length > 1 && g.slug === current);
      location.href = genreUrl(g.slug);
    } catch { toast('Could not load the genre list'); }
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-surprise]');
    if (b) { e.preventDefault(); surprise(); }
  });
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], iframe')) return;
    if (e.key === '/') {
      e.preventDefault();
      const q = $('#q');
      if (q) q.focus(); else location.href = root + 'explore/?focus=1';
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      surprise();
    }
  });

  window.Orfeu = {
    root, $, $$, el, store, saved, recent, data, iso, parseIso, addDays, readDate, daysBetween, hash, scheduled, firstDay,
    fmt, fold, firstSentences, url, genreUrl, placeUrl, absolute, playlistId, srcset, thumb, hue, poster, genreCard, saveToggle,
    extLink, toast, share, player, icon,
  };
})();
