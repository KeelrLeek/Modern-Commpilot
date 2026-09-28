/* CommPilot 2.0 breadcrumb: the v0.2 alpha's pill trail, in the crumb band. A route glyph leads; each level is
   a pill with an arrow between; the current place (the page pill pjax.js adds, else the entity, else the last
   level) is the accent pill and pops in when it changes. CommPilot's own links are MOVED into the trail, so they
   keep their native clicks, and everything stays in the same header cell and document order that pjax.js and
   enhancer.js read. The header is rebuilt by pjax.js on every page; the trail follows it. An element marked
   .cp-bc-attach (enhancer.js's extension chip) rides on the entity pill, right after it with no arrow. */
(() => {
  if (window !== window.top) return;

  const active = () => Boolean(document.documentElement.dataset.cpDirection) &&
    document.body?.id === 'initBody.menuTemplate';
  const ROUTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="19" r="3"/>' +
    '<path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>';
  const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
  const ITEMS = 'a.headerAuthLevelLink, span.headerAuthLevel, button.cp-page-pill';
  const clean = text => String(text || '').replace(/^\s*:\s*/, '').replace(/\s+/g, ' ').trim();
  const trailCell = () => [...document.querySelectorAll('td.headerBar')]
    .find(td => td.querySelector('a.headerAuthLevelLink, span.headerAuthLevel'));
  let current = '';
  let building = false;

  function build() {
    if (!active()) return;
    const cell = trailCell();
    if (!cell) return;
    const items = [...cell.querySelectorAll(ITEMS)];
    if (!items.length) return;
    const attached = [...cell.querySelectorAll('.cp-bc-attach')];
    let bar = cell.querySelector(':scope > .cp-bc');
    const built = bar && [...bar.children].filter(el => el.matches(ITEMS));
    if (built && built.length === items.length && built.every((el, i) => el === items[i])) {
      attach(items, attached);
      mark(bar, items);
      return;
    }
    building = true;
    try {
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'cp-bc';
        bar.setAttribute('role', 'navigation');
        bar.setAttribute('aria-label', 'Breadcrumb');
        cell.insertBefore(bar, items[0]);
      }
      const lead = document.createElement('span');
      lead.className = 'cp-bc-lead';
      lead.innerHTML = ROUTE;
      const parts = [lead];
      items.forEach((item, i) => {
        if (i) {
          const sep = document.createElement('span');
          sep.className = 'cp-bc-sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.innerHTML = ARROW;
          parts.push(sep);
        }
        parts.push(item);   // moves CommPilot's own element, with its handlers
      });
      bar.replaceChildren(...parts);
      attach(items, attached);
      mark(bar, items);
    } finally { building = false; }
  }

  function attach(items, attached) {
    let at = items.find(el => el.matches('span.headerAuthLevel'));
    for (const el of attached) {
      if (!at) return;
      if (at.nextElementSibling !== el) at.after(el);
      at = el;
    }
  }

  // Roles in the trail. At user level the "Users" list link sits right before the user's id and only repeats
  // it (as in the alpha); it stays in the DOM for the Copy User ID tools, hidden with its arrow.
  function mark(bar, items) {
    const entity = items.find(el => el.matches('span.headerAuthLevel') && clean(el.textContent));
    const pill = items.find(el => el.matches('button.cp-page-pill'));
    items.forEach((el, i) => {
      const prev = items[i - 1];
      const hide = (el.matches('a.headerAuthLevelLink') && clean(el.textContent) === 'Users' && items[i + 1] === entity) ||
        (prev && clean(prev.textContent) === clean(el.textContent));   // a level CommPilot repeats
      el.classList.toggle('cp-bc-hidden', Boolean(hide));
      el.previousElementSibling?.classList.toggle('cp-bc-hidden', Boolean(hide) && i > 0);
    });
    const visible = items.filter(el => !el.classList.contains('cp-bc-hidden'));
    const cur = pill || entity || visible[visible.length - 1];
    for (const el of items) {
      const isCur = el === cur;
      el.classList.toggle('cp-bc-cur', isCur);
      el.classList.toggle('cp-bc-seg', !isCur && el.matches('a.headerAuthLevelLink'));
      el.classList.toggle('cp-bc-static', !isCur && el.matches('span.headerAuthLevel'));
      el.classList.toggle('cp-bc-id', el === entity);
      if (isCur && !el.matches('button')) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    }
    // The destination pops in when it changes (the alpha's "destination focus").
    const key = clean(cur?.textContent);
    if (cur && key !== current) {
      current = key;
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        try {
          cur.animate([{ opacity: 0, transform: 'scale(.82) translateX(10px)' }, { opacity: 1, transform: 'none' }],
            { duration: 300, easing: 'cubic-bezier(.34, 1.4, .64, 1)' });
        } catch (e) {}
      }
    }
  }

  // pjax.js rewrites the header on every page and adds the page pill a moment later: follow both.
  let watched = null, queued = false;
  const observer = new MutationObserver(() => {
    if (building || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; build(); });
  });
  function watch() {
    const cell = trailCell();
    if (cell && cell !== watched) {
      observer.disconnect();
      observer.observe(cell, { childList: true, subtree: true });
      watched = cell;
    }
    build();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, { once: true });
  else watch();
  for (const name of ['cp:reskin', 'cp:morphed', 'cp:theme-change']) document.addEventListener(name, () => requestAnimationFrame(watch));
})();
