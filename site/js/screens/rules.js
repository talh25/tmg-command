// Rulebook: contents, cross-linked rules text, glossary, FAQ, ability index, card anatomy, and search over all of it.
import { el, segmented, FACTION_NAME } from '../lib.js';
import { loadRules, rich, sectionById } from '../ruletext.js';
import { armyData } from '../armies.js';
import { mediaData, MEDIA } from '../audio.js';

const EXTRA = [['glossary', 'Glossary', 'Every keyword, defined'], ['faq', 'FAQ', 'Official questions and answers'],
  ['abilities', 'Abilities', 'Every ability on the cards'], ['cards', 'Card anatomy', 'How to read each card']];
let query = '';      // kept while moving between rule pages, so "back" returns to the same results
let index = null;

// ---------- search ----------
function buildIndex(rules) {
  const docs = [];
  const add = (kind, title, text, href, extra = '') => docs.push({ kind, title, text, href, hay: `${title} ${extra} ${text}`.toLowerCase(), titleHay: title.toLowerCase() });
  for (const s of rules.sections) add(`Rules ${s.id}`, s.title, s.blocks.map((b) => b.text).join(' '), `#/rules/${s.id}`, s.id);
  for (const g of rules.glossary) add('Glossary', g.term, g.text, `#/rules/glossary/${encodeURIComponent(g.term.replace(/\s*\(.*?\)\s*$/, '').toUpperCase())}`);
  rules.faq.forEach((f, i) => add('FAQ', f.q, f.a, `#/rules/faq/${i}`));
  for (const a of rules.abilities) add(`Ability · ${FACTION_NAME[a.faction.toLowerCase()] || a.faction}`, a.name, a.text, `#/rules/abilities/${encodeURIComponent(a.name)}`);
  for (const [f, d] of Object.entries(armyData() || {})) {
    for (const u of d.units) add(`Unit · ${FACTION_NAME[f]}`, u.name, [u.slot, ...(u.tags || []), ...(u.weapons || []).map((w) => w.name), ...(u.abilities || []).map((a) => a.name)].join(', '), `#/codex/${f}/${u.id}`);
  }
  return docs;
}

function search(q) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits = [];
  for (const d of index) {
    if (!words.every((w) => d.hay.includes(w))) continue;
    let score = 0;
    for (const w of words) score += (d.titleHay.includes(w) ? 20 : 0) + (d.titleHay === w ? 30 : 0) + Math.min(5, d.hay.split(w).length - 1);
    if (d.kind === 'Glossary') score += 4;
    hits.push({ d, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 60).map((h) => h.d);
}

/** Text with the searched words marked, cut to a window around the first match. */
function snippet(text, words, width = 170) {
  const low = text.toLowerCase();
  const first = Math.min(...words.map((w) => low.indexOf(w)).filter((i) => i >= 0), Infinity);
  const from = first === Infinity ? 0 : Math.max(0, first - 50);
  const part = (from ? '…' : '') + text.slice(from, from + width) + (from + width < text.length ? '…' : '');
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return part.split(re).map((piece, i) => (i % 2 ? el('mark', piece) : piece));
}

function results(q) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hits = search(q);
  return el('div.card',
    el('h2', hits.length ? `${hits.length}${hits.length === 60 ? '+' : ''} results for "${q}"` : `Nothing found for "${q}"`),
    hits.length ? el('div', hits.map((d) => el('a.hit', { href: d.href }, el('small', d.kind), el('b', snippet(d.title, words, 120)), el('span.small.muted', snippet(d.text, words)))))
      : el('p.muted', 'Try fewer or different words, such as a keyword name or "charge".'));
}

