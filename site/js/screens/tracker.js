// Unit sheet for one player during a game: status, damage, Non-Lethal Damage, models, shields,
// ability use and stat cards per unit. Every change is written to the game log.
import { el, dialog, toast, confirmBox, clamp, segmented } from '../lib.js';
import { game, note, saveGame, supplyPool, supplyOnTable, poolText } from '../game.js';
import { unitsOf, findUnit, rosterById, rosterToUnits, trackUnit, condition, profile } from '../armies.js';
import { rich } from '../ruletext.js';
import { openLog } from './log.js';
import { showUnitCards } from '../unitcard.js';
import { unitLine } from '../audio.js';

const STATUS = [['reserve', 'Reserve'], ['field', 'On table'], ['lost', 'Lost']];

export function openUnitSheet(player, onChange) {
  let filter = 'all';
  let close = null;
  const body = el('div.unit-sheet', { style: { '--accent': `var(--${player.faction})` } });
  const changed = () => { saveGame(); draw(); onChange?.(); };
  const roster = () => rosterById(player.roster);
  const me = game.players.indexOf(player);
  const log = (text, key, n) => note(text, { player: me, key: key || null, n: n || 0 });
  const left = (t) => { const c = condition(t); return c.alive ? `${c.alive} of ${t.models} models left` : 'destroyed'; };

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
    if (status !== 'lost' && condition(t).alive === 0) { t.damage = 0; t.nl = 0; }   // bringing a wiped unit back heals it
    if (status !== t.status) log(`${t.name} ${{ field: 'deployed to the table', reserve: 'moved to reserve', lost: 'marked as lost' }[status]}`);
    t.status = status;
    changed();
  }
  function wound(t, delta) {
    const before = condition(t).alive;
    const max = t.models * t.hp;
    let folded = 0;
    if (delta > 0) {
      // Standard damage: Non-Lethal Damage already on the marker now counts towards casualties.
      folded = t.nl || 0;
      t.damage = clamp(t.damage + delta + folded, 0, max);
      t.nl = 0;
    } else if (t.nl) t.nl -= 1;            // healing takes Non-Lethal Damage off first
    else t.damage = clamp(t.damage - 1, 0, max);
    const after = condition(t).alive;
    if (folded) log(`${t.name}: ${folded} Non-Lethal Damage now counts`);
    log((n) => (n > 0 ? `${t.name} took ${n} damage · ${left(t)}` : `${t.name} healed ${-n} damage · ${left(t)}`), 'dmg:' + t.key, delta);
    if (after === 0) { t.status = 'lost'; unitLine(findUnit(t.faction, t.id)?.voiceId, 'death'); } else if (t.status === 'lost') t.status = 'field';
    if (after < before && after > 0) navigator.vibrate?.(15);
    changed();
  }

  /** Non-Lethal Damage goes on the Damage Marker but removes no models until the next standard damage. */
  function nonLethal(t, delta) {
    const before = t.nl || 0;
    t.nl = clamp(before + delta, 0, Math.max(0, t.models * t.hp - t.damage));
    log((n) => (n > 0 ? `${t.name} suffered ${n} Non-Lethal Damage` : `${t.name}: ${-n} Non-Lethal Damage removed`), 'nl:' + t.key, t.nl - before);
    changed();
  }
  const usedNow = (t, a) => (t.uses?.[a.name]?.round === game.round ? t.uses[a.name].n : 0);
  function useAbility(t, a) {
    t.uses ||= {};
    const use = t.uses[a.name];
    t.uses[a.name] = { round: game.round, n: usedNow(t, a) + 1, total: (use?.total || 0) + 1 };
    log(`${t.name} used ${a.name}${a.cost ? ` (${a.cost})` : ''}`);
    const self = /this unit suffers non-lethal damage \((\d+)\)/i.exec(a.text || '');
    if (self) { nonLethal(t, Number(self[1])); toast(`${a.name}: ${self[1]} Non-Lethal Damage added`); } else changed();
  }
  function undoAbility(t, a) {
    const use = t.uses?.[a.name];
    if (!use || !usedNow(t, a)) return;
    use.n -= 1; use.total -= 1;
    if (!use.total) delete t.uses[a.name];
    log(`${t.name}: use of ${a.name} undone`);
    changed();
  }
  function abilityDialog(t, a) {
    dialog((done) => [
      el('h3', a.name),
      el('p.small.muted', [a.upgrade && `from ${a.upgrade}`, a.type, a.phase && `${a.phase} Phase`, a.cost].filter(Boolean).join(' · ')),
      el('p', rich(a.text || '')),
      el('p.small.muted', usedNow(t, a) ? `Used ${usedNow(t, a)}× this round · ${t.uses[a.name].total}× this game.` : t.uses?.[a.name] ? `Not used this round · ${t.uses[a.name].total}× this game.` : 'Not used yet.'),
      el('div.actions',
        usedNow(t, a) ? el('button.btn', { onclick: () => { done(); undoAbility(t, a); } }, 'Undo last use') : null,
        el('button.btn', { onclick: done }, 'Close'),
        el('button.btn.primary', { onclick: () => { done(); useAbility(t, a); } }, usedNow(t, a) ? 'Use again' : 'Use ability'))]);
  }
  function abilityChips(t, u) {
    const list = profile(u, t).abilities.filter((a) => a.type && a.type !== 'Passive');
    if (!list.length) return null;
    return el('div.ability-uses', el('small.muted', 'Abilities'),
      list.map((a) => { const n = usedNow(t, a); return el('button.chip.use' + (n ? '.used' : ''), { 'aria-pressed': String(n > 0), onclick: () => abilityDialog(t, a) },
        n ? `✓ ${a.name}${n > 1 ? ` ×${n}` : ''}` : a.name, a.cost ? el('small', ` ${a.cost}`) : null); }));
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
          if (await confirmBox('Remove unit?', `${t.name} is taken off this player's sheet for this game.`, 'Remove')) { player.units = player.units.filter((x) => x !== t); log(`${t.name} removed from the sheet`); changed(); }
        } }, '×')),
      segmented(STATUS, t.status, (s) => setStatus(t, s), 'small'),
      el('div.wounds',
        el('button.round', { 'aria-label': 'Heal one damage', disabled: c.marker === 0, onclick: () => wound(t, -1) }, '−'),
        el('div.wounds-mid', dots(t.models, c.alive, 'models'), c.alive ? dots(t.hp, c.hpLeft, 'pips') : null,
          el('small.muted', c.alive ? `Wounded model: ${c.hpLeft} of ${t.hp} HP · marker ${c.marker}` : 'Destroyed')),
        el('button.round.hit', { 'aria-label': 'Take one damage', disabled: !c.alive, onclick: () => wound(t, 1) }, '+'),
        el('button.round', { 'aria-label': 'Remove one model', title: 'Remove one model', disabled: !c.alive, onclick: () => wound(t, c.hpLeft) }, '☠')),
      c.alive ? el('div.nl' + (c.nl ? '.on' : ''),
        el('small', el('b', 'Non-lethal '), c.nl ? `${c.nl} on the marker · no models removed until the next damage` : 'none'),
        el('button.btn.small', { 'aria-label': 'Remove one Non-Lethal Damage', disabled: !c.nl, onclick: () => nonLethal(t, -1) }, '−'),
        el('button.btn.small', { 'aria-label': 'Add one Non-Lethal Damage', disabled: c.marker >= t.models * t.hp, onclick: () => nonLethal(t, 1) }, '+ Non-lethal')) : null,
      u && c.alive ? abilityChips(t, u) : null,
      t.shields ? el('div.shields',
        el('small', el('b', 'Shields '), `${t.shields - t.shieldDamage} of ${t.shields}`),
        el('button.btn.small', { disabled: t.shieldDamage >= t.shields, onclick: () => { t.shieldDamage = clamp(t.shieldDamage + 1, 0, t.shields); log((n) => `${t.name} lost ${n} shield${n > 1 ? 's' : ''} · ${t.shields - t.shieldDamage} left`, 'sh:' + t.key, 1); changed(); } }, '− Shield'),
        el('button.btn.small', { disabled: !t.shieldDamage, onclick: () => { t.shieldDamage = 0; log(`${t.name} recharged its shields`); changed(); } }, 'Recharge')) : null);
  }

  function addUnit() {
    dialog((done) => [
      el('h3', 'Add a unit'), el('p.muted.small', 'Pick the unit size to add it to this player\'s sheet.'),
      el('div.list', unitsOf(player.faction).map((u) => el('div.list-row', el('div', el('b', u.name), ' ', el('small.muted', u.slot)),
        el('div.row', u.sizes.map((s, i) => el('button.btn.small', { onclick: () => { player.units.push(trackUnit(player.faction, u, null, i)); log(`${u.name} (${s.models} models) added to the sheet`); done(); changed(); } }, `${s.models} models`)))))),
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
        el('button.btn', { onclick: openLog }, 'Log'),
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

