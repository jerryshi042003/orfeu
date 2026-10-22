// Jerry's picks: a short list of favourite genres, flamenco first. Each card opens the
// genre's page and playlist; a pick with no exact playlist says which one is nearest.
(async function () {
  'use strict';
  const O = window.Orfeu;
  const { $, el } = O;
  let picks, genres, families, places;
  try {
    const [p, g, l] = await Promise.all([O.data.picks(), O.data.genres(), O.data.places().catch(() => ({ locations: [] }))]);
    ({ picks } = p);
    ({ genres, families } = g);
    places = new Map(l.locations.map(x => [x.slug, x]));
  } catch (err) {
    console.error('Orfeu could not load its data.', err);
    $('#picks-problem').hidden = false;
    return;
  }
  const bySlug = new Map(genres.map(g => [g.slug, g]));
  const items = picks.map(p => ({ ...p, g: bySlug.get(p.genre) })).filter(p => p.g);
  if (!items.length) return;

  const [first, ...rest] = items;
  renderFeature(first);
  $('#pick-grid').replaceChildren(...rest.map(p => el('li', {}, card(p))));

  function links(p, cls) {
    const bits = [];
    const more = (p.more || []).map(s => bySlug.get(s)).filter(Boolean);
    if (more.length) bits.push(el('p', { class: cls }, `More ${p.g.name.toLowerCase()}: `, ...more.flatMap((m, i) => [i ? ' · ' : '', el('a', { href: O.genreUrl(m.slug) }, m.name)])));
    const where = (p.places || []).map(s => places.get(s)).filter(Boolean);
    if (where.length) bits.push(el('p', { class: cls }, 'Places to hear it: ', ...where.flatMap((w, i) => [i ? ' · ' : '', el('a', { href: O.placeUrl(w.slug) }, w.name)])));
    return bits;
  }

  function actions(p, glass) {
    const cls = glass ? 'btn btn-glass' : 'btn btn-quiet';
    const listen = el('a', { class: 'btn btn-spotify', href: p.g.playlist, target: '_blank', rel: 'noopener noreferrer', html: O.icon('spotify') + '<span>Listen</span><span class="visually-hidden"> on Spotify (opens in a new tab)</span>' });
    const open = el('a', { class: cls, href: O.genreUrl(p.g.slug) }, 'Open page');
    const save = O.saveToggle(p.g, glass ? cls : cls + ' btn-icon');
    if (glass) save.append(el('span', {}, 'Save'));
    return el('div', { class: glass ? 'hero-actions' : 'pick-actions' }, listen, open, save);
  }

  function renderFeature(p) {
    const media = $('#feature-media');
    const img = p.g.image;
    if (img) {
      const pic = el('img', { alt: img.title, srcset: O.srcset(img), sizes: '(min-width: 860px) 55vw, 100vw', src: O.thumb(img, 960), decoding: 'async' });
      if (img.position) pic.style.setProperty('--pos', img.position);
      media.append(pic, el('p', { class: 'feature-credit' }, O.extLink(img.page, img.title, ''), ` · ${img.artist} · ${img.licence}`));
    } else media.append(O.poster(p.g.slug, p.g.name, { mark: true }));
    $('#feature-label').textContent = p.label ? `${p.label} · first pick` : 'First pick';
    $('#feature-title').textContent = p.g.name;
    $('#feature-note').textContent = p.note;
    $('#feature-links').replaceChildren(...links(p, ''));
    $('#feature-actions').replaceChildren(actions(p, true));
    $('#feature').hidden = false;
  }

  function card(p) {
    const c = O.genreCard(p.g, { families, saveButton: false, meta: p.nearest ? 'Nearest playlist' : undefined });
    return el('article', { class: 'pick-card' },
      c.querySelector('a'),
      el('div', { class: 'pick-body' },
        p.label ? el('p', { class: 'pick-label' }, p.label) : null,
        el('p', { class: 'pick-note' }, p.note),
        p.nearest ? el('p', { class: 'pick-nearest' }, `Nearest playlist: ${p.g.playlistTitle || p.g.name}`) : null,
        ...links(p, 'pick-nearest'),
        actions(p, false)));
  }
})();
