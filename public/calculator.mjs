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
  if (!['none', 'mira', 'tira', 'lora'].includes(build.fairy ?? 'none') ||
      (build.fairy && build.fairy !== 'none' && (!Number.isInteger(build.fairyLevel) || build.fairyLevel < 1 || build.fairyLevel > 20))) {
    throw Error('요정과 1~20 사이의 정수 레벨을 선택해 주세요.');
  }
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
  delete build.reflect;
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
  return { totalDamage, totalHealth, interval, dps, hps, regenHps, lifestealHps,
    block: cap(build.block), reflect: loraBonus(build, build.health) };
}

const miraBonus = (build, skillDamage) => build.fairy === 'mira'
  ? Math.min(80, Math.max(0, skillDamage) * build.fairyLevel / 15) : 0;
const tiraBonus = (build, cooldown) => build.fairy === 'tira'
  ? Math.min(30, Math.abs(cooldown) * build.fairyLevel / 4) : 0;
const loraBonus = (build, health) => build.fairy === 'lora'
  ? Math.min(30, Math.max(0, health) * build.fairyLevel * .075) : 0;

// Displayed stats already include the fairy; only changes in her bonus are added.
export function evaluateChange(build, key, value) {
  const next = { ...build, [key]: value };
  if (key === 'skillDamage') next.critChance += miraBonus(build, value) - miraBonus(build, build.skillDamage);
  if (key === 'skillCooldown') next.block += tiraBonus(build, value) - tiraBonus(build, build.skillCooldown);
  return evaluate(next);
}

function combatRates(left, right) {
  const leftHit = right.dps * (1 - (left.block ?? 0) / 100);
  const rightHit = left.dps * (1 - (right.block ?? 0) / 100);
  const healing = (fighter, enemy) => fighter.regenHps === undefined ? fighter.hps
    : fighter.regenHps + fighter.lifestealHps * (1 - (enemy.block ?? 0) / 100);
  // Reflect only received direct damage; reflected hits do not trigger another reflect or lifesteal.
  return [leftHit + rightHit * (right.reflect ?? 0) / 100 - healing(left, right),
    rightHit + leftHit * (left.reflect ?? 0) / 100 - healing(right, left)];
}

// Derivatives are per percentage point; caps use the right derivative.
export function derivatives(build) {
  const result = evaluate(build);
  const critFactor = 1 + cap(build.critChance) / 100 * (build.critDamage / 100);
  const critSlope = build.critChance >= 100 ? 0 : result.dps / critFactor * (build.critDamage / 100) / 100;
  const dps = {
      critChance: critSlope,
      critDamage: result.dps / critFactor * cap(build.critChance) / 10000,
      doubleChance: build.doubleChance >= 100 ? 0 : result.dps / (1 + cap(build.doubleChance) / 100) / 100,
      attackSpeed: result.dps / (100 + build.attackSpeed),
      damage: result.dps / (100 + build.damage),
      [build.style]: result.dps / (100 + build[build.style]),
      ...(build.fairy === 'mira' ? { skillDamage: miraBonus(build, build.skillDamage) >= 80 ? 0 : critSlope * build.fairyLevel / 15 } : {}),
  };
  return {
    dps,
    hps: {
      ...Object.fromEntries(Object.entries(dps).map(([key, slope]) => [key, slope * build.lifesteal / 100])),
      regen: result.totalHealth / 100,
      lifesteal: result.dps / 100,
      health: build.baseHealth * build.regen / 10000,
    },
  };
}

export function battle(left, right) {
  for (const fighter of [left, right]) {
    if (!Number.isFinite(fighter.totalHealth) || fighter.totalHealth <= 0 ||
        !Number.isFinite(fighter.dps) || fighter.dps < 0 ||
        !Number.isFinite(fighter.hps) || fighter.hps < 0) throw Error('올바른 대결 수치가 아닙니다.');
    for (const key of ['block', 'reflect']) {
      if (!Number.isFinite(fighter[key] ?? 0) || (fighter[key] ?? 0) < 0 || (fighter[key] ?? 0) > 100) throw Error('올바른 대결 확률이 아닙니다.');
    }
  }
  const [leftRate, rightRate] = combatRates(left, right);
  const leftLoss = Math.max(0, leftRate);
  const rightLoss = Math.max(0, rightRate);
  const leftDeath = leftLoss > 0 ? left.totalHealth / leftLoss : Infinity;
  const rightDeath = rightLoss > 0 ? right.totalHealth / rightLoss : Infinity;
  if (!Number.isFinite(leftDeath) && !Number.isFinite(rightDeath)) {
    return { winner: 'draw', seconds: null, reason: 'stalemate' };
  }
  const simultaneous = Number.isFinite(leftDeath) && Number.isFinite(rightDeath) &&
    Math.abs(leftDeath - rightDeath) <= 1e-9 * Math.max(1, leftDeath, rightDeath);
  return {
    winner: simultaneous ? 'draw' : rightDeath < leftDeath ? 'left' : 'right',
    seconds: Math.min(leftDeath, rightDeath),
    reason: simultaneous ? 'simultaneous' : 'defeat',
  };
}

