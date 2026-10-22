const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('total inputs round and each unit selection stays exclusive', () => {
  const handlers = {};
  const input = { value: '', checkValidity: () => Number(input.value) >= 0 && Number.isFinite(Number(input.value)), addEventListener: (event, handler) => handlers[event] = handler };
  const buttons = ['k', 'm', 'b', 't'].map(unit => ({
    dataset: { unit },
    pressed: unit === 'k' ? 'true' : 'false',
    addEventListener(event, handler) { this.click = handler; },
    setAttribute(name, value) { this.pressed = value; },
  }));
  const total = { querySelector: () => input };
  const attackButtons = ['ranged', 'melee'].map(type => ({
    dataset: { attackType: type },
    pressed: type === 'ranged' ? 'true' : 'false',
    addEventListener(event, handler) { this.click = handler; },
    setAttribute(name, value) { this.pressed = value; },
  }));
  const groups = [{ querySelectorAll: () => buttons }, { querySelectorAll: () => attackButtons }];
  vm.runInNewContext(readFileSync(require.resolve('./public/stats.js'), 'utf8'), {
    document: { querySelectorAll: selector => selector === '.total' ? [total] : groups },
  });
  for (const [value, expected] of [['12.345', '12.3'], ['1', '1.00'], ['0.0012345', '0.00123'], ['999.9', '1000'], ['0', '0.00'], ['', ''], ['-1', '-1']]) {
    input.value = value;
    handlers.blur();
    assert.equal(input.value, expected);
  }
  attackButtons[1].click();
  assert.deepEqual(attackButtons.map(button => button.pressed), ['false', 'true']);
  assert.equal(buttons[0].pressed, 'true');
  for (const index of [3, 1, 1, 0, 2]) {
    buttons[index].click();
    assert.deepEqual(buttons.map(button => button.pressed), buttons.map((_, i) => String(i === index)));
    assert.equal(input.value, '-1');
    assert.equal(attackButtons[1].pressed, 'true');
  }
});



