// Explore: search every genre (accents and case ignored), filter by family or saved,
// and see what you opened recently. The query and filter live in the URL (?q=, ?f=).
(async function () {
  'use strict';
  const O = window.Orfeu;
  const { $, el } = O;
  const params = new URLSearchParams(location.search);
  const input = $('#q');
  const clear = $('#q-clear');
  const chips = $('#chips');
  const grid = $('#grid');
  const count = $('#count');
  const empty = $('#empty');
  let filter = params.get('f') || 'all';
  input.value = params.get('q') || '';
  if (params.get('focus') || location.hash === '#search') input.focus();

  let genres, families, bySlug;
  try {
    ({ genres, families } = await O.data.genres());
    if (filter !== 'all' && filter !== 'saved' && !Object.hasOwn(families, filter)) filter = 'all';
    bySlug = new Map(genres.map(g => [g.slug, g]));
  } catch (err) {
    console.error('Orfeu could not load its data.', err);
    count.textContent = 'The genre list didn’t load. Check your connection and reload the page.';
    return;
  }
  $('#title-count').textContent = genres.length;
  const index = genres.map(g => ({ g, text: ' ' + O.fold([g.name, g.formerly, g.wiki?.title].filter(Boolean).join(' ')) }));
  const familyCounts = {};
  for (const g of genres) for (const f of g.family) familyCounts[f] = (familyCounts[f] || 0) + 1;

  function renderChips() {
    const savedCount = O.saved.list().filter(s => bySlug.has(s)).length;
    const defs = [['all', 'All', genres.length], ['saved', 'Saved', savedCount],
      ...Object.keys(families).filter(f => familyCounts[f]).sort((a, b) => (a === 'other') - (b === 'other') || familyCounts[b] - familyCounts[a]).map(f => [f, families[f], familyCounts[f]])];
    chips.replaceChildren(...defs.map(([id, label, n]) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(filter === id), 'data-f': id,
      onclick: () => { filter = filter === id && id !== 'all' ? 'all' : id; renderChips(); render(); },
    }, label, el('span', { class: 'n' }, String(n)))));
    // Keep the active filter in view when the chip row scrolls sideways (phones).
    const active = chips.querySelector('[aria-pressed="true"]');
    if (active && chips.scrollWidth > chips.clientWidth) chips.scrollLeft = active.offsetLeft - chips.offsetLeft - 16;
  }

  function matches() {
    const q = O.fold(input.value);
    let list = genres;
    if (filter === 'saved') { const s = O.saved.list(); list = s.map(slug => bySlug.get(slug)).filter(Boolean); }
    else if (filter !== 'all') list = list.filter(g => g.family.includes(filter));
    if (!q) return list;
    const allowed = new Set(list);
    const ranked = [];
    for (const { g, text } of index) {
      if (!allowed.has(g)) continue;
      const name = ' ' + O.fold(g.name);
      const rank = name.startsWith(' ' + q) ? 0 : name.includes(' ' + q) ? 1 : text.includes(' ' + q) ? 2 : text.includes(q) ? 3 : -1;
      if (rank >= 0) ranked.push([rank, g]);
    }
    return ranked.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(([, g]) => g);
  }

  let shown = 0;
  let current = [];
  const PAGE = 72;
  function render() {
    current = matches();
    shown = 0;
    grid.replaceChildren();
    more();
    const q = input.value.trim();
    const noun = current.length === 1 ? 'genre' : 'genres';
    const what = filter === 'all' ? noun : filter === 'saved' ? `saved ${noun}` : `${families[filter]} ${noun}`;
    count.textContent = `${current.length} ${what}${q ? ` matching “${q}”` : ''}`;
    empty.hidden = current.length > 0;
    if (!current.length) {
      empty.textContent = filter === 'saved' && !q
        ? 'Nothing saved yet. Tap the heart on any genre to keep it here (saved in this browser only).'
        : `No genre matches “${q}”. Try a shorter word, or Surprise me.`;
    }
    clear.hidden = !q;
    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (filter !== 'all') next.set('f', filter);
    history.replaceState(null, '', location.pathname + (next.toString() ? '?' + next : ''));
  }
  // Render in pages as the visitor scrolls, so 500 cards never land at once.
  function more() {
    const slice = current.slice(shown, shown + PAGE);
    grid.append(...slice.map((g, i) => el('li', {}, O.genreCard(g, { families, eager: shown + i < 8 }))));
    shown += slice.length;
  }
  const sentinel = $('#more');
  new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting) && shown < current.length) more(); }, { rootMargin: '800px' }).observe(sentinel);

  input.addEventListener('input', render);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && current[0]) location.href = O.genreUrl(current[0].slug);
    if (e.key === 'Escape') { input.value = ''; render(); }
  });
  clear.addEventListener('click', () => { input.value = ''; render(); input.focus(); });
  document.addEventListener('orfeu:saved', () => { renderChips(); if (filter === 'saved') render(); });

  // Recently viewed in this browser.
  const recent = O.recent.list().map(s => bySlug.get(s)).filter(Boolean).slice(0, 8);
  if (recent.length) {
    $('#recent').append(...recent.map(g => el('a', { class: 'chip chip-small', href: O.genreUrl(g.slug) }, g.name)));
    $('#recent').hidden = false;
  }

  renderChips();
  render();
})();