function recordAgainst(fighter, opponents) {
  let wins = 0, draws = 0, losses = 0;
  for (const opponent of opponents) {
    const result = battle(fighter, opponent);
    if (result.winner === 'left') wins++;
    else if (result.winner === 'right') losses++;
    else draws++;
  }
  return { wins, draws, losses, points: wins + draws * .5 };
}

export function tournament(candidates) {
  if (!candidates.length) throw Error('대결 후보가 없습니다.');
  const records = candidates.map(() => ({ wins: 0, draws: 0, losses: 0, points: 0 }));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const result = battle(candidates[i], candidates[j]);
      if (result.winner === 'draw') {
        records[i].draws++; records[j].draws++;
        records[i].points += .5; records[j].points += .5;
      } else {
        const winner = result.winner === 'left' ? i : j;
        const loser = winner === i ? j : i;
        records[winner].wins++; records[winner].points++;
        records[loser].losses++;
      }
    }
  }
  const ranking = records.map((record, index) => {
    const tied = candidates.filter((_, i) => i !== index && records[i].points === record.points);
    return { index, points: record.points, headToHead: recordAgainst(candidates[index], tied).points };
  }).sort((a, b) => b.points - a.points || b.headToHead - a.headToHead || a.index - b.index);
  ranking.forEach((entry, i) => {
    const previous = ranking[i - 1];
    entry.rank = previous && entry.points === previous.points && entry.headToHead === previous.headToHead ? previous.rank : i + 1;
  });
  const coWinners = ranking.filter(entry => entry.rank === 1).length;
  return {
    winnerIndex: ranking[0].index, coWinners, records, ranking,
    matches: candidates.length * (candidates.length - 1) / 2,
  };
}

