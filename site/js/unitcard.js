// Unit cards: stats, weapons, abilities and upgrades of a unit, with a list entry's upgrades applied.
import { el, dialog, segmented } from './lib.js';
import { profile } from './armies.js';
import { rich, keywordChip } from './ruletext.js';
import { unitLine, mediaData } from './audio.js';

const stat = (label, value) => (value == null || value === '' ? null : el('div.stat', el('small', label), el('b', String(value))));
const meta = (...parts) => parts.filter(Boolean).join(' · ');

function weaponRow(w) {
  const surge = w.surge && w.surge !== '-' ? `Surge vs ${w.surge}${w.sdice && w.sdice !== '-' ? ' ' + w.sdice : ''}` : null;
  return el('div.weapon',
    el('div.weapon-head', el('b', w.name), el('small.muted', meta(w.upgrade && `from ${w.upgrade}`, w.phase, w.target && `targets ${w.target}`, surge))),
    el('div.weapon-stats', stat('Range', w.range), stat('Attacks', w.roa), stat('Hit', w.hit), stat('Damage', w.dmg)),
    w.keywords?.length ? el('div.chips', w.keywords.map(keywordChip)) : null);
}

function abilityRow(a) {
  return el('div.ability',
    el('div', el('b', a.name), ' ', el('small.muted', meta(a.upgrade && `from ${a.upgrade}`, a.type, a.phase, a.cost))),
    el('p', rich(a.text)));
}

function upgradeRow(u, g, entry) {
  const cost = [...new Set(g.costs)].join(' / ');
  const taken = Boolean(entry?.ups?.[g.id]);
  const does = g.ability?.text || (g.effects || []).map((x) => (
    x.op === 'replaceWeapon' ? `Replaces ${x.target} with ${x.weapon.name}` : x.op === 'addWeapon' ? `Adds ${x.weapon.name}`
      : x.op === 'weaponKeyword' ? `${x.weapon} gains ${x.add}` : x.op === 'weaponField' ? `${x.weapon}: ${x.field} becomes ${x.value}`
        : x.op === 'stat' ? `${x.stat} ${x.delta > 0 ? '+' : ''}${x.delta}` : x.op === 'supply' ? `Supply becomes ${x.value}` : '')).filter(Boolean).join('. ');
  return el('div.upgrade' + (taken ? '.taken' : ''),
    el('div', el('b', g.name), ' ', el('small.muted', meta(`${cost} minerals`, g.specialist && 'one model', taken && 'taken'))),
    does ? el('p.small', rich(does)) : null);
}

/** Voice buttons for a unit that has voice lines. */
export function voiceButtons(voiceId) {
  const voices = mediaData()?.units[voiceId]?.voices;
  if (!voices) return null;
  const labels = { move: 'Move', attack: 'Attack', death: 'Death', chatter: 'Chatter' };
  return el('div.voices', Object.keys(labels).filter((k) => voices[k]?.length).map((k) =>
    el('button.btn.small', { onclick: () => unitLine(voiceId, k) }, '▶ ' + labels[k])));
}

/** Full card for a unit. entry ({ size, ups }) is optional: with it, the card shows that list entry's profile. */
export function unitCard(u, entry = null) {
  const p = profile(u, entry);
  const s = p.stats;
  const size = entry ? u.sizes[entry.size] : null;
  return el('div.unit-card',
    el('div.unit-head',
      el('div', el('h2', u.name), el('p.muted.small', meta(u.slot, u.unique && 'Unique', size ? `${size.models} models` : null, size ? `${size.cost} minerals` : null))),
      voiceButtons(u.voiceId)),
    u.tags?.length ? el('div.chips', u.tags.map(keywordChip)) : null,
    el('div.stats', stat('HP', s.hp), stat('Armour', s.armour), stat('Evade', s.evade), stat('Speed', s.speed), stat('Shields', s.shields), stat('Size', s.size)),
    size ? null : el('p.small.muted', 'Sizes: ' + u.sizes.map((z) => `${z.models} models, ${z.cost} minerals, supply ${z.supply}`).join(' · ')),
    u.supplyChart ? el('p.small.muted', 'Supply by models left: ' + u.supplyChart) : null,
    p.weapons.length ? [el('h3', 'Weapons'), p.weapons.map(weaponRow)] : null,
    p.abilities.length ? [el('h3', 'Abilities'), p.abilities.map(abilityRow)] : null,
    u.upgrades?.length ? [el('h3', 'Upgrades'), u.upgrades.map((g) => upgradeRow(u, g, entry))] : null);
}

/** Dialog with one or more unit cards (tabs when several). entries: [{ u, entry }] */
export function showUnitCards(entries) {
  dialog((close) => {
    const body = el('div');
    const draw = (i) => body.replaceChildren(unitCard(entries[i].u, entries[i].entry));
    draw(0);
    return [
      entries.length > 1 ? segmented(entries.map((x, i) => [i, x.u.name]), 0, draw, 'wrap') : null,
      body, el('div.actions', el('button.btn.primary', { onclick: close }, 'Close'))];
  }, { wide: true });
}
