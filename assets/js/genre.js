// Genre pages: the genre of the day (index.html, ?date=), any genre by slug (?g=slug),
// and the prebuilt share pages under g/<slug>/ (data-genre on <body>).
(async function () {
  'use strict';
  const O = window.Orfeu;
  const { $, el } = O;
  const params = new URLSearchParams(location.search);
  const fixed = document.body.dataset.genre || params.get('g');
  const { day, today, isToday } = O.readDate();

  try {
    const [{ genres, families }, schedule] = await Promise.all([O.data.genres(), O.data.schedule().catch(() => null)]);
    const bySlug = new Map(genres.map(g => [g.slug, g]));
    let genre;
    if (fixed) {
      genre = bySlug.get(fixed) || genres.find(g => O.fold(g.formerly) === O.fold(fixed.replace(/-/g, ' ')));
      if (!genre) return notFound(fixed);
    } else genre = O.scheduled(schedule, 'genres', day, bySlug, genres);

    document.body.dataset.current = genre.slug;
    renderDayNav(Boolean(fixed), schedule);
    renderHero(genre, families, Boolean(fixed));
    renderAbout(genre, families);
    renderRelated(genre, genres, families);
    if (!fixed) renderWeek(schedule, bySlug, genres, families);
    O.recent.push(genre.slug);
  } catch (err) {
    console.error('Orfeu could not load its data.', err);
    $('#pick-name').removeAttribute('aria-busy');
    $('#pick-name').textContent = 'Not available';
    $('#problem').hidden = false;
  }
  $('#problem-retry').addEventListener('click', () => location.reload());

  function notFound(slug) {
    $('#pick-name').removeAttribute('aria-busy');
    $('#pick-name').textContent = 'Genre not found';
    $('#hero-lede').textContent = `There is no genre called “${slug}” here any more. Its playlist may have been retired.`;
    $('#day').hidden = true;
    $('#hero-media').replaceChildren(O.poster(slug, '?', { mark: true }));
    const actions = document.querySelector('.hero-actions');
    actions.replaceChildren(el('a', { class: 'btn btn-glass', href: O.url('explore/') }, 'Explore all genres'));
    document.title = 'Genre not found · Orfeu';
  }

  // ---- Day navigation ------------------------------------------------------------------
  function renderDayNav(fixedGenre, schedule) {
    const label = $('#day-label');
    if (fixedGenre) {
      $('#kicker').textContent = 'Genre';
      label.hidden = true;
      label.previousSibling.textContent = '';
      $('#day-prev').hidden = true;
      $('#day-next').hidden = true;
      const back = $('#day-today');
      back.hidden = false;
      back.href = O.url('');
      back.textContent = 'See today’s genre';
      return;
    }
    label.textContent = isToday ? `Today, ${O.fmt.long.format(day)}` : O.fmt.long.format(day);
    label.dateTime = O.iso(day);
    label.title = O.fmt.full.format(day);
    const link = d => (O.iso(d) === O.iso(today) ? location.pathname : `?date=${O.iso(d)}`);
    const prevDay = O.addDays(day, -1);
    const start = O.firstDay(schedule);
    const prev = $('#day-prev');
    if (start && prevDay < start) prev.setAttribute('aria-disabled', 'true'); else prev.href = link(prevDay);
    const next = $('#day-next');
    if (isToday) next.setAttribute('aria-disabled', 'true'); else next.href = link(O.addDays(day, 1));
    $('#day-today').hidden = isToday;
    if (!isToday) {
      $('#kicker').textContent = 'Genre of the day';
      document.querySelectorAll('.nav a[href$="locations/"], .tabbar a[href$="locations/"]').forEach(a => { a.href += `?date=${O.iso(day)}`; });
    }
    document.addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, iframe')) return;
      const target = e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
      if (target && target.href) { e.preventDefault(); location.href = target.href; }
    });
  }

  // ---- Hero --------------------------------------------------------------------------
  function renderHero(g, families, fixedGenre) {
    const name = $('#pick-name');
    name.textContent = g.name;
    name.removeAttribute('aria-busy');
    name.classList.add('reveal');
    document.title = fixedGenre ? `${g.name} · Orfeu` : `${g.name} · Orfeu genre of the day`;
    $('#hero-lede').textContent = g.wiki ? O.firstSentences(g.wiki.extract, 200) : '';

    const tags = $('#hero-tags');
    tags.replaceChildren(...g.family.filter(f => families[f]).map(f => el('li', {}, el('a', { href: O.url('explore/?f=' + f) }, families[f]))));

    const listen = $('#listen');
    listen.href = g.playlist;
    listen.removeAttribute('aria-disabled');
    listen.title = g.playlistTitle || '';

    const player = O.player($('#player'), g.playlist, g.playlistTitle || g.name);
    $('#play-here').addEventListener('click', () => {
      player.load(false);
      $('#player').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    });

    const save = $('#save');
    const setSave = on => { save.setAttribute('aria-pressed', String(on)); save.querySelector('span').textContent = on ? 'Saved' : 'Save'; };
    setSave(O.saved.has(g.slug));
    save.addEventListener('click', () => {
      const { on, ok } = O.saved.toggle(g.slug);
      setSave(on);
      O.toast(ok ? (on ? `Saved ${g.name}. Find it in Explore.` : `Removed ${g.name}`) : 'This browser is not keeping saved genres (private mode?)');
    });

    $('#share').addEventListener('click', () => O.share({
      title: `${g.name} · Orfeu`,
      text: fixedGenre ? `${g.name} on Orfeu` : `Orfeu’s genre of the day: ${g.name}`,
      link: O.absolute(O.genreUrl(g.slug)),
    }));

    renderMedia(g);
  }

  function renderMedia(g) {
    const hero = $('#hero');
    const media = $('#hero-media');
    const frame = $('#hero-frame');
    const credit = $('#credit');
    const img = g.image;
    const usePoster = () => {
      hero.dataset.layout = 'poster';
      media.replaceChildren(O.poster(g.slug, g.name, { mark: true }));
      frame.replaceChildren();
      credit.replaceChildren();
    };
    if (!img) return usePoster();

    const wide = img.w >= 1280 && img.w / img.h >= 1.25;
    hero.dataset.layout = wide ? 'cover' : 'framed';
    if (img.w >= 700) hero.dataset.phone = 'cover';
    const sources = O.srcset(img);
    const fallback = O.thumb(img, 1280);
    const main = el('img', { class: 'hero-img', alt: img.title, srcset: sources, sizes: '100vw', src: fallback, decoding: 'async', fetchpriority: 'high' });
    if (img.position) main.style.setProperty('--pos', img.position);
    main.addEventListener('load', () => main.classList.add('is-loaded'), { once: true });
    main.addEventListener('error', usePoster, { once: true });
    const nodes = [];
    if (!wide) nodes.push(el('img', { class: 'hero-backdrop', alt: '', src: O.thumb(img, 500), decoding: 'async' }));
    nodes.push(main);
    media.replaceChildren(...nodes);
    if (main.complete && main.naturalWidth) main.classList.add('is-loaded');

    if (!wide) {
      // Never upscale: the framed picture is at most its own width.
      frame.style.setProperty('--fw', Math.min(img.w, Math.round(520 * Math.max(0.75, Math.min(1.25, img.w / img.h)))) + 'px');
      frame.replaceChildren(el('img', { alt: img.title, srcset: sources, sizes: '(min-width: 900px) 38vw, 100vw', src: O.thumb(img, 960), decoding: 'async' }));
    }

    credit.replaceChildren(
      'Photo: ', O.extLink(img.page, img.title, ''), ` · ${img.artist} · `,
      img.licenceUrl ? O.extLink(img.licenceUrl, img.licence, '') : img.licence,
      ' · Wikimedia Commons');
  }

  // ---- About and facts ---------------------------------------------------------------------
  function renderAbout(g, families) {
    $('#about-title').textContent = `About ${g.name}`;
    const text = $('#about-text');
    const source = $('#about-source');
    if (g.wiki) {
      text.textContent = g.wiki.extract;
      const same = O.fold(g.wiki.title) === O.fold(g.name) || O.fold(g.wiki.title).startsWith(O.fold(g.name) + ' ');
      source.replaceChildren(same ? 'From Wikipedia: ' : 'Closest Wikipedia article: ', O.extLink(g.wiki.url, g.wiki.title), ' (CC BY-SA 4.0)');
    } else {
      text.textContent = 'No Wikipedia article matches this genre yet, so let the playlist introduce it.';
      source.replaceChildren(O.extLink(`https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(g.name + ' music')}`, 'Search Wikipedia'));
    }
    const facts = $('#facts');
    const row = (label, ...value) => el('div', {}, el('dt', {}, label), el('dd', {}, ...value));
    const rows = [row('Playlist', O.extLink(g.playlist, g.playlistTitle || g.name), g.tracks ? ` · ${g.tracks} tracks` : '')];
    if (g.formerly) rows.push(row('Also listed as', g.formerly));
    rows.push(row('Families', ...g.family.filter(f => families[f]).flatMap((f, i) => [i ? ' · ' : '', el('a', { href: O.url('explore/?f=' + f) }, families[f])])));
    if (g.image) rows.push(row('Photo', O.extLink(g.image.page, g.image.title), ` by ${g.image.artist}, `, g.image.licenceUrl ? O.extLink(g.image.licenceUrl, g.image.licence) : g.image.licence));
    facts.replaceChildren(...rows);
    $('#about').hidden = false;
  }

  // ---- Related: genres that share words in the name, the article or a family ---------------
  function renderRelated(g, genres, families) {
    const words = new Set(O.fold(g.name).split(' ').filter(w => w.length > 2 && !['music', 'the', 'and', 'classic', 'pop', 'rock'].includes(w)));
    const scored = [];
    for (const other of genres) {
      if (other.slug === g.slug) continue;
      let score = 0;
      for (const w of O.fold(other.name).split(' ')) if (words.has(w)) score += 4;
      if (g.wiki && other.wiki && other.wiki.title === g.wiki.title) score += 5;
      const shared = other.family.filter(f => g.family.includes(f) && f !== 'other').length;
      score += shared * 1.5;
      if (score >= 1.5) scored.push([score + (other.image ? 0.5 : 0) + (O.hash(g.slug + other.slug) % 100) / 1000, other]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const list = scored.slice(0, 12).map(([, other]) => el('li', {}, O.genreCard(other, { families })));
    if (!list.length) return;
    $('#related-title').textContent = `If you like ${g.name}`;
    $('#related-list').replaceChildren(...list);
    $('#related').hidden = false;
  }

  // ---- The last seven days --------------------------------------------------------------
  function renderWeek(schedule, bySlug, genres, families) {
    const items = [];
    for (let i = 6; i >= 0; i--) {
      const d = O.addDays(day, -i);
      const start = O.firstDay(schedule);
      if (start && d < start) continue;
      const g = O.scheduled(schedule, 'genres', d, bySlug, genres);
      const card = O.genreCard(g, { families, day: i === 0 ? (isToday ? 'Today' : O.fmt.short.format(d)) : O.fmt.short.format(d), saveButton: false });
      card.querySelector('a').href = O.iso(d) === O.iso(today) ? O.url('') : O.url(`?date=${O.iso(d)}`);
      items.push(el('li', {}, card));
    }
    $('#week-title').textContent = isToday ? 'This week on Orfeu' : `The week to ${O.fmt.long.format(day)}`;
    $('#week-list').replaceChildren(...items);
    $('#week').hidden = false;
  }
})();
