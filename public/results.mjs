import { STATS, validate, evaluate, evaluateChange, derivatives, upgrades, formatAmount } from './calculator.mjs';

const format = formatAmount;
const label = key => STATS.find(stat => stat.key === key).label;
const spec = key => STATS.find(stat => stat.key === key);
let build;
try {
  build = JSON.parse(sessionStorage.getItem('stat-master-build') || 'null');
  validate(build);
  const values = evaluate(build);
  if (build.totalsOnly) {
    document.querySelector('#optimizer-status').closest('section').querySelector('h2').textContent = 'PvP 모의전 상위 5개 분배';
    document.querySelector('#optimizer-status').previousElementSibling.textContent = '장비 9개·펫 3마리, 개체당 다른 옵션 2개로 제한한 비교 모델입니다. 현재 피해·체력 보너스는 총합에서 분리할 수 없어 유지한 채 새 옵션을 비교하므로, 현재 총합 기준의 가상 PvP 비교 모델이며 실제 전체 재분배의 최적해는 아닙니다.';
  }
  document.querySelector('#result-content').hidden = false;
  document.querySelector('#dps').textContent = format(values.dps);
  document.querySelector('#hps').textContent = format(values.hps);
  document.querySelector('#totals-summary').textContent = '기준 피해 ' + format(build.baseDamage) + ' · 기준 체력 ' + format(build.baseHealth) + ' · 총 피해 ' + format(values.totalDamage) + ' · 총 체력 ' + format(values.totalHealth) + ' · 재생 ' + format(values.regenHps) + '/초 · 흡수 ' + format(values.lifestealHps) + '/초 · 블록 ' + values.block + '% · 반사 ' + values.reflect + '%';
  showRecommendations(upgrades(build));
  showCharts();
  showNotes();
  optimizeInWorker();
} catch (error) {
  document.querySelector('#result-content').hidden = true;
  document.querySelector('#result-error').textContent = '입력값을 확인해 주세요. ' + error.message;
}

function showRecommendations(rankings) {
  const name = key => build.totalsOnly && ['damage', 'health'].includes(key) ? '총 ' + label(key) + ' 상대 변화' : label(key);
  const list = (rows, decreasing) => rows.slice(0, 3).map(row => '<li>' + name(row.key) + (row.direction === -1 ? ' 감소' : '') +
    '<small>' + (decreasing ? '감소 손실 ' + format(row.lossSlope) : '증가 기울기 ' + format(row.slope)) + '/초</small></li>').join('') || '<li>해당 스탯이 없습니다.</li>';
  document.querySelector('#recommendations').innerHTML = ['dps', 'hps', 'pvp'].map(metric =>
    '<h3>' + (metric === 'pvp' ? 'PvP 기준 · 현재 분배 상대 순피해율 우위' : metric.toUpperCase() + ' 기준') + '</h3><table><thead><tr><th scope="col">집중해서 올릴 스탯</th>' +
    '<th scope="col">줄여도 손실이 적은 스탯</th></tr></thead><tbody><tr><td><ol>' +
    list(rankings[metric].increase, false) + '</ol></td><td><ol>' + list(rankings[metric].decrease, true) +
    '</ol></td></tr></tbody></table>').join('');
}
function showCharts() {
  const slopes = derivatives(build);
  for (const metric of ['dps', 'hps']) {
    for (const [key, slope] of Object.entries(slopes[metric])) {
      const relative = build.totalsOnly && ['damage', 'health'].includes(key);
      const chartLabel = relative ? '총 ' + label(key) + ' 상대 변화' : label(key);
      const unit = relative ? '%' : '%p';
      const current = build[key];
      const low = Math.max(key === "critDamage" ? 20 : 0, current - spec(key).max * 2);
      const high = current + spec(key).max * 2;
      const samples = Array.from({ length: 61 }, (_, i) => {
        const x = low + (high - low) * i / 60;
        return [x, evaluateChange(build, key, x)[metric]];
      });
      const ymax = Math.max(...samples.map(point => point[1]), 1);
      const px = x => 40 + (x - low) / (high - low) * 270;
      const py = y => 145 - y / ymax * 120;
      const path = samples.map(([x, y], i) => (i ? 'L' : 'M') + px(x).toFixed(2) + ',' + py(y).toFixed(2)).join(' ');
      const value = evaluate(build)[metric];
      const tx = Math.min(spec(key).max, (high - low) / 4);
      const tangent = 'M' + px(current - tx) + ',' + py(value - tx * slope) + ' L' + px(current + tx) + ',' + py(value + tx * slope);
      const card = document.createElement('article');
      card.className = 'chart';
      card.innerHTML = '<h3>' + chartLabel + '</h3><p class="muted">∂' + metric.toUpperCase() + '/∂스탯 = ' + format(slope) + ' /초·' + unit + '</p>' +
        '<svg viewBox="0 0 340 185" role="img" aria-label="' + chartLabel + ' 변화에 따른 ' + metric.toUpperCase() + ' 그래프">' +
        '<defs><clipPath id="clip-' + metric + '-' + key + '"><rect x="40" y="20" width="270" height="125"/></clipPath></defs>' +
        '<path class="axis" d="M40 20V145H310"/><text x="36" y="20" text-anchor="end">' + format(ymax) + '</text><text x="36" y="148" text-anchor="end">0</text>' +
        '<g clip-path="url(#clip-' + metric + '-' + key + ')"><path class="curve" d="' + path + '"/><path class="tangent" d="' + tangent + '"/></g>' +
        '<circle cx="' + px(current) + '" cy="' + py(value) + '" r="4" class="point"/>' +
        '<text x="40" y="164">' + format(low) + '%</text><text x="310" y="164" text-anchor="end">' + format(high) + '%</text>' +
        '<text x="175" y="181" text-anchor="middle">현재 ' + format(current) + '% · 다른 스탯 고정</text></svg>';
      document.querySelector('#' + metric + '-charts').append(card);
    }
  }
}

