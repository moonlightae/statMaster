export const STATS = [
  { key: 'critChance', label: '치명타 확률', max: 12 },
  { key: 'critDamage', label: '치명타 피해', max: 80 },
  { key: 'block', label: '블록 확률', max: 5 },
  { key: 'regen', label: '체력 재생', max: 4 },
  { key: 'lifesteal', label: '생명력 흡수', max: 20 },
  { key: 'doubleChance', label: '더블 찬스', max: 20 },
  { key: 'damage', label: '피해', max: 15 },
  { key: 'melee', label: '근접 피해', max: 50 },
  { key: 'ranged', label: '원거리 피해', max: 15 },
  { key: 'attackSpeed', label: '공격 속도', max: 40 },
  { key: 'skillDamage', label: '스킬 피해', max: 30 },
  { key: 'skillCooldown', label: '스킬 재사용 대기시간', max: 7 },
  { key: 'health', label: '체력', max: 15 },
];
// shortcut: use the FM DPS 0% speed example for comparisons; replace when weapon-specific timing is measured.
export const BASE_ATTACK_INTERVAL = 1.7;
export const UNIT = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const cap = value => Math.min(100, Math.max(0, value));

export function validate(build) {
  if (!build || !['ranged', 'melee'].includes(build.style)) throw Error('공격 유형을 선택해 주세요.');
  for (const key of ['baseDamage', 'baseHealth']) {
    if (!Number.isFinite(build[key]) || build[key] <= 0) throw Error('총 피해·총 체력은 0보다 커야 합니다.');
  }
  if (build.critDamage < 20) throw Error('치명타 피해에는 기본 20%를 포함한 표시 수치를 입력해 주세요.');
  for (const { key, label } of STATS) {
    if (!Number.isFinite(build[key]) || (key !== 'skillCooldown' && build[key] < 0)) {
      throw Error(label + '에 올바른 수치를 입력해 주세요.');
    }
  }
}

export function attackInterval(speed) {
  return BASE_ATTACK_INTERVAL / ((speed + 100) / 100);
}

export function fromTotals(input) {
  for (const key of ['totalDamage', 'totalHealth']) {
    if (!Number.isFinite(input[key]) || input[key] <= 0) throw Error('총 피해와 총 체력은 0보다 커야 합니다.');
  }
  // Missing bonuses are relative changes around the entered totals, not recovered equipment bonuses.
  const build = { ...input, damage: input.damage ?? 0, health: input.health ?? 0,
    totalsOnly: input.damage === undefined || input.health === undefined };
  build.baseDamage = input.totalDamage / (1 + build.damage / 100) / (1 + input[input.style] / 100);
  build.baseHealth = input.totalHealth / (1 + build.health / 100);
  delete build.totalDamage;
  delete build.totalHealth;
  validate(build);
  return build;
}
export function evaluate(build) {
  const totalDamage = build.baseDamage * (1 + build.damage / 100) * (1 + build[build.style] / 100);
  const totalHealth = build.baseHealth * (1 + build.health / 100);
  const interval = attackInterval(build.attackSpeed);
  const critFactor = 1 + cap(build.critChance) / 100 * (build.critDamage / 100);
  const dps = totalDamage / interval * (1 + cap(build.doubleChance) / 100) * critFactor;
  const regenHps = totalHealth * build.regen / 100;
  const lifestealHps = dps * build.lifesteal / 100;
  const hps = regenHps + lifestealHps;
  if (![dps, hps, totalDamage, totalHealth].every(Number.isFinite)) throw Error('계산 가능한 범위를 초과했습니다. 입력 수치를 확인해 주세요.');
  return { totalDamage, totalHealth, interval, dps, hps, regenHps, lifestealHps };
}

// Derivatives are per percentage point, holding all other inputs fixed; probability caps use the right derivative.
export function derivatives(build) {
  const result = evaluate(build);
  const critFactor = 1 + cap(build.critChance) / 100 * (build.critDamage / 100);
  return {
    dps: {
      critChance: build.critChance >= 100 ? 0 : result.dps / critFactor * (build.critDamage / 100) / 100,
      critDamage: result.dps / critFactor * cap(build.critChance) / 10000,
      doubleChance: build.doubleChance >= 100 ? 0 : result.dps / (1 + cap(build.doubleChance) / 100) / 100,
      damage: result.dps / (100 + build.damage),
      [build.style]: result.dps / (100 + build[build.style]),
    },
    hps: {
      regen: result.totalHealth / 100,
      lifesteal: result.dps / 100,
      health: build.baseHealth * build.regen / 10000,
    },
  };
}

