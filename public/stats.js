document.querySelectorAll('.total').forEach(total => {
  const input = total.querySelector('input');

  input.addEventListener('blur', () => {
    if (input.value === '' || !input.checkValidity()) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    input.value = value.toLocaleString('en-US', {
      useGrouping: false,
      minimumSignificantDigits: 3,
      maximumSignificantDigits: 3,
    });
  });

});

document.querySelectorAll('.unit-controls').forEach(group => {
  const buttons = group.querySelectorAll('button');
  buttons.forEach(button => {
    button.addEventListener('click', () => {
      buttons.forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    });
  });
});
