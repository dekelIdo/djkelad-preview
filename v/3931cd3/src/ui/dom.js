// Tiny DOM helpers: element builder, icons, toasts, bottom sheets.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const PATHS = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
  next: '<path d="M6 6.2v11.6a.8.8 0 0 0 1.2.7l8.6-5.8a.8.8 0 0 0 0-1.4L7.2 5.5a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/><rect x="16.5" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M18 6.2v11.6a.8.8 0 0 1-1.2.7l-8.6-5.8a.8.8 0 0 1 0-1.4l8.6-5.8a.8.8 0 0 1 1.2.7z" fill="currentColor" stroke="none"/><rect x="4.9" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
  computer: '<rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M8 20h8M12 16.5V20"/>',
  speaker: '<rect x="6" y="2.5" width="12" height="19" rx="2.2"/><circle cx="12" cy="14" r="3.2"/><circle cx="12" cy="7" r="1"/>',
  tv: '<rect x="2.5" y="5" width="19" height="12" rx="1.6"/><path d="M8 20.5h8"/>',
  device: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20.5V16h-4.5"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  decks: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="3.5" y="13" width="5" height="3" rx="1" fill="currentColor"/><rect x="9.5" y="7" width="5" height="3" rx="1" fill="currentColor"/><rect x="15.5" y="15" width="5" height="3" rx="1" fill="currentColor"/>',
  queue: '<path d="M4 6h12M4 11h12M4 16h7"/><path d="M16 14.5v5l4-2.5z" fill="currentColor"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  eject: '<path d="M12 5l7 8H5z" fill="currentColor" stroke="none"/><rect x="5" y="16" width="14" height="2.6" rx="1" fill="currentColor" stroke="none"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  swap: '<path d="M7 7h12M15 3l4 4-4 4"/><path d="M17 17H5M9 13l-4 4 4 4"/>',
  grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  playlist: '<path d="M4 6h11M4 11h11M4 16h6"/><path d="M18 6v10.5"/><circle cx="16" cy="16.5" r="2.2"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ic ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return span;
}

export function deviceIcon(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('smartphone') || t.includes('tablet')) return icon('phone');
  if (t.includes('computer')) return icon('computer');
  if (t.includes('tv') || t.includes('castvideo')) return icon('tv');
  if (t.includes('speaker') || t.includes('audio') || t.includes('cast')) return icon('speaker');
  return icon('device');
}

export function monogram(size = 26) {
  const span = document.createElement('span');
  span.className = 'monogram';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><circle cx="25" cy="32" r="16" fill="none" stroke="#E3A94F" stroke-width="5"/><circle cx="39" cy="32" r="16" fill="none" stroke="#5DA6F5" stroke-width="5" opacity="0.9"/></svg>`;
  return span;
}

export function wordmark() {
  return h('span', { class: 'wordmark', 'aria-label': 'DJKELAD' }, 'D', h('span', { class: 'j' }, 'J'), 'KELAD');
}

// ---------- toasts ----------

let toastHost = null;

export function toast(message, kind = 'info', action = null) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${kind}` }, h('span', { class: 'toast-msg' }, message));
  if (action) {
    el.append(
      h('button', {
        class: 'toast-act',
        onclick: () => {
          action.run();
          dismiss();
        },
      }, action.label),
    );
  }
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const timer = setTimeout(dismiss, action ? 5000 : 3400);
  function dismiss() {
    clearTimeout(timer);
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  }
  // Keep at most three; over a sheet only the latest, so the sheet stays usable.
  const max = document.documentElement.classList.contains('sheet-open') || window.innerHeight < 560 ? 1 : window.innerWidth < 600 ? 2 : 3;
  while (toastHost.children.length > max) toastHost.firstChild.remove();
  return dismiss;
}

// ---------- bottom sheets ----------

let openSheets = 0;

export function openSheet({ title, body, className = '', onClose, labelledBy } = {}) {
  const previouslyFocused = document.activeElement;
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const closeBtn = h('button', { class: 'icon-btn sheet-close', 'aria-label': 'Close' }, icon('close'));
  const panel = h(
    'div',
    { class: `sheet ${className}`.trim(), role: 'dialog', 'aria-modal': 'true', 'aria-label': labelledBy ? null : title, tabindex: '-1' },
    h('div', { class: 'sheet-grip', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, h('h2', { class: 'sheet-title' }, title), closeBtn),
    h('div', { class: 'sheet-body' }, body),
  );
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    openSheets--;
    document.removeEventListener('keydown', onKey);
    backdrop.classList.remove('open');
    panel.classList.remove('open');
    setTimeout(() => {
      backdrop.remove();
      panel.remove();
    }, 240);
    if (openSheets === 0) document.documentElement.classList.remove('sheet-open');
    onClose?.();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true });
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, panel);
  openSheets++;
  document.documentElement.classList.add('sheet-open');
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    panel.classList.add('open');
    panel.focus({ preventScroll: true });
  });
  return { close, panel };
}

export function confirmSheet({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const yes = h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'} btn-lg`, onclick: () => done(true) }, confirmLabel);
    const no = h('button', { class: 'btn btn-quiet btn-lg', onclick: () => done(false) }, cancelLabel);
    const s = openSheet({
      title,
      className: 'sheet-confirm',
      body: h('div', { class: 'confirm' }, message ? h('p', { class: 'confirm-msg' }, message) : null, h('div', { class: 'confirm-actions' }, no, yes)),
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    function done(v) {
      answered = true;
      resolve(v);
      s.close();
    }
  });
}

/**
 * A sheet with several big choices. Each choice's `run` is called synchronously
 * inside the tap, so it may start audio (iOS and Spotify's SDK require that).
 * @param {{ title: string, message?: string | Node, choices: { label: string, kind?: 'primary'|'danger'|'quiet', run?: () => void, sub?: string }[], className?: string }} opts
 */
export function choiceSheet({ title, message, choices, className = '' }) {
  let sheet = null;
  const buttons = choices.map((c) => {
    const b = h(
      'button',
      { class: `btn btn-lg btn-block choice-btn ${c.kind === 'danger' ? 'btn-danger' : c.kind === 'quiet' ? 'btn-quiet' : 'btn-primary'}` },
      h('span', { class: 'choice-l' }, c.label),
      c.sub ? h('span', { class: 'choice-sub' }, c.sub) : null,
    );
    b.addEventListener('click', () => {
      sheet.close();
      c.run?.();
    });
    return b;
  });
  sheet = openSheet({
    title,
    className: `sheet-choice ${className}`.trim(),
    body: h('div', { class: 'choice' }, message ? h('div', { class: 'confirm-msg' }, message) : null, h('div', { class: 'choice-actions' }, buttons)),
  });
  return sheet;
}
