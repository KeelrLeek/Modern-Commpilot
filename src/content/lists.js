/* CommPilot 2.0 result lists. A list fills the window: it shows as many rows as fit, with a pager for the rest,
   and the page size follows the window as it is resized. pjax.js fetches the list's other CommPilot pages into
   the same table (cpListFill, table[data-cp-fill]); until it has, the first page is paged, and if it cannot,
   CommPilot's own pager comes back. A click anywhere on a row opens it: the row's own link is clicked, so
   CommPilot's handler does the navigation. The Edit column goes where it only repeats the row's link. */
(() => {
  if (window !== window.top) return;

  const active = () => Boolean(document.documentElement.dataset.cpDirection) &&
    document.body?.id === 'initBody.menuTemplate';
  const content = () => document.querySelector('td[width="82%"]');
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  // A cell's visible text: CommPilot puts each link's wiring <script> inside the cell.
  const textOf = el => {
    let text = '';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT,
      { acceptNode: node => node.parentElement?.closest('script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    while (walker.nextNode()) text += walker.currentNode.textContent;
    return clean(text);
  };
  const ROWS = ':scope > tbody > tr[id^="Row"]';
  const pagers = new WeakMap();   // results table -> { el, start }
  const DEFAULT_PAGE = 20;        // CommPilot's own page size, for lists that are not the page's main content

  function resultTables(cell) {
    return [...cell.querySelectorAll('table')].filter(table => !table.closest('.cp-console') &&
      table.querySelector(ROWS) && table.querySelector(':scope > tbody > tr > td.listHeader'));
  }

  // How many different places a row's links lead: its scripts' redirectPost calls (rows pjax.js added carry
  // theirs as data-cp-drill).
  function targets(tr) {
    if (tr.dataset.cpDrill) return 1;
    const posts = new Set();
    for (const m of tr.innerHTML.matchAll(/redirectPost\s*\(\s*(['"])(.*?)\1\s*,\s*(\{[\s\S]*?\})\s*\)/g))
      posts.add(m[2] + m[3].replace(/\s+/g, ''));
    return posts.size;
  }
  const rowLink = tr => tr.querySelector('a.tableLink') || tr.querySelector('a.headerLink');

  function wireRows(table) {
    for (const tr of table.querySelectorAll(ROWS)) {
      if (tr.dataset.cpRowWired) continue;
      tr.dataset.cpRowWired = '1';
      if (rowLink(tr) && targets(tr) === 1) { tr.classList.add('cp-row-link'); tr.tabIndex = 0; }
    }
    if (table.dataset.cpRowsBound) return;
    table.dataset.cpRowsBound = '1';
    table.addEventListener('click', event => {
      const tr = event.target.closest('tr.cp-row-link');
      if (!tr || !table.contains(tr) || event.target.closest('a, input, select, textarea, button, label')) return;
      if (clean(getSelection?.().toString())) return;   // selecting text, not opening the row
      rowLink(tr)?.click();
    });
    table.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.matches?.('tr.cp-row-link')) {
        event.preventDefault();
        rowLink(event.target)?.click();
      }
    });
  }

  // The Edit column goes only when, on every row, it is empty or a lone Edit link and the row itself opens the
  // same page.
  function editColumn(table) {
    const head = table.querySelector(':scope > tbody > tr:has(> td.listHeader)');
    if (!head) return;
    const cells = [...head.children];
    const index = cells.findIndex(td => textOf(td) === 'Edit');
    if (index < 0) return;
    const rows = [...table.querySelectorAll(ROWS)];
    const ok = rows.every(tr => {
      if (tr.children.length !== cells.length) return false;
      const cell = tr.children[index];
      const links = cell.querySelectorAll('a');
      if (!links.length) return !textOf(cell) && !cell.querySelector('input, select, button');
      return links.length === 1 && textOf(links[0]) === 'Edit' && textOf(cell) === 'Edit' &&
        tr.classList.contains('cp-row-link');
    });
    if (!ok) return;
    const spacer = td => td && !textOf(td) && !td.querySelector('a, input, select, button');
    const drop = [index];
    if (index > 0 && spacer(cells[index - 1]) && rows.every(tr => spacer(tr.children[index - 1]))) drop.push(index - 1);
    for (const tr of [head, ...rows]) for (const i of drop) tr.children[i]?.classList.add('cp-col-edit');
  }

  function nativePager(table) {
    return [...(table.parentElement?.children || [])].find(el => el !== table && el.tagName === 'TABLE' &&
      !el.querySelector('table') && /Page\s+\d+\s+of\s+\d+/i.test(el.textContent));
  }

  function makePager() {
    const el = document.createElement('div');
    el.className = 'cp-pager';
    el.setAttribute('role', 'navigation');
    el.setAttribute('aria-label', 'Result pages');
    el.innerHTML = '<span class="cp-pager-count" aria-live="polite"></span><span class="cp-pager-nav">' +
      '<span class="cp-pager-spinner" aria-hidden="true"></span>' +
      '<button type="button" class="cp-pager-btn" data-go="-1" aria-label="Previous page">‹</button>' +
      '<span class="cp-pager-page"></span>' +
      '<button type="button" class="cp-pager-btn" data-go="1" aria-label="Next page">›</button></span>';
    return el;
  }

  // Rows that fit between the first row's top and the window's bottom, leaving room for everything that follows
  // the list (pager, card edge, a Find line, the page's bottom gutter), so the page does not scroll. A list
  // further down a long form keeps CommPilot's 20.
  function fit(cell, table) {
    const shown = [...table.querySelectorAll(ROWS)].filter(tr => !tr.classList.contains('cp-row-off'));
    if (!shown.length) return DEFAULT_PAGE;
    const box = cell.getBoundingClientRect();
    const at = y => y - box.top + cell.scrollTop;
    const first = shown[0].getBoundingClientRect(), last = shown[shown.length - 1].getBoundingClientRect();
    const rowHeight = (last.bottom - first.top) / shown.length || 30;
    // What follows the rows: the content's real bottom (not the empty window below it) plus the cell's padding.
    const end = Math.max(...[...cell.children].map(el => at(el.getBoundingClientRect().bottom)));
    const below = Math.max(0, end + (parseFloat(getComputedStyle(cell).paddingBottom) || 0) - at(last.bottom));
    const room = cell.clientHeight - at(first.top) - below;
    const rows = Math.floor(room / rowHeight);
    return rows >= 8 ? rows : DEFAULT_PAGE;
  }

  function page(cell, table) {
    const fill = table.dataset.cpFill;
    const native = nativePager(table);
    const nativeState = native && /Page\s+(\d+)\s+of\s+(\d+)/i.exec(native.textContent);
    // CommPilot's own pager stays for a list whose other pages are not all here: pjax.js could not fetch them,
    // or it does not (too many pages, a page that is not page 1).
    const whole = fill === 'done' || fill === 'loading' || !nativeState || nativeState[2] === '1';
    let state = pagers.get(table);
    if (!whole) {
      if (state) { state.el.remove(); pagers.delete(table); }
      native?.classList.remove('cp-pager-native');
      table.querySelectorAll('tr.cp-row-off, tr.cp-row-end').forEach(tr => tr.classList.remove('cp-row-off', 'cp-row-end'));
      return;
    }
    if (!state) {
      state = { el: makePager(), start: 0, perPage: 0 };
      pagers.set(table, state);
      state.el.addEventListener('click', event => {
        const go = Number(event.target.closest('[data-go]')?.dataset.go || 0);
        if (!go) return;
        state.start = Math.max(0, state.start + go * state.perPage);
        render(cell, table);
      });
    }
    if (!state.el.isConnected) (native || table).after(state.el);
    native?.classList.add('cp-pager-native');
    render(cell, table);
  }

  function render(cell, table) {
    const state = pagers.get(table);
    if (!state) return;
    const rows = [...table.querySelectorAll(ROWS)];
    const show = (from, count) => rows.forEach((tr, i) => {
      tr.classList.toggle('cp-row-off', i < from || i >= from + count);
      tr.classList.toggle('cp-row-end', i === Math.min(rows.length, from + count) - 1);
    });
    // Measure with a full page of CommPilot's size showing, then show what fits.
    if (!state.perPage) show(0, DEFAULT_PAGE);
    let perPage = fit(cell, table);
    let pages = Math.max(1, Math.ceil(rows.length / perPage));
    let current = Math.min(pages - 1, Math.floor(state.start / perPage));
    show(current * perPage, perPage);
    // Margins the measure cannot see (a quirks-mode form's bottom margin) can still push the page into a
    // scroll; take off the rows that overflow.
    const overflow = cell.scrollHeight - cell.clientHeight;
    const shownRow = rows[current * perPage];
    if (overflow > 0 && perPage !== DEFAULT_PAGE && shownRow) {
      perPage = Math.max(8, perPage - Math.ceil(overflow / (shownRow.getBoundingClientRect().height || 30)));
      pages = Math.max(1, Math.ceil(rows.length / perPage));
      current = Math.min(pages - 1, Math.floor(state.start / perPage));
      show(current * perPage, perPage);
    }
    state.perPage = perPage;
    state.start = current * perPage;
    freezeColumns(table, state);
    // While pjax.js fetches the rest, the pager says so and nothing else changes; the totals appear once.
    const loading = table.dataset.cpFill === 'loading';
    state.el.classList.toggle('cp-pager-loading', loading);
    const last = Math.min(rows.length, state.start + perPage);
    const count = state.el.querySelector('.cp-pager-count');
    count.textContent = loading ? 'Loading more results' : rows.length === 1 ? '1 result' :
      pages === 1 ? `${rows.length} results` : `${state.start + 1}–${last} of ${rows.length}`;
    const nav = state.el.querySelector('.cp-pager-nav');
    nav.hidden = pages === 1 && !loading;
    nav.querySelector('.cp-pager-page').textContent = loading ? `Page ${current + 1}` : `Page ${current + 1} of ${pages}`;
    nav.querySelector('[data-go="-1"]').disabled = current === 0;
    nav.querySelector('[data-go="1"]').disabled = current >= pages - 1;
  }

  // Column widths come from the first page shown and stay put (as shares of the table, so they still follow
  // the window): rows arriving from CommPilot's other pages, and paging through them, never move a column.
  function freezeColumns(table, state) {
    if (state.frozen) return;
    const head = table.querySelector(':scope > tbody > tr:has(> td.listHeader)');
    const total = table.getBoundingClientRect().width;
    if (!head || !total) return;
    const cells = [...head.children].filter(td => getComputedStyle(td).display !== 'none');
    const widths = cells.map(td => td.getBoundingClientRect().width / total * 100);
    cells.forEach((td, i) => { td.style.width = `${widths[i].toFixed(3)}%`; });
    table.classList.add('cp-cols-frozen');
    state.frozen = true;
  }

  let observed = null;
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => requestAnimationFrame(refit)) : null;
  function refit() {
    const cell = content();
    if (!cell) return;
    for (const table of resultTables(cell)) if (pagers.has(table)) render(cell, table);
  }

  function apply() {
    if (!active()) return;
    const cell = content();
    if (!cell || cell.querySelector(':scope > .cp-console')) return;
    const tables = resultTables(cell);
    for (const table of tables) {
      try { wireRows(table); editColumn(table); } catch (error) { console.warn('[CommPilot lists] rows', error); }
    }
    // Only a page's one list is paged to the window; pages with several lists keep CommPilot's paging.
    if (tables.length === 1) {
      try { page(cell, tables[0]); } catch (error) { console.warn('[CommPilot lists] pager', error); }
    }
    if (observer && observed !== cell) { observer.disconnect(); observer.observe(cell); observed = cell; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  // Same frame as forms.js (registered first), so a new page paints once, already in its final form.
  document.addEventListener('cp:reskin', () => requestAnimationFrame(apply));
  document.addEventListener('cp:list-fill', () => requestAnimationFrame(apply));
  document.addEventListener('cp:theme-change', () => requestAnimationFrame(apply));
  document.fonts?.ready.then(() => requestAnimationFrame(refit));
})();
