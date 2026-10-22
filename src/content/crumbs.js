/* CommPilot 2.0 breadcrumb: the v0.2 alpha's pill trail, in the crumb band. A route glyph leads; each level is
   a pill with an arrow between; the current place (the page pill pjax.js adds, else the entity, else the last
   level) is the accent pill and pops in when it changes. CommPilot's own links are MOVED into the trail, so they
   keep their native clicks, and everything stays in the same header cell and document order that pjax.js and
   enhancer.js read. The header is rebuilt by pjax.js on every page; the trail follows it. Elements marked
   .cp-bc-attach (enhancer.js's extension and number chips, pjax.js's ⌄ menu on a board) ride on the entity pill, or
   the last pill when there is none, right after it with no arrow.
   The trail keeps one line (mockup pick B): when it does not fit its cell, the levels after the first fold, earliest
   first, into a "…" pill whose list opens them, and then the page pill shortens. */
(() => {
  if (window !== window.top) return;

  const active = () => Boolean(document.documentElement.dataset.cpDirection) &&
    document.body?.id === 'initBody.menuTemplate';
  const ROUTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2"/></svg>';
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
    // Moving the trail's elements drops keyboard focus; whichever one had it gets it back once they are in place.
    const focused = bar?.contains(document.activeElement) ? document.activeElement : null;
    const built = bar && [...bar.children].filter(el => el.matches(ITEMS));
    // PJAX can append a page pill inside an already-built trail. Matching the
    // links alone misses its absent arrow (or an orphan left after removal).
    // The arrow before "…" is fit()'s own and is not counted.
    const separators = bar && [...bar.children].filter(el => el.matches('.cp-bc-sep') &&
      !el.nextElementSibling?.matches('.cp-bc-more'));
    const separated = separators?.length === items.length - 1 && items.every((el, i) => !i ||
      el.previousElementSibling?.matches('.cp-bc-sep') && el.previousElementSibling.querySelector('svg'));
    if (built && separated && built.length === items.length && built.every((el, i) => el === items[i])) {
      attach(items, attached);
      mark(bar, items);
      fit(bar, cell);
      refocus(focused);
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
      // The trail's own buttons are kept, so an open list keeps the button that opened it.
      let lead = bar.querySelector(':scope > .cp-bc-lead');
      if (!lead) {
        lead = document.createElement('button');
        lead.type = 'button';
        lead.className = 'cp-bc-lead cp-bc-history';
        lead.setAttribute('aria-label', 'Recent locations');
        lead.setAttribute('aria-haspopup', 'menu');
        lead.setAttribute('aria-expanded', 'false');
        lead.setAttribute('aria-controls', 'cp-bc-history-menu');
        lead.title = 'Recent locations';
        lead.innerHTML = ROUTE;
      }
      const more = bar.querySelector(':scope > button.cp-bc-more');
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
        if (more && more.previousElementSibling?.previousElementSibling === item) parts.push(more.previousElementSibling, more);
      });
      bar.replaceChildren(...parts);
      attach(items, attached);
      mark(bar, items);
      fit(bar, cell);
    } finally { building = false; }
    refocus(focused);
  }
  function refocus(el) {
    if (el?.isConnected && document.activeElement !== el) el.focus({ preventScroll: true });
  }

  // One line. Unfolding, measuring and folding happen in one go, before the next paint. The "…" pill and its arrow
  // are made once per trail and only shown or hidden after that, so the trail's own watcher is not set off again.
  function fit(bar, cell) {
    const wasBuilding = building;
    building = true;
    try {
      for (const el of bar.querySelectorAll(':scope > .cp-bc-folded')) el.classList.remove('cp-bc-folded');
      bar.classList.remove('cp-bc-squeeze');
      let more = bar.querySelector(':scope > button.cp-bc-more');
      const over = () => cell.scrollWidth > cell.clientWidth + 1;
      const levels = [...bar.querySelectorAll(':scope > a.headerAuthLevelLink.cp-bc-seg:not(.cp-bc-hidden)')];
      if (!over() || levels.length < 2) {
        if (more) { more.classList.add('cp-bc-folded'); more.previousElementSibling?.classList.add('cp-bc-folded'); }
        return;
      }
      if (!more || more.previousElementSibling?.previousElementSibling !== levels[0]) {
        more?.previousElementSibling?.remove();
        more?.remove();
        more = document.createElement('button');
        more.type = 'button';
        more.className = 'cp-bc-more';
        more.textContent = '…';
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        more.setAttribute('aria-label', 'Show the hidden levels');
        more.title = 'Show the hidden levels';
        const arrow = document.createElement('span');
        arrow.className = 'cp-bc-sep';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.innerHTML = ARROW;
        levels[0].after(arrow, more);
      }
      for (let i = 1; i < levels.length && over(); i++) {
        levels[i].classList.add('cp-bc-folded');
        levels[i].previousElementSibling?.classList.add('cp-bc-folded');   // its arrow
      }
      if (over()) bar.classList.add('cp-bc-squeeze');
    } finally { building = wasBuilding; }
  }

  // The "…" list: the folded levels, each pressing CommPilot's own link.
  let menu = null, moreTrigger = null;
  function openMore(button) {
    moreTrigger = button;
    const bar = button.closest('.cp-bc');
    const folded = [...bar.querySelectorAll(':scope > a.headerAuthLevelLink.cp-bc-folded')];
    if (!menu?.isConnected) {
      menu = document.createElement('div');
      menu.id = 'cp-bc-more-menu';
      menu.setAttribute('role', 'menu');
      document.body.appendChild(menu);
    }
    menu.replaceChildren(...folded.map(link => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = clean(link.textContent);
      item.addEventListener('click', () => { closeMore(false); link.click(); });
      return item;
    }));
    const r = button.getBoundingClientRect();
    menu.style.setProperty('top', `${Math.round(r.bottom + 8)}px`);
    menu.style.setProperty('left', `${Math.round(r.left)}px`);
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    menu.querySelector('button')?.focus();
  }
  function closeMore(refocus) {
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    const button = document.querySelector('td.headerBar button.cp-bc-more');
    button?.setAttribute('aria-expanded', 'false');
    if (refocus) button?.focus();
    return true;
  }
  let historyMenu = null, historyTrigger = null;
  function closeHistory(refocus = false) {
    if (!historyMenu || historyMenu.hidden) return false;
    historyMenu.hidden = true;
    historyTrigger?.setAttribute('aria-expanded', 'false');
    if (refocus) historyTrigger?.focus();
    return true;
  }
  function openHistory(button) {
    closeMore(false);
    if (historyMenu && !historyMenu.hidden) { closeHistory(); return; }
    let rows = [];
    try { rows = JSON.parse(sessionStorage.getItem('cp-recent-locations') || '[]'); } catch {}
    if (!Array.isArray(rows)) rows = [];
    if (!historyMenu?.isConnected) {
      historyMenu = document.createElement('div');
      historyMenu.id = 'cp-bc-history-menu';
      historyMenu.setAttribute('role', 'menu');
      historyMenu.setAttribute('aria-label', 'Recent locations');
      document.body.appendChild(historyMenu);
    }
    historyMenu.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'cp-history-heading';
    const title = document.createElement('strong');
    title.textContent = 'Recent locations';
    heading.appendChild(title);
    if (rows.length) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'cp-history-clear';
      clear.textContent = 'Clear';
      clear.setAttribute('role', 'menuitem');
      clear.addEventListener('click', () => { window.postMessage({__cpRecentClear:true}, location.origin); closeHistory(true); });
      heading.appendChild(clear);
    }
    historyMenu.appendChild(heading);
    const list = document.createElement('div');
    list.className = 'cp-history-list';
    historyMenu.appendChild(list);
    const helper = globalThis.cpRecentHistory;
    const cell = trailCell();
    const currentPlace = helper?.place({nav:history.state?.cpNav,chain:history.state?.cpRecentChain,extension:cell?.querySelector('span.headerAuthLevel')?.getAttribute('data-cp-extension'),
      context:[...(cell?.querySelectorAll('a.headerAuthLevelLink, span.headerAuthLevel') || [])].map(el=>clean(el.textContent)).join(' › ')});
    const footer = document.createElement('div');
    footer.className = 'cp-history-footer';
    const toggle = document.createElement('label');
    const include = document.createElement('input');
    include.type = 'checkbox';
    include.setAttribute('role', 'menuitemcheckbox');
    include.setAttribute('aria-label', 'Include menu visits');
    try { include.checked = sessionStorage.getItem('cp-recent-show-menus') === 'true'; } catch {}
    toggle.append(include,document.createTextNode('Include menu visits'));
    const hint = document.createElement('span');
    hint.textContent = 'Repeat visits merged';
    footer.append(toggle,hint);
    historyMenu.appendChild(footer);
    function renderGroups() {
      list.replaceChildren();
      include.setAttribute('aria-checked', String(include.checked));
      for (const group of helper?.groups(rows.slice(0,30),currentPlace?.key,include.checked) || []) {
        const section = document.createElement('section');
        section.className = 'cp-history-location';
        section.dataset.placeType = group.type;
        section.dataset.placeKey = group.key;
        section.setAttribute('role','group');
        section.setAttribute('aria-label',`${group.type} ${group.full}`);
        const homeRow = group.rows.find(row=>helper.homeIndex(row) >= 0);
        const heading = document.createElement(homeRow ? 'button' : 'div');
        heading.className = 'cp-history-location-heading';
        if (homeRow) {
          heading.type = 'button';
          heading.setAttribute('role','menuitem');
          heading.setAttribute('aria-label',`Open ${group.type.toLowerCase()} ${group.userName ? group.userName+' · ' : ''}${group.full}`);
          heading.title = `Open ${group.type.toLowerCase()} main area · ${group.full}`;
          heading.addEventListener('click',()=>{
            closeHistory();
            window.postMessage({__cpRecentOpen:homeRow.id,__cpRecentBase:helper.homeIndex(homeRow)},location.origin);
          });
        }
        const symbol = document.createElement('span');
        symbol.className = 'cp-history-symbol';
        symbol.innerHTML = helper.icon(group.type === 'User' ? 'user' : group.type === 'Group' ? 'group' : group.type === 'Device profile' ? 'device' : 'provider');
        symbol.setAttribute('aria-hidden','true');
        const identity = document.createElement('div');
        const name = document.createElement('strong');
        name.className = 'cp-history-location-title';
        name.textContent = group.userName || group.name;
        name.title = group.full;
        if (group.userName) {
          const userId = document.createElement('span');
          userId.className = 'cp-history-location-id';
          userId.textContent = group.full;
          identity.append(name,userId);
        } else identity.appendChild(name);
        const meta = document.createElement('span');
        meta.className = 'cp-history-location-meta';
        const extension = group.extension || (group.key === currentPlace?.key ? currentPlace.extension : '');
        meta.textContent = [group.type,group.parent,extension ? 'ext '+extension : ''].filter(Boolean).join(' · ');
        identity.appendChild(meta);
        heading.append(symbol,identity);
        section.appendChild(heading);
        const pages = document.createElement('div');
        pages.className = 'cp-history-pages';
        for (const row of group.rows) {
          if (typeof row.label !== 'string') continue;
          const item = document.createElement('button');
          item.type = 'button';
          item.setAttribute('role', 'menuitem');
          item.dataset.recentId = row.id;
          const glyph = document.createElement('span');
          glyph.className = 'cp-history-page-icon';
          glyph.innerHTML = helper.icon(helper.pageIcon(row));
          const label = document.createElement('strong');
          let text = row.label;
          if (helper.isMenu(row) && !/\bmenu$/i.test(text)) text = /profile|location/i.test(text) ? group.type+' menu' : text+' menu';
          label.textContent = text;
          item.setAttribute('aria-label',`${text} · ${group.type} ${group.full}`);
          item.title = `${text} · ${group.full}`;
          item.append(glyph,label);
          if (Number.isFinite(row.at) && row.at > 0) {
            const time = document.createElement('span');
            time.className = 'cp-history-time';
            const minutes = Math.max(0,Math.floor((Date.now()-row.at)/60000));
            time.textContent = minutes < 1 ? 'Now' : minutes < 60 ? minutes+'m' : minutes < 1440 ? Math.floor(minutes/60)+'h' : Math.floor(minutes/1440)+'d';
            time.setAttribute('aria-hidden','true');
            item.title += '\n'+new Date(row.at).toLocaleString();
            item.appendChild(time);
          }
          item.addEventListener('click', () => { closeHistory(); window.postMessage({__cpRecentOpen:row.id}, location.origin); });
          pages.appendChild(item);
        }
        section.appendChild(pages);
        list.appendChild(section);
      }
      if (!list.children.length) {
        const empty = document.createElement('p');
        empty.className = 'cp-history-empty';
        empty.textContent = rows.length ? 'No recent pages yet. Include menu visits to see your menu history.' : 'Pages you visit will appear here.';
        list.appendChild(empty);
      }
    }
    include.addEventListener('change',()=>{try {sessionStorage.setItem('cp-recent-show-menus',String(include.checked));}catch{} renderGroups();});
    renderGroups();
    historyTrigger = button;
    historyMenu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const r = button.getBoundingClientRect();
    historyMenu.style.top = `${Math.round(r.bottom + 8)}px`;
    historyMenu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - historyMenu.offsetWidth - 8))}px`;
    historyMenu.style.maxHeight = `${Math.max(120, innerHeight - r.bottom - 20)}px`;
    (list.querySelector('button') || include).focus();
  }
  document.addEventListener('click', event => {
    const history = event.target.closest?.('td.headerBar button.cp-bc-history');
    if (history) { openHistory(history); return; }
    if (!event.target.closest?.('#cp-bc-history-menu')) closeHistory();
    const more = event.target.closest?.('td.headerBar button.cp-bc-more');
    if (more) { if (menu && !menu.hidden) closeMore(false); else openMore(more); }
    else if (!event.target.closest?.('#cp-bc-more-menu')) closeMore(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { if (closeHistory(true) || closeMore(true)) event.preventDefault(); return; }
    if (event.key === 'Enter' && event.target.matches?.('td.headerBar .cp-bc a.headerAuthLevelLink[role="link"]:not([href])')) {
      event.preventDefault();
      event.target.click();   // runs CommPilot's own click, as a pointer does
      return;
    }
    if (event.target.closest?.('button.cp-bc-history') && event.key === 'ArrowDown') { event.preventDefault(); openHistory(event.target.closest('button')); return; }
    if (!historyMenu || historyMenu.hidden || !historyMenu.contains(event.target)) return;
    const items = [...historyMenu.querySelectorAll('button, input[type="checkbox"]')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (next >= 0 && items[next]) {event.preventDefault(); items[next].focus();}
    if (event.key === 'Tab') closeHistory();
  });
  let fitQueued = false;
  window.addEventListener('resize', () => {
    closeMore(false);
    closeHistory();
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      const cell = trailCell(), bar = cell?.querySelector(':scope > .cp-bc');
      if (active() && bar) fit(bar, cell);
    });
  }, { passive: true });

  // Attached elements ride on the entity pill, or on a board without one (a group's, a reseller's) on the last pill.
  function attach(items, attached) {
    let at = items.find(el => el.matches('span.headerAuthLevel')) || items[items.length - 1];
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
      // CommPilot's level links have no href, so the keyboard would skip them; Enter presses them (keydown below).
      // A board's menu pill is pjax.js's own button.
      if (el.matches('a.headerAuthLevelLink:not([href]):not([data-cp-crumb-menu])')) { el.tabIndex = 0; el.setAttribute('role', 'link'); }
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
    if (building) return;
    queueWatch();
  });
  function queueWatch() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; watch(); });
  }
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
  // A board section landing is announced as cp:reskin too. A list closes only when the trail that opened it was
  // replaced (the next page), so it stays usable while a board fills in.
  for (const name of ['cp:reskin', 'cp:morphed', 'cp:theme-change']) document.addEventListener(name, () => {
    if (name === 'cp:theme-change' || !historyTrigger?.isConnected) closeHistory();
    if (!moreTrigger?.isConnected) closeMore(false);
    queueWatch();
  });
  document.dispatchEvent(new Event('cp:recent-record'));
})();
