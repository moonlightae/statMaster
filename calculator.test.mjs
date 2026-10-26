import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATS, validate, evaluate, evaluateChange, derivatives, optimize, buildSlots, attackInterval, fromTotals, upgrades, battle, tournament } from './public/calculator.mjs';

function example(extra = {}) {
  return { ...Object.fromEntries(STATS.map(({ key }) => [key, 0])), style: 'ranged', baseDamage: 1000, baseHealth: 10000,
    critChance: 50, critDamage: 80, doubleChance: 20, damage: 15, ranged: 15, attackSpeed: 100,
    regen: 4, lifesteal: 20, health: 15, ...extra };
}
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1e-7, Math.abs(expected) * 1e-6), actual + ' != ' + expected);

test('fairy selection never adds bonuses to already displayed stats', () => {
  const plain = example();
  for (const fairy of ['none', 'mira', 'tira', 'lora']) {
    const build = { ...plain, fairy, fairyLevel: 20 };
    validate(build);
    near(evaluate(build).dps, evaluate(plain).dps);
    near(evaluate(build).hps, evaluate(plain).hps);
    assert.deepEqual(evaluateChange(build, 'skillDamage', build.skillDamage), evaluate(build));
  }
  for (const extra of [{ fairy: 'bad' }, ...[0, 21, 1.5, NaN].map(fairyLevel => ({ fairy: 'mira', fairyLevel }))]) {
    assert.throws(() => validate(example(extra)));
  }
});

test('Mira skill damage derivative scales linearly and respects fairy and critical caps', () => {
  const b = example({ fairy: 'mira', fairyLevel: 10, skillDamage: 15 });
  const slope = derivatives(b).dps.skillDamage;
  assert.ok(slope > 0);
  near(slope, derivatives(b).dps.critChance * 10 / 15);
  near(derivatives({ ...b, fairyLevel: 20 }).dps.skillDamage, slope * 2);
  for (const build of [b, { ...b, fairyLevel: 20 }, { ...b, skillDamage: 120 }, { ...b, critChance: 100 }]) {
    const step = .0001;
    near((evaluateChange(build, 'skillDamage', build.skillDamage + step).dps - evaluate(build).dps) / step,
      derivatives(build).dps.skillDamage);
  }
  assert.equal(derivatives({ ...b, skillDamage: 120 }).dps.skillDamage, 0);
  assert.equal(derivatives({ ...b, critChance: 100 }).dps.skillDamage, 0);
  near(evaluateChange({ ...b, skillDamage: 119, critChance: 99 }, 'skillDamage', 122).dps,
    evaluate({ ...b, critChance: 99 + 2 / 3 }).dps);
  for (const fairy of ['tira', 'lora', 'none']) {
    assert.equal(derivatives({ ...b, fairy }).dps.skillDamage, undefined);
  }
});

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

test('PvP battle uses damage minus healing and both fighters health', () => {
  const fighter = (totalHealth, dps, hps = 0) => ({ totalHealth, dps, hps });
  assert.deepEqual(battle(fighter(100, 20), fighter(100, 10)), { winner: 'left', seconds: 5, reason: 'defeat' });
  assert.equal(battle(fighter(200, 10), fighter(100, 10)).winner, 'left');
  assert.deepEqual(battle(fighter(100, 20), fighter(100, 20)), { winner: 'draw', seconds: 5, reason: 'simultaneous' });
  assert.deepEqual(battle(fighter(100, 20, 30), fighter(100, 20, 30)), { winner: 'draw', seconds: null, reason: 'stalemate' });
  assert.equal(battle(fighter(100, 10, 100), fighter(100, 20)).winner, 'left');
  assert.equal(battle(fighter(100, 10), fighter(100, 20)).winner, 'right');
  assert.throws(() => battle(fighter(0, 10), fighter(100, 20)));
  assert.throws(() => battle(fighter(100, Infinity), fighter(100, 20)));
});

test('block cancels incoming damage while reflect returns received damage without negating it', () => {
  const fighter = { totalHealth: 100, dps: 20, hps: 0, block: 0, reflect: 0 };
  assert.deepEqual(battle({ ...fighter, block: 100 }, fighter), { winner: 'left', seconds: 5, reason: 'defeat' });
  assert.deepEqual(battle({ ...fighter, reflect: 50 }, fighter), { winner: 'left', seconds: 100 / 30, reason: 'defeat' });
  assert.deepEqual(battle({ ...fighter, block: 50, reflect: 50 }, fighter), { winner: 'left', seconds: 4, reason: 'defeat' });
  assert.deepEqual(battle({ ...fighter, reflect: 100 }, { ...fighter, reflect: 100 }),
    { winner: 'draw', seconds: 2.5, reason: 'simultaneous' });
  assert.deepEqual(battle({ ...fighter, block: 100, reflect: 100 }, { ...fighter, block: 100, reflect: 100 }),
    { winner: 'draw', seconds: null, reason: 'stalemate' });
  const thief = { ...fighter, hps: 20, regenHps: 0, lifestealHps: 20 };
  assert.equal(battle(thief, { ...fighter, block: 100 }).winner, 'right');
  assert.throws(() => battle({ ...fighter, reflect: NaN }, fighter));
});