function showNotes() {
  document.querySelector('#model-notes').innerHTML =
    '<p>기준 피해 = 총 피해 ÷ (1 + 피해/100) ÷ (1 + 공격 유형 피해/100). 기준 체력 = 총 체력 ÷ (1 + 체력/100). 현재 총수치에는 보너스를 중복 적용하지 않으며, 기준값을 고정해 편미분과 재분배를 계산합니다.</p>' +
    '<p>DPS = 총 피해 ÷ [1.7 ÷ (1 + 공속/100)] × (1 + 더블 찬스/100) × [1 + 치명타 확률/100 × 치명타 피해/100]. 치명타·더블·블록·반사 확률에는 100% 상한을 적용합니다. HPS = 총 체력 × 재생/100 + DPS × 흡수/100.</p>' +
    '<p>블록은 해당 확률로 피해를 무효화합니다. 반사는 무효화하지 않고 실제 받은 직접 피해를 해당 확률로 되돌려줍니다. 모의전은 평균값으로 계산하며, 흡수는 상대 블록 이후 직접 피해에 적용합니다. 반사의 재반사와 반사 피해에 의한 흡수는 계산하지 않습니다.</p>' +
    '<p>요정 효과는 입력값에 이미 포함되어 있어 다시 더하지 않습니다. 스탯 변화에서는 요정 보너스의 차이만 반영합니다. 10레벨 기준 Mira는 스킬 피해 15%p당 치명타 10%p(상한 80%p), Tira는 재사용 대기시간 감소 1%p당 블록 2.5%p(상한 30%p), Lora는 체력 10%p당 반사 7.5%p(상한 30%p)이며 변환 계수는 레벨에 비례합니다. 재분배에서는 선택한 요정을 유지하고 새 옵션의 효과를 계산합니다.</p>' +
    '<p>PvP 추천은 현재 분배를 고정된 상대로 두고, 상대 체력 대비 순피해율 − 자기 체력 대비 순피해율의 편미분을 비교합니다. 분배는 장비 9개·펫 3마리의 서로 다른 옵션 2개, 총 24개 제약을 유지합니다. 반사 확률은 직접 장비 옵션으로 배정하지 않고 Lora의 체력 연동으로 얻습니다. 128개 표본 후보의 대결 승점 상위 5개를 표시하며 전체 조합의 최적해를 보장하지 않습니다. 스킬 자체의 피해는 제외합니다.</p>';
}

