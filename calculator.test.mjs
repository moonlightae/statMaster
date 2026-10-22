import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, validate, evaluate, derivatives, optimize, buildSlots, attackInterval, fromTotals, upgrades } from './public/calculator.mjs';

function example(extra = {}) {
  return { ...Object.fromEntries(STATS.map(({ key }) => [key, 0])), style: 'ranged', baseDamage: 1000, baseHealth: 10000,
    critChance: 50, critDamage: 80, doubleChance: 20, damage: 15, ranged: 15, attackSpeed: 100,
    regen: 4, lifesteal: 20, health: 15, ...extra };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * 1e-6), actual + ' != ' + expected);

test('wiki multiplicative bonuses, crit expectation and additive healing match a hand calculation', () => {
  const b = example();
  validate(b);
  const r = evaluate(b);
  near(r.totalDamage, 1322.5);
  near(r.totalHealth, 11500);
  near(r.dps, 4443.6 / 1.7);
  near(r.hps, 460 + 888.72 / 1.7);
  near(evaluate(example({ style: 'melee', melee: 50 })).dps, 5796 / 1.7);
  near(evaluate(example({ skillDamage: 900, skillCooldown: -70, block: 99 })).dps, r.dps);
});

test('analytic partial derivatives match one-sided finite differences including probability caps', () => {
  for (const b of [example(), example({ critChance: 100, doubleChance: 100 }), example({ regen: 0, lifesteal: 0, critChance: 0 })]) {
    const slopes = derivatives(b);
    for (const metric of ['dps', 'hps']) {
      for (const [key, expected] of Object.entries(slopes[metric])) {
        const step = .0001;
        near((evaluate({ ...b, [key]: b[key] + step })[metric] - evaluate(b)[metric]) / step, expected);
      }
    }
  }
});

test('probability caps, attack interval boundaries and bad inputs', () => {
  near(evaluate(example({ critChance: 120, doubleChance: 140 })).dps, evaluate(example({ critChance: 100, doubleChance: 100 })).dps);
  near(attackInterval(0), 1.7);
  near(attackInterval(100), .85);
  near(attackInterval(200), 1.7 / 3);
  near(attackInterval(400), 1.7 / 5);
  for (const extra of [{ baseDamage: 0 }, { baseHealth: Infinity }, { critChance: NaN }, { regen: -1 }, { critDamage: 19 }, { style: 'invalid' }]) {
    assert.throws(() => validate(example(extra)));
  }
  assert.throws(() => validate(null));
});

test('slot pairing preserves all counts, 9 gear + 3 pets and uniqueness on every item', () => {
  for (const counts of [{ damage: 12, health: 12 }, { a: 12, b: 3, c: 3, d: 2, e: 2, f: 2 }, { a: 8, b: 8, c: 8 }]) {
    const slots = buildSlots(counts);
    assert.equal(slots.length, 12);
    assert.equal(slots.filter(slot => slot.name.startsWith('장비')).length, 9);
    assert.equal(slots.filter(slot => slot.name.startsWith('펫')).length, 3);
    const actual = {};
    for (const slot of slots) {
      assert.equal(new Set(slot.keys).size, 2);
      slot.keys.forEach(key => actual[key] = (actual[key] || 0) + 1);
    }
    assert.deepEqual(actual, counts);
  }
  assert.throws(() => buildSlots({ damage: 13, health: 11 }));
  assert.throws(() => buildSlots({ damage: 12 }));
});

