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
      label.hidden = true;
      $('#day-prev').hidden = true;
      $('#day-next').hidden = true;
      const back = $('#day-today');
      back.hidden = false;
      back.href = O.url('');
      back.textContent = 'Today';
      return;
    }
    label.textContent = isToday ? 'Today' : O.fmt.long.format(day);
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
    const listen = $('#listen');
    listen.href = g.playlist;
    listen.removeAttribute('aria-disabled');
    listen.title = g.playlistTitle || '';

    let played = false;
    $('#play-here').addEventListener('click', () => {
      const box = $('#player');
      if (!played) {
        played = true;
        O.player(box, g.playlist, g.playlistTitle || g.name).load(true);
      }
      box.hidden = false;
    });

    const save = $('#save');
    const setSave = on => { save.setAttribute('aria-pressed', String(on)); save.querySelector('span').textContent = on ? 'Saved' : 'Save'; };
    setSave(O.saved.has(g.slug));
    save.addEventListener('click', () => {
      const { on, ok } = O.saved.toggle(g.slug);
      setSave(on);
      O.toast(ok ? (on ? 'Saved' : 'Removed') : 'Not saved');
    });

    $('#share').addEventListener('click', () => O.share({
      title: `${g.name} · Orfeu`,
      text: fixedGenre ? `${g.name} on Orfeu` : `Orfeu’s genre of the day: ${g.name}`,
      link: O.absolute(O.genreUrl(g.slug)),
    }));

    renderMedia(g);
  }

  function renderMedia(g) {
    $('#hero').dataset.layout = 'poster';
    $('#hero-media').replaceChildren(O.poster(g.slug, g.name, { mark: true }));
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
    
    $('#week-list').replaceChildren(...items);
    $('#week').hidden = false;
  }
})();