function optimizeInWorker() {
  const status = document.querySelector('#optimizer-status');
  const worker = new Worker('/optimizer-worker.mjs', { type: 'module' });
  worker.onmessage = event => {
    worker.terminate();
    if (event.data.error) { status.textContent = event.data.error; return; }
    const solution = event.data.result;
    const pvp = solution.pvp;
    status.textContent = pvp.candidates + '개 후보 · ' + pvp.matches.toLocaleString('ko-KR') + '회 대결 완료';
    const allocations = document.querySelector('#allocations');
    allocations.innerHTML = '<label for="allocation-choice">분배 선택</label> <select id="allocation-choice">' +
      solution.topFive.map((entry, i) => '<option value="' + i + '">' + (entry.pvp.tied ? '공동 ' : '') +
        entry.pvp.rank + '위 · 분배 ' + (i + 1) + ' · ' + entry.pvp.record.points + '점</option>').join('') +
      '</select><div id="allocation-detail"></div>';
    const choice = document.querySelector('#allocation-choice');
    choice.addEventListener('change', () => showAllocation(solution.topFive[Number(choice.value)]));
    showAllocation(solution.topFive[0]);
  };
  worker.onerror = () => {
    worker.terminate();
    status.textContent = '분배 계산에 실패했습니다. 페이지를 새로고침해 주세요.';
  };  worker.postMessage(build);
}










function showAllocation(solution) {
  const pvp = solution.pvp;
  const current = evaluate(build);
  const change = (next, before) => before > 0 ? ((next / before - 1) * 100).toFixed(1) + '%' : '0 → ' + format(next);
  const recordText = record => record.wins + '승 ' + record.draws + '무 ' + record.losses + '패 · ' + record.points + '점';
  const duel = pvp.versusCurrent;
  const duelText = ({ left: '승리', right: '패배', draw: '무승부' })[duel.winner];
  const duration = duel.seconds === null ? '서로 회복을 뚫지 못함' : duel.seconds.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) + '초';
  const section = document.createElement('section');
  section.className = 'allocation';
  const rows = Object.entries(solution.counts).filter(([, count]) => count > 0);
  section.innerHTML = '<h3>' + (pvp.tied ? '공동 ' : '') + pvp.rank + '위 분배' +
    '</h3><p><strong>' + recordText(pvp.record) + '</strong></p><p class="muted">현재 분배의 같은 상대 전적: ' +
    recordText(pvp.currentRecord) + '</p><p>현재 입력 분배와 맞대결: <strong>' + duelText + '</strong> · ' + duration +
    '</p><p>DPS <strong>' + format(solution.dps) + '</strong> (' + change(solution.dps, current.dps) +
    ') · HPS <strong>' + format(solution.hps) + '</strong> (' + change(solution.hps, current.hps) +
    ') · 체력 <strong>' + format(solution.totalHealth) + '</strong> · 블록 ' + format(solution.block) + '% · 반사 ' + format(solution.reflect) + '%</p>' +
    '<p class="muted">승리 1점 · 무승부 0.5점 · 동률은 동률 후보끼리 맞대결. 표본 후보군 안의 우승 결과입니다.</p>' +
    '<ul class="distribution">' + rows.map(([key, count]) => '<li><span>' + label(key) +
    '</span><span>' + spec(key).max + '% × ' + count + '개 = ' + (spec(key).max * count) +
    '%' + (key === 'critDamage' ? ' + 기본 20%' : '') + '</span></li>').join('') + '</ul>';
  document.querySelector('#allocation-detail').replaceChildren(section);
}
