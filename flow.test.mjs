import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { STATS, UNIT, fromTotals, evaluate } from './public/calculator.mjs';

const source = readFileSync(new URL('./public/flow.mjs', import.meta.url), 'utf8').replace(/^import .*;\s*/, '');
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
function page(localStorage, sessionStorage = storage()) {
  const handlers = {};
  const inputs = Object.fromEntries(['totalDamage', 'totalHealth', ...STATS.map(s => s.key)].map(name => [name, { name, value: '', validity: { valid: true } }]));
  inputs.fairy = { name: 'fairy', value: 'none' };
  inputs.fairyLevel = { name: 'fairyLevel', value: '10', validity: { valid: true } };
  const groups = [];
  const totals = [];
  for (const key of ['totalDamage', 'totalHealth']) {
    const buttons = ['k', 'm', 'b', 't'].map(unit => ({ dataset: { unit }, pressed: unit === 'k', setAttribute(_, value) { this.pressed = value === 'true'; } }));
    const total = { querySelector: selector => selector === 'input' ? inputs[key] : buttons.find(b => b.pressed) };
    inputs[key].closest = () => total;
    groups.push({ buttons, querySelectorAll: () => buttons, closest: () => total });
    totals.push(total);
  }
  const attack = ['ranged', 'melee'].map(type => ({ dataset: { attackType: type }, pressed: type === 'ranged', setAttribute(_, value) { this.pressed = value === 'true'; } }));
  groups.push({ buttons: attack, querySelectorAll: () => attack, closest: () => null });
  const form = {
    elements: inputs,
    querySelector: () => attack.find(button => button.pressed),
    querySelectorAll: selector => selector === 'input' ? Object.values(inputs).filter(input => input.name !== 'fairy') : selector === 'input, select' ? Object.values(inputs) : selector === '.total' ? totals : groups,
    addEventListener: (name, handler) => handlers[name] = handler,
    reportValidity: () => true,
  };
  const calculate = { disabled: true, addEventListener: (_, handler) => handlers.calculate = handler };
  const error = { textContent: '' };
  const caption = {};
  const navigations = [];
  vm.runInNewContext(source, {
    STATS, UNIT, fromTotals, evaluate, localStorage, sessionStorage,
    document: { querySelector: selector => ({ form, '#calculate': calculate, '#calculate-label': caption, '#form-error': error })[selector] },
    FormData: class { constructor() { return Object.entries(inputs).map(([name, input]) => [name, input.value]); } },
    location: { assign: path => navigations.push(path) },
  });
  return { inputs, groups, handlers, calculate, error, navigations };
}

test('unfinished values and selections persist across visits without calculating', () => {
  const local = storage();
  const first = page(local);
  first.inputs.totalDamage.value = '12.345';
  first.handlers.input();
  first.groups[0].buttons.forEach(button => button.pressed = button.dataset.unit === 'm');
  first.groups[2].buttons.forEach(button => button.pressed = button.dataset.attackType === 'melee');
  first.handlers.click({ target: { closest: () => true } });
  first.inputs.totalDamage.value = '12.3';
  first.handlers.focusout();

  const reopened = page(local);
  assert.equal(reopened.inputs.totalDamage.value, '12.3');
  assert.equal(reopened.inputs.totalHealth.value, '');
  assert.equal(reopened.groups[0].buttons.find(b => b.pressed).dataset.unit, 'm');
  assert.equal(reopened.groups[2].buttons.find(b => b.pressed).dataset.attackType, 'melee');
  assert.equal(reopened.calculate.disabled, true);
  reopened.inputs.totalDamage.value = '';
  reopened.handlers.input();
  assert.equal(page(local).inputs.totalDamage.value, '');
});

test('blocked local storage reports the limit and still permits valid calculation', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  const current = page(blocked);
  for (const input of Object.values(current.inputs)) input.value = input.name === 'fairy' ? 'none' : input.name === 'critDamage' ? '20' : '1';
  current.handlers.input();
  assert.equal(current.calculate.disabled, false);
  assert.match(current.error.textContent, /저장이 차단/);
  current.handlers.calculate();
  assert.deepEqual(current.navigations, ['/results.html']);
});

test('a legacy session draft restores, while invalid saved units keep usable defaults', () => {
  const local = storage();
  const session = storage();
  session.setItem('stat-master-input', JSON.stringify({ values: { totalDamage: '45.6' }, units: { totalDamage: 'bad' }, style: 'bad' }));
  const current = page(local, session);
  assert.equal(current.inputs.totalDamage.value, '45.6');
  assert.equal(current.groups[0].buttons.find(b => b.pressed).dataset.unit, 'k');
  assert.equal(current.groups[2].buttons.find(b => b.pressed).dataset.attackType, 'ranged');
  assert.equal(current.inputs.fairy.value, 'none');
  assert.equal(current.inputs.fairyLevel.value, '10');
});

test('fairy selection and level persist and reach the calculation build', () => {
  const local = storage();
  const session = storage();
  const first = page(local, session);
  for (const input of Object.values(first.inputs)) input.value = input.name === 'fairy' ? 'mira' : input.name === 'critDamage' ? '20' : '10';
  first.inputs.fairyLevel.value = '20';
  first.handlers.change();
  const reopened = page(local, session);
  assert.equal(reopened.inputs.fairy.value, 'mira');
  assert.equal(reopened.inputs.fairyLevel.value, '20');
  assert.equal(reopened.calculate.disabled, false);
  reopened.handlers.calculate();
  const build = JSON.parse(session.getItem('stat-master-build'));
  assert.equal(build.fairy, 'mira');
  assert.equal(build.fairyLevel, 20);
  assert.equal(build.critChance, 10);
  assert.equal(build.damage, 10);
  assert.equal(build.health, 10);
  assert.equal(build.reflect, undefined);
  assert.equal(build.totalsOnly, false);
  assert.ok(Math.abs(build.baseDamage - 10000 / 1.1 / 1.1) < 1e-8);
  assert.ok(Math.abs(build.baseHealth - 10000 / 1.1) < 1e-8);
});