export function upgrades(build) {
  const keys = ['critChance', 'critDamage', 'doubleChance', 'damage', build.style, 'attackSpeed', 'regen', 'lifesteal', 'health'];
  const current = evaluate(build);
  return keys.map(key => {
    const spec = STATS.find(stat => stat.key === key);
    const next = evaluate({ ...build, [key]: build[key] + spec.max });
    const score = Math.log(next.dps) + Math.log(next.hps);
    const gain = current.hps > 0 ? Math.expm1((Math.log(next.dps / current.dps) + Math.log(next.hps / current.hps)) / 2) : null;
    return { ...spec, score, gain, dpsGain: next.dps - current.dps, hpsGain: next.hps - current.hps };
  }).sort((a, b) => b.score - a.score);
}
export function buildSlots(counts) {
  if (Object.values(counts).some(n => !Number.isInteger(n) || n < 0 || n > 12) ||
      Object.values(counts).reduce((a, b) => a + b, 0) !== 24) throw Error('옵션 분배 제한을 벗어났습니다.');
  const remaining = { ...counts };
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const keys = Object.keys(remaining).filter(key => remaining[key] > 0).sort((a, b) => remaining[b] - remaining[a]);
    if (keys.length < 2) throw Error('동일 개체에 중복 옵션을 배치할 수 없습니다.');
    const pair = keys.slice(0, 2);
    pair.forEach(key => remaining[key]--);
    slots.push({ name: i < 9 ? '장비 ' + (i + 1) : '펫 ' + (i - 8), keys: pair });
  }
  return slots;
}

export function optimize(build) {
  validate(build);
  const keys = ['critChance', 'critDamage', 'doubleChance', 'damage', build.style, 'attackSpeed'];
  const rolls = keys.map(key => STATS.find(stat => stat.key === key).max);
  const best = Array(25).fill(null);
  const counts = Array(6).fill(0);
  const candidate = { ...build };
  STATS.forEach(({ key }) => candidate[key] = key === "critDamage" ? 20 : 0);
  // For each offensive budget, its highest DPS dominates every lower-DPS vector for both objectives.
  function search(index, used) {
    if (index === keys.length) {
      const damage = build.baseDamage * (1 + candidate.damage / 100) * (1 + candidate[build.style] / 100);
      const dps = damage / attackInterval(candidate.attackSpeed) *
        (1 + cap(candidate.doubleChance) / 100) *
        (1 + cap(candidate.critChance) / 100 * (candidate.critDamage / 100));
      if (!best[used] || dps > best[used].dps) best[used] = { dps, counts: counts.slice() };
      return;
    }
    for (let n = 0; n <= Math.min(12, 24 - used); n++) {
      counts[index] = n;
      candidate[keys[index]] = n * rolls[index] + (keys[index] === "critDamage" ? 20 : 0);
      search(index + 1, used + n);
    }
  }
  search(0, 0);
  let balanced = null;
  for (let offense = 0; offense <= 24; offense++) {
    for (let life = 0; life <= 12; life++) {
      for (let regen = 0; regen <= 12; regen++) {
        const health = 24 - offense - life - regen;
        if (health < 0 || health > 12) continue;
        const hps = best[offense].dps * life * .2 + build.baseHealth * (1 + health * .15) * regen * .04;
        // Maximizing log(DPS) + log(HPS) gives equal weight to relative gains without multiplying large numbers.
        const score = Math.log(best[offense].dps) + Math.log(hps);
        if (!balanced || score > balanced.score) balanced = { score, offense, life, regen, health };
      }
    }
  }
  function solution(record, defense = {}) {
    const distribution = Object.fromEntries(keys.map((key, i) => [key, record.counts[i]]));
    Object.assign(distribution, defense);
    const stats = { ...build };
    STATS.forEach(({ key, max }) => stats[key] = (distribution[key] || 0) * max + (key === "critDamage" ? 20 : 0));
    return { ...evaluate(stats), counts: distribution, slots: buildSlots(distribution), stats };
  }
  return solution(best[balanced.offense], { lifesteal: balanced.life, regen: balanced.regen, health: balanced.health });
}

export function formatAmount(value) {
  for (const [suffix, divisor] of [['t', 1e12], ['b', 1e9], ['m', 1e6], ['k', 1e3]]) {
    if (Math.abs(value) >= divisor) return (value / divisor).toPrecision(3) + suffix;
  }
  return value.toLocaleString('ko-KR', { maximumSignificantDigits: 3 });
}