test('fairy changes preserve displayed stats and apply Tira and Lora bonus deltas once', () => {
  const tira = example({ fairy: 'tira', fairyLevel: 10, skillCooldown: -4, block: 15 });
  assert.equal(evaluate(tira).block, 15);
  assert.equal(evaluateChange(tira, 'skillCooldown', -5).block, 17.5);
  assert.equal(evaluateChange({ ...tira, fairyLevel: 20 }, 'skillCooldown', -5).block, 20);
  assert.equal(evaluateChange({ ...tira, skillCooldown: -12, block: 35 }, 'skillCooldown', -13).block, 35);
  const lora = example({ fairy: 'lora', fairyLevel: 10, health: 10, reflect: 10 });
  assert.equal(evaluate(lora).reflect, 7.5);
  assert.equal(evaluateChange(lora, 'health', 20).reflect, 15);
  near(evaluateChange(lora, 'health', 20).totalHealth, lora.baseHealth * 1.2);
  assert.equal(evaluateChange({ ...lora, fairyLevel: 20 }, 'health', 20).reflect, 30);
  const ranked = upgrades(lora).pvp;
  assert.ok(ranked.increase.some(row => row.key === 'block'));
  assert.ok(!ranked.increase.some(row => row.key === 'reflect'));
  assert.ok(!ranked.decrease.some(row => row.key === 'reflect'));
  assert.ok(ranked.decrease.some(row => row.key === 'health'));
  assert.ok(upgrades(tira).pvp.increase.some(row => row.key === 'skillCooldown' && row.direction === -1));
});

test('reflect comes only from Lora health and level, ignoring saved manual reflect values', () => {
  for (const fairy of ['none', 'mira', 'tira', 'lora']) {
    const build = fromTotals({ ...example(), totalDamage: 1000, totalHealth: 10000,
      fairy, fairyLevel: 10, health: 10, reflect: 99 });
    assert.equal(build.reflect, undefined);
    assert.equal(evaluate(build).reflect, fairy === 'lora' ? 7.5 : 0);
    const rankings = upgrades(build).pvp;
    assert.ok([...rankings.increase, ...rankings.decrease].every(row => row.key !== 'reflect'));
  }
  assert.equal(evaluate(example({ fairy: 'lora', fairyLevel: 20, health: 10 })).reflect, 15);
  assert.equal(evaluate(example({ fairy: 'lora', fairyLevel: 20, health: 100 })).reflect, 30);
});

test('defensive fairy builds enter the PvP field with legal slots and capped bonuses', () => {
  for (const fairy of ['tira', 'lora', 'mira']) {
    const result = optimize(example({ fairy, fairyLevel: 20 }));
    assert.equal(result.topFive.length, 5);
    for (const entry of result.topFive) {
      assert.equal(Object.values(entry.counts).reduce((a, n) => a + n, 0), 24);
      assert.ok(entry.slots.every(slot => slot.keys[0] !== slot.keys[1]));
      const stats = entry.stats;
      near(stats.block, (entry.counts.block || 0) * 5 + (fairy === 'tira' ? Math.min(30, Math.abs(stats.skillCooldown) * 5) : 0));
      near(stats.reflect, fairy === 'lora' ? Math.min(30, stats.health * 1.5) : 0);
      near(stats.critChance, (entry.counts.critChance || 0) * 12 + (fairy === 'mira' ? Math.min(80, stats.skillDamage * 20 / 15) : 0));
    }
  }
});

test('round robin scores every pair exactly once and reports shared champions honestly', () => {
  const fighters = [100, 20, 10].map(dps => ({ totalHealth: 100, dps, hps: 0 }));
  const league = tournament(fighters);
  assert.equal(league.matches, 3);
  assert.equal(league.winnerIndex, 0);
  assert.deepEqual(league.ranking.map(entry => entry.index), [0, 1, 2]);
  assert.deepEqual(league.ranking.map(entry => entry.rank), [1, 2, 3]);
  assert.equal(league.coWinners, 1);
  assert.deepEqual(league.records[0], { wins: 2, draws: 0, losses: 0, points: 2 });
  assert.equal(league.records.reduce((n, r) => n + r.points, 0), league.matches);
  for (const record of league.records) assert.equal(record.wins + record.draws + record.losses, 2);
  const draws = tournament([fighters[0], fighters[0], fighters[0]]);
  assert.equal(draws.coWinners, 3);
  assert.deepEqual(draws.ranking.map(entry => entry.rank), [1, 1, 1]);
  assert.ok(draws.records.every(record => record.draws === 2 && record.points === 1));
  assert.throws(() => tournament([]));
});