test('joint optimizer respects item limits and maximizes the combined objective against feasible alternatives', () => {
  for (const style of ['ranged', 'melee']) {
    const b = example({ style });
    const result = optimize(b);
    const keys = ['critChance', 'critDamage', 'doubleChance', 'damage', style, 'attackSpeed', 'lifesteal', 'regen', 'health'];
    const score = values => Math.log(values.dps) + Math.log(values.hps);
    const evaluateCounts = counts => evaluate({
      ...b,
      ...Object.fromEntries(STATS.map(({ key, max }) => [key, (counts[key] || 0) * max + (key === 'critDamage' ? 20 : 0)])),
    });
    assert.equal(Object.values(result.counts).reduce((a, n) => a + n, 0), 24);
    assert.ok(Object.values(result.counts).every(n => n <= 12 && n >= 0));
    assert.equal(result.slots.length, 12);
    assert.equal(result.slots.filter(slot => slot.name.startsWith('장비')).length, 9);
    assert.ok(result.slots.every(slot => slot.keys[0] !== slot.keys[1]));
    near(result.dps, evaluate(result.stats).dps);
    near(result.hps, evaluate(result.stats).hps);
    assert.equal(result.stats.critDamage, 20 + result.counts.critDamage * 80);
    assert.ok(result.dps > 0 && result.hps > 0);

    // A full search result must beat every feasible one-slot exchange.
    for (const from of keys) {
      for (const to of keys) {
        if (from === to || !result.counts[from] || result.counts[to] >= 12) continue;
        const counts = { ...result.counts, [from]: result.counts[from] - 1, [to]: result.counts[to] + 1 };
        assert.ok(score(result) >= score(evaluateCounts(counts)) - 1e-10);
      }
    }

    // Independently sample complete feasible allocations across all nine variables.
    let seed = 12345;
    for (let trial = 0; trial < 400; trial++) {
      const counts = Object.fromEntries(keys.map(key => [key, 0]));
      for (let slot = 0; slot < 24; slot++) {
        const allowed = keys.filter(key => counts[key] < 12);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        counts[allowed[seed % allowed.length]]++;
      }
      assert.ok(score(result) >= score(evaluateCounts(counts)) - 1e-10);
    }
  }
});

test('joint objective handles no initial healing and preserves the result under common unit scaling', () => {
  const b = example({ regen: 0, lifesteal: 0 });
  const result = optimize(b);
  assert.ok(result.dps > 0 && result.hps > 0);
  const scaled = optimize({ ...b, baseDamage: b.baseDamage * 1e6, baseHealth: b.baseHealth * 1e6 });
  near(scaled.dps / 1e6, result.dps);
  near(scaled.hps / 1e6, result.hps);
  const ranked = upgrades(b);
  assert.ok(Number.isFinite(ranked[0].score));
  assert.ok(ranked[0].hpsGain > 0);
  assert.equal(ranked[0].gain, null);
});
test('post-bonus profile totals are used exactly once, with a frozen baseline for comparisons', () => {
  const input = { ...example(), totalDamage: 1e6, totalHealth: 1e7, damage: 50, ranged: 50, health: 50 };
  const normalized = fromTotals(input);
  near(evaluate(normalized).totalDamage, 1e6);
  near(evaluate(normalized).totalHealth, 1e7);
  near(evaluate({ ...normalized, damage: 65 }).totalDamage, 1e6 * 1.65 / 1.5);
  near(evaluate({ ...normalized, health: 65 }).totalHealth, 1e7 * 1.65 / 1.5);
  assert.throws(() => fromTotals({ ...input, totalDamage: 0 }));
  near(evaluate(fromTotals(input)).interval, 1.7 / 2);
});

test('attack speed 100% doubles DPS relative to 0% with all other inputs fixed', () => {
  const slow = example({ attackSpeed: 0 });
  const fast = example({ attackSpeed: 100 });
  near(evaluate(fast).dps, evaluate(slow).dps * 2);
  near(evaluate(fast).lifestealHps, evaluate(slow).lifestealHps * 2);
  near(evaluate(fast).regenHps, evaluate(slow).regenHps);
});

test('displayed crit damage includes the free 20%, also in crit lifesteal', () => {
  const b = example({ critChance: 100, critDamage: 20, damage: 0, ranged: 0, attackSpeed: 0, doubleChance: 0, regen: 0, lifesteal: 10 });
  near(evaluate(b).dps, 1200 / 1.7);
  near(evaluate(b).hps, 120 / 1.7);
  near(evaluate({ ...b, critDamage: 100 }).dps, 2000 / 1.7);
  near(evaluate({ ...b, critDamage: 100 }).hps, 200 / 1.7);
});

test('passive regeneration is total health times rate per second', () => {
  const b = example({ baseHealth: 10000, health: 50, regen: 4, lifesteal: 0 });
  near(evaluate(b).hps, 15000 * .04);
});

test('old saved attack intervals cannot override the common comparison baseline', () => {
  near(evaluate(example({ baseInterval: .01 })).dps, evaluate(example()).dps);
});


test('totals-only input needs no damage or health percentage and preserves both totals', () => {
  const input = { ...example(), totalDamage: 1e6, totalHealth: 1e7 };
  delete input.damage;
  delete input.health;
  const build = fromTotals(input);
  assert.equal(build.totalsOnly, true);
  near(evaluate(build).totalDamage, 1e6);
  near(evaluate(build).totalHealth, 1e7);
  near(evaluate({ ...build, damage: 15 }).totalDamage, 1.15e6);
  near(evaluate({ ...build, health: 15 }).totalHealth, 1.15e7);
});

