// Unit sheet for one player during a game: status, wounds, models, shields and stat cards per unit.
import { el, dialog, toast, confirmBox, clamp, segmented } from '../lib.js';
import { saveGame, supplyPool, supplyOnTable, poolText } from '../game.js';
import { unitsOf, findUnit, rosterById, rosterToUnits, trackUnit, condition } from '../armies.js';
import { showUnitCards } from '../unitcard.js';
import { unitLine } from '../audio.js';

const STATUS = [['reserve', 'Reserve'], ['field', 'On table'], ['lost', 'Lost']];

export function openUnitSheet(player, onChange) {
  let filter = 'all';
  let close = null;
  const body = el('div.unit-sheet', { style: { '--accent': `var(--${player.faction})` } });
  const changed = () => { saveGame(); draw(); onChange?.(); };
  const roster = () => rosterById(player.roster);

  function loadList() {
    const r = roster();
    if (!r) { toast('This player has no army list. Pick one before the game, or add units here.'); return; }
    player.units = rosterToUnits(r);
    changed();
  }

  function setStatus(t, status) {
    if (status === 'field' && t.status !== 'field') {
      const after = supplyOnTable(player) + condition(t).supply;
      if (after > supplyPool()) toast(`Over the Supply Pool: ${after} of ${poolText(supplyPool())}`);
      unitLine(findUnit(t.faction, t.id)?.voiceId, 'move');
    }
    if (status !== 'lost' && condition(t).alive === 0) t.damage = 0;   // bringing a wiped unit back heals it
    t.status = status;
    changed();
  }
  function wound(t, delta) {
    const before = condition(t).alive;
    t.damage = clamp(t.damage + delta, 0, t.models * t.hp);
    const after = condition(t).alive;
    if (after === 0) { t.status = 'lost'; unitLine(findUnit(t.faction, t.id)?.voiceId, 'death'); } else if (t.status === 'lost') t.status = 'field';
    if (after < before && after > 0) navigator.vibrate?.(15);
    changed();
  }

  function card(t) {
    const u = findUnit(t.faction, t.id);
    const c = condition(t);
    const dots = (n, on, cls) => el('div.' + cls, Array.from({ length: n }, (_, i) => el('span' + (i < on ? '.on' : ''))));
    return el('article.tracked' + (c.lost ? '.lost' : '') + (t.status === 'field' ? '.field' : ''),
      el('div.tracked-head',
        el('div', el('b', t.name), el('small.muted', `${c.alive} of ${t.models} models · supply ${c.supply}`)),
        u ? el('button.btn.small', { onclick: () => showUnitCards([{ u, entry: t }]) }, 'Card') : null,
        el('button.icon-btn', { 'aria-label': `Remove ${t.name}`, onclick: async () => {
          if (await confirmBox('Remove unit?', `${t.name} is taken off this player's sheet for this game.`, 'Remove')) { player.units = player.units.filter((x) => x !== t); changed(); }
        } }, '×')),
      segmented(STATUS, t.status, (s) => setStatus(t, s), 'small'),
      el('div.wounds',
        el('button.round', { 'aria-label': 'Heal one wound', disabled: t.damage === 0, onclick: () => wound(t, -1) }, '−'),
        el('div.wounds-mid', dots(t.models, c.alive, 'models'), c.alive ? dots(t.hp, c.hpLeft, 'pips') : null,
          el('small.muted', c.alive ? `Wounded model: ${c.hpLeft} of ${t.hp} HP` : 'Destroyed')),
        el('button.round.hit', { 'aria-label': 'Take one wound', disabled: !c.alive, onclick: () => wound(t, 1) }, '+'),
        el('button.round', { 'aria-label': 'Remove one model', title: 'Remove one model', disabled: !c.alive, onclick: () => wound(t, c.hpLeft) }, '☠')),
      t.shields ? el('div.shields',
        el('small', el('b', 'Shields '), `${t.shields - t.shieldDamage} of ${t.shields}`),
        el('button.btn.small', { disabled: t.shieldDamage >= t.shields, onclick: () => { t.shieldDamage = clamp(t.shieldDamage + 1, 0, t.shields); changed(); } }, '− Shield'),
        el('button.btn.small', { disabled: !t.shieldDamage, onclick: () => { t.shieldDamage = 0; changed(); } }, 'Recharge')) : null);
  }

  function addUnit() {
    dialog((done) => [
      el('h3', 'Add a unit'), el('p.muted.small', 'Pick the unit size to add it to this player\'s sheet.'),
      el('div.list', unitsOf(player.faction).map((u) => el('div.list-row', el('div', el('b', u.name), ' ', el('small.muted', u.slot)),
        el('div.row', u.sizes.map((s, i) => el('button.btn.small', { onclick: () => { player.units.push(trackUnit(player.faction, u, null, i)); done(); changed(); } }, `${s.models} models`)))))),
      el('div.actions', el('button.btn.primary', { onclick: done }, 'Done'))]);
  }

  function draw() {
    const all = player.units;
    const pool = supplyPool();
    const used = supplyOnTable(player);
    const shown = all.filter((t) => filter === 'all' || (filter === 'lost' ? condition(t).lost : t.status === filter && !condition(t).lost));
    const r = roster();
    body.replaceChildren(
      el('div.sheet-head',
        el('div', el('h3', player.name), el('small.muted', r ? r.name : 'No army list')),
        el('div.pool' + (used > pool ? '.over' : ''), el('small', 'On table'), el('b', `${used} / ${poolText(pool)}`))),
      segmented([['all', `All ${all.length}`], ['field', 'On table'], ['reserve', 'Reserve'], ['lost', 'Lost']], filter, (f) => { filter = f; draw(); }, 'small'),
      el('div.tracked-list', shown.length ? shown.map(card)
        : el('p.muted.center', all.length ? 'No units here.' : 'No units yet. Load the army list or add units.')),
      el('div.actions',
        r ? el('button.btn', { onclick: async () => {
          if (!all.length || await confirmBox('Reload the army list?', 'This replaces the tracked units, and their wounds, with a fresh copy of the list.', 'Reload')) loadList();
        } }, all.length ? 'Reload list' : 'Load army list') : null,
        el('button.btn', { onclick: addUnit }, 'Add unit'),
        el('button.btn.primary', { onclick: () => close?.() }, 'Done')));
  }

  if (!player.units.length && roster()) { player.units = rosterToUnits(roster()); saveGame(); onChange?.(); }
  draw();
  close = dialog(() => body, { sheet: true });
}

/** "5 on table · 2 in reserve · 1 lost" */
export function unitSummary(player) {
  const n = { field: 0, reserve: 0, lost: 0 };
  for (const t of player.units) n[condition(t).lost ? 'lost' : t.status] += 1;
  return `${n.field} on table · ${n.reserve} in reserve · ${n.lost} lost`;
}