export function upgrades(build) {
  const slopes = derivatives(build);
  const current = evaluate(build);
  const rankings = Object.fromEntries(['dps', 'hps'].map(metric => {
    const rows = Object.entries(slopes[metric]).map(([key, slope]) => {
      const available = key === 'critDamage' ? build[key] - 20 : build[key];
      const removable = available > 0 && !(build.totalsOnly && ['damage', 'health'].includes(key));
      const step = Math.min(.0001, available);
      // At a cap, decreasing can lose DPS even when increasing gains nothing.
      const lossSlope = removable ? Math.max(0, (current[metric] - evaluateChange(build, key, build[key] - step)[metric]) / step) : null;
      return { key, slope, lossSlope };
    });
    return [metric, {
      increase: rows.filter(row => row.slope > 0).sort((a, b) => b.slope - a.slope),
      decrease: rows.filter(row => row.lossSlope !== null).sort((a, b) => a.lossSlope - b.lossSlope),
    }];
  }));
  const advantage = fighter => {
    const [own, enemy] = combatRates(fighter, current);
    return enemy / current.totalHealth - own / fighter.totalHealth;
  };
  const before = advantage(current);
  const keys = [...new Set([...Object.keys(slopes.dps), ...Object.keys(slopes.hps), 'block',
    ...(build.fairy === 'tira' ? ['skillCooldown'] : [])])];
  const rows = keys.map(key => {
    const value = build[key] ?? 0;
    const direction = key === 'skillCooldown' && value <= 0 ? -1 : 1;
    const step = .0001;
    const slope = (advantage(evaluateChange(build, key, value + step * direction)) - before) / step;
    const available = key === 'critDamage' ? value - 20 : Math.abs(value);
    const down = Math.min(step, available);
    const lossSlope = available > 0 ? (before - advantage(evaluateChange(build, key, value - down * direction))) / down : null;
    return { key, slope, lossSlope, direction };
  });
  rankings.pvp = {
    increase: rows.filter(row => row.slope > 1e-12).sort((a, b) => b.slope - a.slope),
    decrease: rows.filter(row => row.lossSlope !== null).sort((a, b) => a.lossSlope - b.lossSlope),
  };
  return rankings;
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
  const keys = ['critChance', 'critDamage', 'doubleChance', 'damage', build.style, 'attackSpeed',
    ...(build.fairy === 'mira' ? ['skillDamage'] : [])];
  const rolls = keys.map(key => STATS.find(stat => stat.key === key).max);
  const best = Array(25).fill(null);
  const counts = Array(keys.length).fill(0);
  const candidate = { ...build };
  STATS.forEach(({ key }) => candidate[key] = key === "critDamage" ? 20 : 0);
  // Keep the highest direct-DPS allocation per offense budget as one source of sampled candidates.
  function search(index, used) {
    if (index === keys.length) {
      const damage = build.baseDamage * (1 + candidate.damage / 100) * (1 + candidate[build.style] / 100);
      const dps = damage / attackInterval(candidate.attackSpeed) *
        (1 + cap(candidate.doubleChance) / 100) *
        (1 + cap(candidate.critChance + miraBonus(build, candidate.skillDamage)) / 100 * (candidate.critDamage / 100));
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
  function makeCandidate(distribution) {
    const stats = { ...build };
    STATS.forEach(({ key, max }) => stats[key] = (distribution[key] || 0) * max + (key === 'critDamage' ? 20 : 0));
    stats.critChance += miraBonus(build, stats.skillDamage);
    stats.block += tiraBonus(build, stats.skillCooldown);
    stats.reflect = loraBonus(build, stats.health);
    return { ...evaluate(stats), counts: distribution, stats };
  }
  const pool = [];
  for (let offense = 0; offense <= 24; offense++) {
    for (let life = 0; life <= 12; life++) {
      for (let regen = 0; regen <= 12; regen++) {
        const health = 24 - offense - life - regen;
        if (health < 0 || health > 12) continue;
        const distribution = Object.fromEntries(keys.map((key, i) => [key, best[offense].counts[i]]));
        Object.assign(distribution, { lifesteal: life, regen, health });
        pool.push(makeCandidate(distribution));
      }
    }
  }
  // shortcut: sample 64 offense/healing builds and 64 defensive builds; expand when coverage is insufficient.
  const field = Array.from({ length: 64 }, (_, i) => pool[Math.round(i * (pool.length - 1) / 63)]);
  const defensiveKeys = [...keys, 'lifesteal', 'regen', 'health', 'block',
    ...(build.fairy === 'tira' ? ['skillCooldown'] : [])];
  let seed = 42;
  const random = length => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % length; };
  while (field.length < 128) {
    const distribution = Object.fromEntries(defensiveKeys.map(key => [key, 0]));
    for (let slot = 0; slot < 12; slot++) {
      const first = defensiveKeys[random(defensiveKeys.length)];
      const others = defensiveKeys.filter(key => key !== first);
      distribution[first]++;
      distribution[others[random(others.length)]]++;
    }
    const candidate = makeCandidate(distribution);
    if (!field.some(entry => defensiveKeys.every(key => (entry.counts[key] || 0) === distribution[key]))) field.push(candidate);
  }
  const league = tournament(field);
  const current = evaluate(build);
  const topFive = league.ranking.slice(0, 5).map(({ index, rank }) => {
    const solution = field[index];
    const opponents = field.filter((_, i) => i !== index);
    return {
      ...solution, slots: buildSlots(solution.counts),
      pvp: {
        candidates: field.length, pool: pool.length, matches: league.matches,
        coWinners: league.coWinners, rank,
        tied: league.ranking.some(entry => entry.index !== index && entry.rank === rank),
        record: league.records[index], currentRecord: recordAgainst(current, opponents),
        versusCurrent: battle(solution, current),
      },
    };
  });
  return { ...topFive[0], topFive };
}
export function formatAmount(value) {
  for (const [suffix, divisor] of [['t', 1e12], ['b', 1e9], ['m', 1e6], ['k', 1e3]]) {
    if (Math.abs(value) >= divisor) return (value / divisor).toPrecision(3) + suffix;
  }
  return value.toLocaleString('ko-KR', { maximumSignificantDigits: 3 });
}







