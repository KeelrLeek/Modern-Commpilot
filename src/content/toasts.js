/* CommPilot's messages as toasts. A page's own message ("Failed to read: [Error 4027] Please narrow your search, there
   are 7792 matching records." in td.error, or a .warning / .informational one) and pjax.js's notices (.cp-alert: idle,
   session expired, server error, upload) leave the page and appear at the bottom of the window, centred on the page
   content, then go away by themselves: a note after 5s, a warning after 8s, an error after 10s (toasts.css), held
   while the pointer or keyboard focus is on them, or at once with their ×. A notice with an action (Sign in) keeps
   its button and stays until used or closed. The message stays in the page, hidden, for CommPilot's and pjax.js's
   own scripts. The add and edit windows (pjax.js .cp-modal) and the menu board's Retry notice keep theirs in place. */
(() => {
  if (window !== window.top) return;

  const SOURCES = '.error, .warning, .informational, .cp-alert';
  const KEEP = '.cp-modal, .cp-modal-back, .cp-console, #cp-toasts, #cp-appearance-panel';
  // Codes CommPilot reports as errors that are really advice.
  const KNOWN = { 4027: { severity: 'warning', title: 'Too many results' } };
  const ICONS = {
    error: '<circle cx="12" cy="12" r="9"/><path d="m9.25 9.25 5.5 5.5m0-5.5-5.5 5.5"/>',
    warning: '<path d="M10.3 4.6 3.4 17a2 2 0 0 0 1.75 3h13.7a2 2 0 0 0 1.75-3L13.7 4.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 16.75h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.75h.01"/>',
  };
  const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M17 7 7 17M7 7l10 10"/></svg>';
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  };
  const active = () => Boolean(document.documentElement.dataset.cpDirection) &&
    document.body?.id === 'initBody.menuTemplate';
  const content = () => document.querySelector('td[width="82%"]');

  // "Failed to read: [Error 4027] Please narrow …" → title "Failed to read", code "Error 4027", the sentence.
  function parse(el) {
    const text = clean(el.textContent);
    if (el.matches('.cp-alert')) {   // pjax.js's notices come with their parts already
      const part = sel => clean(el.querySelector(sel)?.textContent);
      return { text, title: part('.cp-alert-title'), code: part('.cp-alert-chip'), body: part('.cp-alert-body') || text,
        severity: el.matches('.cp-alert-error') ? 'error' : el.matches('.cp-alert-warning') ? 'warning' : 'info',
        action: el.querySelector('.cp-alert-act') };
    }
    let severity = el.matches('.error') ? 'error' : el.matches('.warning') ? 'warning' : 'info';
    let title = '', code = '', body = text;
    const action = /^(Failed to [a-z]+)\s*:\s*([\s\S]+)$/i.exec(body);
    if (action) { title = action[1][0].toUpperCase() + action[1].slice(1).toLowerCase(); body = action[2]; }
    const coded = /^\[\s*(Error|Warning)\s+([\d,]+)\s*\]\s*([\s\S]*)$/i.exec(body);
    if (coded) {
      code = coded[1][0].toUpperCase() + coded[1].slice(1).toLowerCase() + ' ' + coded[2];
      body = coded[3] || body;
      const known = KNOWN[coded[2].replace(/,/g, '')];
      if (known) ({ severity, title } = known);
    }
    body = body.replace(/(there are )(\d{4,})( matching records)/i, (_, a, n, b) => a + Number(n).toLocaleString('en-US') + b);
    return { severity, title, code, body: body[0].toUpperCase() + body.slice(1), text };
  }

  let host = null;
  function region() {
    if (host?.isConnected) return host;
    host = make('div');
    host.id = 'cp-toasts';
    host.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(host);
    place();
    return host;
  }
  // Centred under the page content (right of the sidebar).
  function place() {
    if (!host) return;
    const r = content()?.getBoundingClientRect();
    host.style.setProperty('--cp-toast-x', r?.width ? `${Math.round(r.left + r.width / 2)}px` : '50%');
  }

  function dismiss(item) {
    if (!item.isConnected || item.classList.contains('cp-toast-leaving')) return;
    item.classList.add('cp-toast-leaving');
    item.addEventListener('animationend', event => { if (event.target === item) item.remove(); });
    setTimeout(() => item.remove(), 400);   // no leave animation (reduced motion)
  }

  function toast({ severity, title, code, body, text, action }) {
    const list = region();
    // The same message again (the page shown once more) replaces its toast instead of stacking a copy.
    for (const old of list.querySelectorAll('.cp-toast')) if (old.dataset.text === text) old.remove();
    const item = make('div', `cp-toast cp-toast-${severity}`);
    item.dataset.text = text;
    item.setAttribute('role', severity === 'info' ? 'status' : 'alert');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'cp-toast-icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = ICONS[severity];
    const words = make('div', 'cp-toast-text');
    if (title || code) {
      const head = make('div', 'cp-toast-title', title);
      if (code) head.appendChild(make('code', 'cp-toast-code', code));
      words.appendChild(head);
    }
    words.appendChild(make('div', 'cp-toast-body', body));
    if (action) {
      // The notice's own button, pressed for real, so what it does stays pjax.js's.
      const act = make('button', 'cp-toast-act', clean(action.textContent));
      act.type = 'button';
      act.addEventListener('click', () => { action.click(); dismiss(item); });
      words.appendChild(act);
      item.classList.add('cp-toast-stays');
      item.cpAction = action;   // its page replaced, the toast goes too (scan)
    }
    const close = make('button', 'cp-toast-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = CLOSE;
    close.addEventListener('click', () => dismiss(item));
    item.append(icon, words, close);
    // The bar's countdown is the toast's life; it pauses while the toast is pointed at or focused (toasts.css).
    if (!action) {
      const timer = make('span', 'cp-toast-timer');
      timer.addEventListener('animationend', () => dismiss(item));
      item.appendChild(timer);
    }
    list.appendChild(item);
  }

  // roots: what was added since the last look (or, at the start, the whole page). A list can run to many thousands
  // of rows, so a change looks only at what it added.
  function scan(roots) {
    // A toast that stays for its button goes once that button's page has been replaced.
    for (const item of host?.querySelectorAll('.cp-toast-stays') || []) if (item.cpAction && !item.cpAction.isConnected) dismiss(item);
    if (!active()) return;
    const cell = content();
    if (!cell) return;
    const within = roots ? [...new Set(roots.filter(root => root.isConnected)
      .map(root => root.contains(cell) ? cell : cell.contains(root) ? root : null).filter(Boolean))] : [cell];
    const found = within.flatMap(root => [...(root !== cell && root.matches(SOURCES) ? [root] : []), ...root.querySelectorAll(SOURCES)]);
    for (const el of found) {
      if (el.dataset.cpToast || el.closest(KEEP)) continue;
      // A message, not a field or a list CommPilot happens to colour.
      if (clean(el.textContent).length < 4 || el.querySelector('input:not([type="hidden"]), select, textarea, table')) continue;
      // "Too many results" on a list's search: the page offers to load them all instead (pjax.js cpSweep).
      if (/Error\s*4027/i.test(el.textContent) && cell.querySelector('#searchTable')) { el.dataset.cpToast = 'sweep'; continue; }
      el.dataset.cpToast = '1';
      toast(parse(el));
    }
  }

  let queued = false;
  const added = new Set();
  const soon = records => {
    let removed = false;
    // A list's rows taken out and put back in the same batch are a sort (lists.js), nothing new to show.
    const out = new Set();
    for (const record of records) {
      for (const node of record.removedNodes) if (node.localName === 'tr') out.add(node);
      for (const node of record.addedNodes) if (node.nodeType === 1 && !out.has(node)) added.add(node);
      if (record.removedNodes.length) removed = true;
    }
    if (queued || (!added.size && !removed)) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; const roots = [...added]; added.clear(); scan(roots); });
  };
  const start = () => {
    scan();
    new MutationObserver(soon).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.addEventListener('resize', place, { passive: true });
})();