// ---------- contents ----------
function contents(rules, current) {
  const open = current?.split('.')[0];
  return el('nav.card.toc', { 'aria-label': 'Rulebook contents' },
    el('div.tiles', EXTRA.map(([id, title, text]) => el('a.tile', { href: `#/rules/${id}` }, el('b', title), el('span', text)))),
    rules.parts.map((p) => el('details', { open: p.id === open },
      el('summary', el('span', p.id), p.title),
      el('a' + (current === p.id ? '.on' : ''), { href: `#/rules/${p.id}` }, el('small', p.id), 'Overview'),
      rules.sections.filter((s) => s.part === p.id && s.level > 1).map((s) =>
        el('a' + (s.level === 3 ? '.l3' : '') + (s.id === current ? '.on' : ''), { href: `#/rules/${s.id}` }, el('small', s.id), s.title)))));
}

// ---------- pages ----------
function blocks(list) {
  const out = [];
  let ul = null;
  let table = null;
  for (const b of list) {
    // Table rows carry their cells; neighbouring rows form one table.
    if (b.cells) {
      if (!table) out.push(el('div.table-wrap', table = el('table')));
      table.append(el('tr', b.cells.map((c) => el(b.head ? 'th' : 'td', rich(c)))));
      ul = null;
      continue;
    }
    table = null;
    if (b.t === 'li') { if (!ul) out.push(ul = el('ul')); ul.append(el('li', rich(b.text))); continue; }
    ul = null;
    out.push(b.t === 'h' ? el('h4', b.text) : b.t === 'note' ? el('div.note', rich(b.text)) : el('p', rich(b.text)));
  }
  return out;
}

/** A rule page is one x.y section with its x.y.z subsections, or a part's overview. */
function sectionPage(rules, id) {
  const target = sectionById(id);
  if (!target) return null;
  const pageId = target.level === 3 ? id.split('.').slice(0, 2).join('.') : id;
  const top = sectionById(pageId) || target;
  const pages = rules.sections.filter((s) => s.level < 3);
  const at = pages.indexOf(top);
  const kids = rules.sections.filter((s) => (top.level === 2 ? s.level === 3 && s.id.startsWith(top.id + '.') : false));
  const part = rules.parts.find((p) => p.id === top.part);
  const node = el('article.card.article',
    el('small.eyebrow', `Part ${part.id} · ${part.title} · page ${top.page}`),
    el('h2', { id: 'sec-' + top.id }, top.level === 1 ? top.title : `${top.id} ${top.title}`),
    blocks(top.blocks),
    top.level === 1 ? el('div.list', rules.sections.filter((s) => s.part === top.id && s.level === 2).map((s) =>
      el('a.list-row', { href: `#/rules/${s.id}` }, el('div', el('b', `${s.id} ${s.title}`)), el('small.muted', `p. ${s.page}`)))) : null,
    kids.map((k) => [el('h3', { id: 'sec-' + k.id }, `${k.id} ${k.title}`), blocks(k.blocks)]),
    el('div.pager',
      at > 0 ? el('a.btn', { href: `#/rules/${pages[at - 1].id}` }, `‹ ${pages[at - 1].id} ${pages[at - 1].title}`) : el('span'),
      at < pages.length - 1 ? el('a.btn', { href: `#/rules/${pages[at + 1].id}` }, `${pages[at + 1].id} ${pages[at + 1].title} ›`) : null));
  return { node, title: `${top.id} ${top.title}`, anchor: target.level === 3 ? 'sec-' + id : null, current: id };
}

function filterBox(placeholder, rows, text) {
  const list = el('div');
  const draw = (q = '') => list.replaceChildren(...rows.filter((r) => text(r).toLowerCase().includes(q)).map((r) => r.node));
  draw();
  return [el('input.search', { type: 'search', placeholder, 'aria-label': placeholder, oninput: (e) => draw(e.target.value.trim().toLowerCase()) }), list];
}

