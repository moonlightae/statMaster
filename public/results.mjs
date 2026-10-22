import { STATS, validate, evaluate, derivatives, upgrades, formatAmount } from './calculator.mjs';

const format = formatAmount;
const label = key => STATS.find(stat => stat.key === key).label;
const spec = key => STATS.find(stat => stat.key === key);
let build;
try {
  build = JSON.parse(sessionStorage.getItem('stat-master-build') || 'null');
  validate(build);
  const values = evaluate(build);
  if (build.totalsOnly) {
    document.querySelector('#optimizer-status').closest('section').querySelector('h2').textContent = 'DPS·HPS 균형 분배';
    document.querySelector('#optimizer-status').previousElementSibling.textContent = '장비 9개·펫 3마리, 개체당 다른 옵션 2개로 제한한 비교 모델입니다. 현재 피해·체력 보너스는 총합에서 분리할 수 없어 유지한 채 새 옵션을 비교하므로, 실제 전체 재분배의 최적해는 아닙니다.';
  }
  document.querySelector('#result-content').hidden = false;
  document.querySelector('#dps').textContent = format(values.dps);
  document.querySelector('#hps').textContent = format(values.hps);
  document.querySelector('#totals-summary').textContent = '총 피해 ' + format(values.totalDamage) + ' · 총 체력 ' + format(values.totalHealth) + ' · 재생 ' + format(values.regenHps) + '/초 · 흡수 ' + format(values.lifestealHps) + '/초';
  showRecommendations();
  showCharts();
  showNotes();
  optimizeInWorker();
} catch (error) {
  document.querySelector('#result-content').hidden = true;
  document.querySelector('#result-error').textContent = '입력값을 확인해 주세요. ' + error.message;
}

function showRecommendations() {
  const rows = upgrades(build).filter(row => Number.isFinite(row.score) && (row.dpsGain > 0 || row.hpsGain > 0)).slice(0, 3);
  document.querySelector('#recommendations').innerHTML = '<div><h3>DPS·HPS 함께 평가</h3><ol>' +
    rows.map(row => '<li><span>' +
      (build.totalsOnly && ['damage', 'health'].includes(row.key) ? '총 ' + row.label + ' 상대 증가' : row.label) +
      ' +' + row.max + (build.totalsOnly && ['damage', 'health'].includes(row.key) ? '%' : '%p') +
      '</span><strong>DPS +' + format(row.dpsGain) + ' · HPS +' + format(row.hpsGain) + '/초' +
      (row.gain === null ? ' · 회복 발생' : ' · 종합 +' + (row.gain * 100).toFixed(1) + '%') +
      '</strong></li>').join('') + '</ol></div>';
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
        return [x, evaluate({ ...build, [key]: x })[metric]];
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
    '<p>입력한 총 피해·총 체력은 모든 보너스 적용 후 수치로 그대로 사용합니다. 보너스를 다시 곱하지 않습니다. 공격 유형 보너스 변화는 입력한 해당 보너스를 기준으로 비교합니다. 피해·체력 그래프는 현재 총합을 기준으로 한 상대 변화입니다.</p>' +
    '<p>피해·체력의 개별 보너스는 입력받지 않습니다. 총합만으로 이 보너스의 원래 값을 역산할 수 없어, 참고 분배는 현재 총합에 포함된 피해·체력 보너스를 제거하지 않은 비교 모델입니다. 전체 재분배의 실제 최적해로 해석하지 마세요.</p>' +
    '<p>DPS = 총 피해 ÷ 공격 간격 × (1 + 더블 찬스/100) × [1 + 치명타 확률/100 × 치명타 피해/100]. 치명타 피해 입력값은 기본 20%를 포함합니다. 예를 들어 표시값 20%이면 치명타 한 번의 피해는 일반 공격의 1.2배, 100%이면 2배입니다. 치명타 확률·더블 찬스는 100% 상한을 적용합니다.</p>' +
    '<p>HPS = 총 체력 × 체력 재생/100 + DPS × 생명력 흡수/100. 사용자 제공 기준에 따라 재생은 초당 총 체력의 해당 비율, 흡수는 치명타를 포함한 실제 피해의 해당 비율로 계산합니다. 최대 체력에 도달해 버려지는 회복량은 제외하지 않습니다.</p>' +
    '<p>공격 속도 배율 = (공격 속도 + 100) / 100. 비교 기준 공격 간격 = 1.7초 ÷ 배율. FM DPS의 공속 0% 예시인 1.7초를 공통 기준으로 적용합니다. 치명타·재생·흡수는 사용자 제공 기준이며 별도의 게임 실측 검증은 하지 않았습니다. 더블 찬스는 같은 피해의 추가 타격 1회로 모델링하고, 추가 타격 지연은 반영하지 않습니다. 확률 100% 상한에서의 편미분은 오른쪽 방향 기준입니다.</p>' +
    '<p>참고 분배는 현재 총합을 기준으로 24개 옵션 최대치를 비교하는 모델입니다. 개체별 같은 옵션 중복은 금지하고 각 옵션은 최대 12개입니다. 치명타 피해 기본 20%는 옵션을 소비하지 않으며 재분배 후에도 유지합니다. DPS × HPS가 가장 큰 균형 분배 한 가지만 제공합니다. 두 지표의 상대 변화에 동일한 가중치를 둡니다. 한 지표의 일부 감소와 다른 지표의 더 큰 증가가 절충될 수 있습니다. 스킬·블록은 이 평타/회복 목적함수에 영향을 주지 않아 분배안에서 제외합니다.</p>' +
    '<p>출처: <a href="https://forge-master.fandom.com/wiki/Stats_and_Power" target="_blank" rel="noreferrer">총 피해·체력 공식</a> · <a href="https://github.com/athoschiari/forge-master-calculator/blob/main/lib/engine/formulas.dart" target="_blank" rel="noreferrer">이전 참고 커뮤니티 모델</a>. 현재 치명타·공속·회복식은 사용자 제공 기준을 우선합니다. 옵션 최대치는 제공해 주신 이미지 기준입니다. 기본 공격 간격의 확정값은 찾지 못했습니다. <a href="https://ieagalei.github.io/FmDPS/" target="_blank" rel="noreferrer">FM DPS</a>의 1.7초는 무기별 차이가 있는 예시로 안내되어 있어 비교용 고정값으로 사용합니다. DPS의 상대 증가율은 공통 기본 간격에 영향을 받지 않지만, 재생과 흡수가 섞이는 HPS의 효율·분배는 기본 간격에 영향을 받습니다.</p>';
}

