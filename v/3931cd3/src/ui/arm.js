// Two-tap protection for buttons that would cut off the live output: the first
// tap arms the button ("TAP AGAIN"), the second (within ~2.5 s) runs it. When
// nothing is at risk the first tap runs straight away. `run` executes inside the tap.

/**
 * @param {HTMLButtonElement} btn
 * @param {{ risky: () => boolean, run: () => void, armedText?: string }} opts
 */
export function armable(btn, { risky, run, armedText = 'TAP AGAIN' }) {
  let armed = false;
  let timer = 0;
  const disarm = () => {
    armed = false;
    clearTimeout(timer);
    btn.classList.remove('is-armed');
  };
  btn.addEventListener('click', () => {
    if (armed || !risky()) {
      disarm();
      run();
      return;
    }
    armed = true;
    btn.dataset.armText = armedText;
    btn.classList.add('is-armed');
    timer = setTimeout(disarm, 2600);
  });
  return { disarm };
}