function glossaryPage(rules, term) {
  const key = (g) => g.term.replace(/\s*\(.*?\)\s*$/, '').toUpperCase();
  const rows = rules.glossary.map((g) => ({ g, node: el('div.ability', { id: 'term-' + key(g) }, el('b', g.term), el('p', rich(g.text, { skip: key(g) })), g.ref ? el('small.muted', g.ref) : null) }));
  return { title: 'Glossary', anchor: term ? 'term-' + term : null, current: 'glossary',
    node: el('article.card.article', el('h2', 'Glossary'), filterBox('Filter keywords', rows, (r) => r.g.term + ' ' + r.g.text)) };
}
function faqPage(rules, n) {
  const rows = rules.faq.map((f, i) => ({ f, node: el('div.ability', { id: 'faq-' + i }, el('b', f.q), el('p', rich(f.a))) }));
  return { title: 'FAQ', anchor: n != null ? 'faq-' + n : null, current: 'faq',
    node: el('article.card.article', el('h2', 'Frequently asked questions'), filterBox('Filter questions', rows, (r) => r.f.q + ' ' + r.f.a)) };
}
function abilitiesPage(rules, name) {
  const body = el('div');
  const draw = (faction) => {
    const rows = rules.abilities.filter((a) => a.faction === faction).map((a) => ({ a, node: el('div.ability', { id: 'ab-' + a.name },
      el('div', el('b', a.name), ' ', el('small.muted', [a.type, a.cost].filter(Boolean).join(' · '))), el('p', rich(a.text)), a.ref ? el('small.muted', a.ref) : null) }));
    body.replaceChildren(...filterBox('Filter abilities', rows, (r) => r.a.name + ' ' + r.a.text));
  };
  const factions = [...new Set(rules.abilities.map((a) => a.faction))];
  const start = rules.abilities.find((a) => a.name === name)?.faction || factions[0];
  draw(start);
  return { title: 'Abilities', anchor: name ? 'ab-' + name : null, current: 'abilities',
    node: el('article.card.article', el('h2', 'Abilities'), segmented(factions.map((f) => [f, FACTION_NAME[f.toLowerCase()] || f]), start, draw), body) };
}
function cardsPage() {
  const images = Object.entries(mediaData()?.rulesImages || {});
  const caption = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return { title: 'Card anatomy', current: 'cards',
    node: el('article.card', el('h2', 'Card anatomy'), el('p.muted', 'Reference pictures showing where each value sits on the cards.'),
      el('div.gallery', images.map(([k, src]) => el('figure', el('img', { src: MEDIA + src, alt: caption(k), loading: 'lazy' }), el('figcaption.small.muted', caption(k)))))) };
}

export async function render([first, second]) {
  const rules = await loadRules();
  index = index || buildIndex(rules);
  const page = first === 'glossary' ? glossaryPage(rules, second) : first === 'faq' ? faqPage(rules, second)
    : first === 'abilities' ? abilitiesPage(rules, second) : first === 'cards' ? cardsPage() : first ? sectionPage(rules, first) : null;

  const main = el('div.detail-col');
  const side = el('div.list-col');
  const layout = el('div.rules-layout.split');
  const input = el('input.search', { type: 'search', value: query, placeholder: 'Search rules, keywords, FAQ, units', 'aria-label': 'Search the rulebook',
    oninput: (e) => { query = e.target.value.trim(); typing = true; draw(); } });
  // Results show on the contents page and while typing; a result that was opened shows its page.
  let typing = false;
  function draw() {
    const searching = query.length > 1 && (typing || !page);
    // Phones show one column: the page or results when there is one, else the contents.
    layout.classList.toggle('has-detail', searching || Boolean(page));
    main.replaceChildren(...(searching ? [results(query)]
      : page ? [el('a.back', { href: '#/rules' }, '‹ Contents'), page.node]
        : [el('p.muted.center.pick', 'Pick a section, or search above.')]));
  }
  side.append(contents(rules, page?.current));
  layout.append(side, main);
  draw();
  const node = el('div.page', input, layout);
  if (page?.anchor) requestAnimationFrame(() => document.getElementById(page.anchor)?.scrollIntoView({ block: 'start' }));
  return { title: page?.title || 'Rulebook', node, keepScroll: Boolean(page?.anchor) };
}