function optimizeInWorker() {
  const status = document.querySelector('#optimizer-status');
  const worker = new Worker('/optimizer-worker.mjs', { type: 'module' });
  worker.onmessage = event => {
    worker.terminate();
    if (event.data.error) { status.textContent = event.data.error; return; }
    status.textContent = 'DPS·HPS를 함께 평가한 24개 옵션 조합 탐색 완료';
    const solution = event.data.result;
    const current = evaluate(build);
    const change = (next, before) => before > 0 ? ((next / before - 1) * 100).toFixed(1) + '%' : '0 → ' + format(next);
    const section = document.createElement('section');
    section.className = 'allocation';
    const rows = Object.entries(solution.counts).filter(([, count]) => count > 0);
    section.innerHTML = '<h3>DPS·HPS 균형 분배</h3><p>DPS <strong>' + format(solution.dps) + '</strong> (' +
      change(solution.dps, current.dps) + ') · HPS <strong>' + format(solution.hps) + '</strong> (' +
      change(solution.hps, current.hps) + ')</p><p class="muted">DPS × HPS 최대화 · 두 지표의 상대 변화에 동일 가중치</p>' +
      '<ul class="distribution">' + rows.map(([key, count]) => '<li><span>' + label(key) +
      '</span><span>' + spec(key).max + '% × ' + count + '개 = ' + (spec(key).max * count) +
      '%' + (key === 'critDamage' ? ' + 기본 20%' : '') + '</span></li>').join('') + '</ul>' +
      '<details><summary>장비·펫별 배치 보기</summary><table><thead><tr><th>개체</th><th>옵션 1</th><th>옵션 2</th></tr></thead><tbody>' +
      solution.slots.map(slot => '<tr><th>' + slot.name + '</th>' + slot.keys.map(key => '<td>' + label(key) + ' ' +
      spec(key).max + '%</td>').join('') + '</tr>').join('') + '</tbody></table></details>';
    document.querySelector('#allocations').append(section);
  };  worker.onerror = () => { worker.terminate(); status.textContent = '분배 계산에 실패했습니다. 페이지를 새로고침해 주세요.'; };
  worker.postMessage(build);
}