test('PvP winner has legal 24 slots and consistent league and current-build comparisons', () => {
  for (const style of ['ranged', 'melee']) {
    const b = example({ style });
    const result = optimize(b);
    assert.equal(Object.values(result.counts).reduce((a, n) => a + n, 0), 24);
    assert.ok(Object.values(result.counts).every(n => n <= 12 && n >= 0));
    assert.equal(result.slots.length, 12);
    assert.equal(result.slots.filter(slot => slot.name.startsWith('장비')).length, 9);
    assert.equal(result.slots.filter(slot => slot.name.startsWith('펫')).length, 3);
    assert.ok(result.slots.every(slot => slot.keys[0] !== slot.keys[1]));
    near(result.dps, evaluate(result.stats).dps);
    near(result.hps, evaluate(result.stats).hps);
    assert.equal(result.stats.critDamage, 20 + result.counts.critDamage * 80);
    assert.equal(result.pvp.candidates, 128);
    assert.equal(result.pvp.matches, 8128);
    for (const record of [result.pvp.record, result.pvp.currentRecord]) {
      assert.equal(record.wins + record.draws + record.losses, 127);
      assert.equal(record.points, record.wins + record.draws * .5);
    }
    assert.deepEqual(result.pvp.versusCurrent, battle(result, evaluate(b)));
    assert.equal(result.topFive.length, 5);
    assert.deepEqual(result.topFive[0].counts, result.counts);
    assert.equal(new Set(result.topFive.map(entry => JSON.stringify(entry.counts))).size, 5);
    for (const [i, entry] of result.topFive.entries()) {
      assert.ok(i === 0 || result.topFive[i - 1].pvp.record.points >= entry.pvp.record.points);
      assert.ok(i === 0 || result.topFive[i - 1].pvp.rank <= entry.pvp.rank);
      assert.equal(Object.values(entry.counts).reduce((a, n) => a + n, 0), 24);
      assert.deepEqual(entry.slots, buildSlots(entry.counts));
      assert.equal(entry.pvp.record.wins + entry.pvp.record.draws + entry.pvp.record.losses, 127);
      assert.equal(entry.pvp.currentRecord.wins + entry.pvp.currentRecord.draws + entry.pvp.currentRecord.losses, 127);
      assert.deepEqual(entry.pvp.versusCurrent, battle(entry, evaluate(b)));
      near(entry.dps, evaluate(entry.stats).dps);
      near(entry.hps, evaluate(entry.stats).hps);
    }
    assert.deepEqual(result.counts, optimize(b).counts);
  }
});

test('PvP accepts zero initial healing and never divides by initial HPS', () => {
  const b = example({ regen: 0, lifesteal: 0 });
  const result = optimize(b);
  assert.ok(result.dps > 0 && result.hps >= 0);
  assert.ok(Number.isFinite(result.pvp.currentRecord.points));
  const ranked = upgrades(b);
  assert.ok(ranked.hps.increase.every(row => Number.isFinite(row.slope)));
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



test('stat priorities use current per-point slopes without max-roll weights or opponents', () => {
  const b = example({ fairy: 'mira', fairyLevel: 20, skillDamage: 15 });
  const before = { ...b };
  const ranked = upgrades(b);
  const slopes = derivatives(b);
  for (const metric of ['dps', 'hps']) {
    const { increase, decrease } = ranked[metric];
    assert.ok(increase.length > 0 && decrease.length > 0);
    assert.deepEqual(increase.map(row => row.key), Object.keys(slopes[metric]).filter(key => slopes[metric][key] > 0).sort((a, z) => slopes[metric][z] - slopes[metric][a]));
    assert.ok(decrease.every((row, i) => i === 0 || decrease[i - 1].lossSlope <= row.lossSlope));
    for (const row of decrease) near(row.lossSlope, slopes[metric][row.key]);
  }
  assert.ok(ranked.dps.increase.some(row => row.key === 'attackSpeed'));
  assert.ok(ranked.dps.increase.some(row => row.key === 'skillDamage'));
  near(slopes.hps.attackSpeed, slopes.dps.attackSpeed * b.lifesteal / 100);
  assert.deepEqual(b, before);
});

test('decrease priorities preserve free stats and distinguish both sides of probability caps', () => {
  for (const critChance of [100, 120]) {
    const ranked = upgrades(example({ critChance, critDamage: 20, totalsOnly: true }));
    assert.ok(!ranked.dps.increase.some(row => row.key === 'critChance'));
    const crit = ranked.dps.decrease.find(row => row.key === 'critChance');
    assert.ok(critChance === 100 ? crit.lossSlope > 0 : crit.lossSlope === 0);
    for (const metric of ['dps', 'hps']) {
      assert.ok(ranked[metric].decrease.every(row => !['damage', 'health', 'critDamage', 'block'].includes(row.key)));
    }
  }
  const b = example({ fairy: 'mira', fairyLevel: 20, skillDamage: 60 });
  const ranked = upgrades(b);
  assert.ok(!ranked.dps.increase.some(row => row.key === 'skillDamage'));
  assert.ok(ranked.dps.decrease.find(row => row.key === 'skillDamage').lossSlope > 0);
});
