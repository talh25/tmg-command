// Units and cards: every unit's card, each faction's Faction, Tactical and Creep cards, and a voice board.
import { el, segmented, slug, FACTIONS, FACTION_NAME } from '../lib.js';
import { go } from '../app.js';
import { armyData, unitsOf, findUnit } from '../armies.js';
import { unitCard } from '../unitcard.js';
import { loadRules, rich } from '../ruletext.js';
import { mediaData, unitLine, MEDIA } from '../audio.js';

const TABS = [['units', 'Units'], ['cards', 'Cards'], ['voices', 'Voices']];
const SLOT_ORDER = ['Core', 'Elite', 'Support', 'Air', 'Hero'];
const slots = (s) => Object.entries(s || {}).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');

function unitList(faction, selected) {
  const units = [...unitsOf(faction)].sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) || a.name.localeCompare(b.name));
  const rows = el('div.list');
  const draw = (q = '') => rows.replaceChildren(...units.filter((u) => u.name.toLowerCase().includes(q)).map((u) =>
    el('a.list-row' + (u.id === selected ? '.on' : ''), { href: `#/codex/${faction}/${u.id}` },
      el('div', el('b', u.name), el('small.muted', `${u.slot} · HP ${u.stats.hp} · Speed ${u.stats.speed}`)),
      el('small.muted', u.sizes.map((s) => s.cost).join(' / ')))));
  draw();
  return el('div.list-col',
    el('input.search', { type: 'search', placeholder: `Search ${FACTION_NAME[faction]} units`, 'aria-label': 'Search units', oninput: (e) => draw(e.target.value.trim().toLowerCase()) }),
    rows);
}

function abilityList(list) {
  return (list || []).map((a) => el('div.ability', el('div', el('b', a.name), ' ', el('small.muted', [a.type, a.phase, a.cost].filter(Boolean).join(' · '))), el('p', rich(a.text))));
}

function cardsTab(faction) {
  const d = armyData()[faction];
  const media = mediaData();
  const tactical = (c) => {
    const b = media?.buildings[slug(c.name)];
    return el('article.card',
      el('div.card-row',
        b?.image ? el('img.thumb', { src: MEDIA + b.image, alt: '', loading: 'lazy' }) : null,
        el('div', el('h3', c.name), el('small.muted', [`${c.gas} gas`, slots(c.slots) && `adds ${slots(c.slots)}`, c.unique && 'Unique', c.factionReq && `needs ${c.factionReq}`].filter(Boolean).join(' · '))),
        b ? el('button.btn.small', { onclick: () => unitLine(slug(c.name), 'tap') }, '▶') : null),
      abilityList(c.abilities));
  };
  return el('div.cards',
    el('h2', 'Faction cards'),
    d.factionCards.map((c) => el('article.card', el('h3', c.name), el('small.muted', `Army slots: ${slots(c.slots)}`), abilityList(c.abilities))),
    el('h2', 'Tactical cards'),
    d.tacticalCards.map(tactical),
    d.creepCards?.length ? [el('h2', 'Creep cards'), d.creepCards.map((c) => el('article.card', el('h3', c.name), el('small.muted', `${c.gas} gas`), el('p', rich(c.text))))] : null);
}

function voicesTab(faction) {
  const media = mediaData();
  if (!media) return el('p.muted', 'Voices could not load.');
  const kinds = [['move', 'Move'], ['attack', 'Attack'], ['death', 'Death'], ['chatter', 'Chatter']];
  const row = (id, e, list) => el('div.list-row', el('b', e.name), el('div.row', list.filter(([k]) => e.voices[k]?.length)
    .map(([k, label]) => el('button.btn.small', { onclick: () => unitLine(id, k) }, label))));
  const of = (group) => Object.entries(group).filter(([, e]) => e.faction === faction);
  return el('div.cards',
    el('section.card', el('h2', 'Units and heroes'), el('div.list', of(media.units).map(([id, e]) => row(id, e, kinds)))),
    el('section.card', el('h2', 'Buildings'), el('div.list', of(media.buildings).map(([id, e]) => row(id, e, [['tap', 'Play']])))));
}

export async function render([faction = 'terran', sub = '']) {
  if (!FACTIONS.includes(faction)) faction = 'terran';
  await loadRules().catch(() => {});   // without the rulebook, cards still show, just without keyword links
  const tab = sub === 'cards' || sub === 'voices' ? sub : 'units';
  const unit = tab === 'units' ? findUnit(faction, sub) : null;
  const head = el('div.codex-head',
    segmented(FACTIONS.map((f) => [f, FACTION_NAME[f]]), faction, (f) => go('codex', f, ...(tab === 'units' ? [] : [tab]))),
    segmented(TABS, tab, (t) => go('codex', faction, ...(t === 'units' ? [] : [t])), 'small'));
  const body = tab === 'cards' ? cardsTab(faction) : tab === 'voices' ? voicesTab(faction)
    : el('div.split' + (unit ? '.has-detail' : ''),
      unitList(faction, unit?.id),
      el('div.detail-col', unit
        ? [el('a.back', { href: `#/codex/${faction}` }, '‹ All units'), el('section.card', unitCard(unit))]
        : el('p.muted.center.pick', 'Pick a unit to see its card.')));
  return {
    title: unit ? unit.name : `${FACTION_NAME[faction]} units`,
    node: el('div.page', { style: { '--accent': `var(--${faction})` } }, head, body),
  };
}
