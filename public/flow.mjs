import { STATS, UNIT, fromTotals, evaluate } from './calculator.mjs';

const form = document.querySelector('form');
const calculate = document.querySelector('#calculate');
const caption = document.querySelector('#calculate-label');
const error = document.querySelector('#form-error');

function readBuild() {
  const build = { style: form.querySelector('[data-attack-type][aria-pressed="true"]').dataset.attackType };
  for (const key of ['totalDamage', 'totalHealth']) {
    const input = form.elements[key];
    const unit = input.closest('.total').querySelector('[data-unit][aria-pressed="true"]').dataset.unit;
    build[key] = Number(input.value) * UNIT[unit];
  }
  STATS.filter(({ key }) => key !== "damage" && key !== "health").forEach(({ key }) => build[key] = Number(form.elements[key].value));

  const normalized = fromTotals(build);
  evaluate(normalized);
  return normalized;
}

function update() {
  const complete = [...form.querySelectorAll('input')].every(input => input.value !== '' && input.validity.valid);
  let ready = complete;
  if (ready) {
    try { readBuild(); } catch { ready = false; }
  }
  calculate.disabled = !ready;
  caption.hidden = !ready;
}

let savedDraft;
try { savedDraft = localStorage.getItem('stat-master-input'); } catch { /* Storage may be blocked. */ }
try {
  const draft = JSON.parse(savedDraft || sessionStorage.getItem('stat-master-input') || 'null');
  if (draft) {
    for (const input of form.querySelectorAll('input')) input.value = draft.values?.[input.name] ?? '';
    form.querySelectorAll('.unit-controls').forEach(group => {
      const input = group.closest('.total')?.querySelector('input');
      const selected = input ? draft.units?.[input.name] : draft.style;
      const buttons = group.querySelectorAll('button');
      if ([...buttons].some(button => (button.dataset.unit || button.dataset.attackType) === selected)) buttons.forEach(button => {
        button.setAttribute('aria-pressed', String((button.dataset.unit || button.dataset.attackType) === selected));
      });
    });
  }
} catch { /* A stored draft is optional; fresh input still works. */ }

function saveDraft() {
  try {
    const units = {};
    form.querySelectorAll('.total').forEach(total => {
      units[total.querySelector('input').name] = total.querySelector('[aria-pressed="true"]').dataset.unit;
    });
    localStorage.setItem('stat-master-input', JSON.stringify({
      values: Object.fromEntries(new FormData(form)), units,
      style: form.querySelector('[data-attack-type][aria-pressed="true"]').dataset.attackType,
    }));
  } catch {
    error.textContent = '브라우저 저장이 차단되어 입력값을 보관하지 못했습니다. 현재 계산은 계속할 수 있습니다.';
  }
}

function handleEdit() {
  error.textContent = '';
  update();
  saveDraft();
}

form.addEventListener('input', handleEdit);
form.addEventListener('change', handleEdit);
form.addEventListener('focusout', handleEdit);
form.addEventListener('click', event => {
  if (event.target.closest('.unit-controls button')) handleEdit();
});
calculate.addEventListener('click', () => {
  if (!form.reportValidity()) return;
  try {
    const build = readBuild();
    saveDraft();
    sessionStorage.setItem('stat-master-build', JSON.stringify(build));
    location.assign('/results.html');
  } catch (cause) {
    error.textContent = cause.message || '결과를 저장할 수 없습니다. 브라우저의 세션 저장을 허용해 주세요.';
  }
});
update();




