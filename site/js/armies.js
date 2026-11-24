// Army data: the builder's unit and card data (data/army.json), the lists saved by the Army Builder
// page (it shares localStorage with the app), and the maths for upgrades, supply and wounds.
import { store, loadJson, uid } from './lib.js';

let army = null;
export async function loadArmy() { army = army || await loadJson('data/army.json'); return army; }
export const armyData = () => army;
export const unitsOf = (faction) => army?.[faction]?.units || [];
export const findUnit = (faction, id) => unitsOf(faction).find((u) => u.id === id) || null;

// ---------- saved lists ----------
/** Every list the builder knows: saved lists, plus each faction's unsaved working list if it has units. */
export function listRosters() {
  const out = [];
  for (const s of store.get('sctmg-saved', []) || []) {
    try {
      const l = JSON.parse(s.list);
      out.push({ id: s.id, faction: s.faction, name: l.name || 'Untitled list', units: l.units || [], updated: s.updated || 0 });
    } catch { /* unreadable list: skip it */ }
  }
  const working = store.get('sctmg-builder', null)?.lists || {};
  for (const [faction, l] of Object.entries(working)) {
    if (!l?.units?.length || (l.savedId && out.some((r) => r.id === l.savedId))) continue;
    out.push({ id: 'draft:' + faction, faction, name: (l.name || 'Unsaved list') + ' (draft)', units: l.units, updated: 0 });
  }
  return out.sort((a, b) => b.updated - a.updated);
}
export const rosterById = (id) => (id ? listRosters().find((r) => r.id === id) || null : null);

/** Minerals and supply of a list, using the builder's cost rules. */
export function rosterTotals(r) {
  let minerals = 0, supply = 0;
  for (const e of r.units) {
    const u = findUnit(r.faction, e.id);
    if (!u) continue;
    const size = u.sizes[e.size] || u.sizes[0];
    minerals += size.cost;
    supply += size.supply;
    for (const g of u.upgrades || []) {
      if (!e.ups?.[g.id]) continue;
      minerals += (g.costs[e.size] ?? g.costs[0]) || 0;
      for (const x of g.effects || []) if (x.op === 'supply') supply += x.value - size.supply;
    }
  }
  return { minerals, supply };
}

// ---------- upgrades ----------
/** A unit's profile with the upgrades of a list entry applied. entry: { size, ups: { upgradeId: true } } */
export function profile(u, entry) {
  const stats = { ...(u.stats || {}) };
  const weapons = (u.weapons || []).map((w) => ({ ...w, keywords: [...(w.keywords || [])] }));
  const abilities = [...(u.abilities || [])];
  const taken = entry ? (u.upgrades || []).filter((g) => entry.ups?.[g.id]) : [];
  let fixedSupply = null;
  for (const g of taken) {
    if (g.ability) abilities.push({ ...g.ability, upgrade: g.name });
    for (const x of g.effects || []) {
      const named = (w) => w.name === (x.weapon?.name ? x.target : x.weapon);
      if (x.op === 'replaceWeapon') {
        const w = { ...x.weapon, keywords: [...(x.weapon.keywords || [])], upgrade: g.name };
        const i = weapons.findIndex(named);
        // A specialist upgrade re-arms one model only, so the unit keeps the original weapon too.
        if (i < 0 || g.specialist) weapons.push(w); else weapons[i] = w;
      } else if (x.op === 'addWeapon') weapons.push({ ...x.weapon, keywords: [...(x.weapon.keywords || [])], upgrade: g.name });
      else if (x.op === 'weaponKeyword') weapons.filter(named).forEach((w) => w.keywords.push(x.add));
      else if (x.op === 'weaponField') weapons.filter(named).forEach((w) => { w[x.field] = x.value; });
      else if (x.op === 'stat' && typeof stats[x.stat] === 'number') stats[x.stat] += x.delta;
      else if (x.op === 'supply') fixedSupply = x.value;
    }
  }
  return { stats, weapons, abilities, taken, fixedSupply };
}

/** Supply a unit costs with this many models left, from its chart ("1-3: 0 · 4-6: 1 · 7-9: 2"). */
export function supplyFor(u, models, fixedSupply = null) {
  if (models <= 0) return 0;
  if (fixedSupply != null) return fixedSupply;
  for (const part of String(u.supplyChart || '').split('·')) {
    const m = part.match(/(\d+)(?:\s*-\s*(\d+))?\s*:\s*(\d+)/);
    if (m && models >= +m[1] && models <= +(m[2] || m[1])) return +m[3];
  }
  const size = u.sizes?.find((z) => z.models >= models) || u.sizes?.at(-1);
  return size?.supply ?? 0;
}

// ---------- units tracked during a game ----------
/** A unit on a player's game sheet. status: 'reserve' | 'field' | 'lost' */
export function trackUnit(faction, u, entry = null, sizeIndex = 0) {
  const size = entry ? entry.size : sizeIndex;
  const p = profile(u, entry);
  return {
    key: uid(), id: u.id, faction, name: u.name, size, ups: entry?.ups || {},
    models: (u.sizes[size] || u.sizes[0]).models, hp: Number(p.stats.hp) || 1, damage: 0,
    shields: Number(p.stats.shields) || 0, shieldDamage: 0, status: 'reserve',
  };
}
export function rosterToUnits(r) {
  if (!r) return [];
  return r.units.map((e) => { const u = findUnit(r.faction, e.id); return u ? trackUnit(r.faction, u, e) : null; }).filter(Boolean);
}
/** Models left, HP left on the wounded model, and current supply of a tracked unit. */
export function condition(t) {
  const alive = t.models - Math.min(t.models, Math.floor(t.damage / t.hp));
  const u = findUnit(t.faction, t.id);
  return {
    alive,
    hpLeft: alive ? t.hp - (t.damage % t.hp) : 0,
    supply: u ? supplyFor(u, alive, profile(u, t).fixedSupply) : 0,
    lost: alive === 0 || t.status === 'lost',
  };
}
