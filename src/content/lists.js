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
  const num = n => n.toLocaleString();   // 2,600 (a swept list runs to thousands)
  const pagers = new WeakMap();   // results table -> { el, start }
  // A list of thousands (pjax.js's Load all) comes with only its first page in the page; the other rows wait
  // outside it, in a <template class="cp-rows-held"> inside the table, as the alpha's grid kept its rows as data.
  // They are taken from there once, and from then on the page holds only the rows on screen: a page turn swaps
  // them, a sort reorders the list here. Thousands of rows in the page, even hidden, slow everything on it.
  const held = new WeakMap();     // results table -> all its rows, in the order shown
  const rowsOf = table => held.get(table) || [...table.querySelectorAll(ROWS)];
  const rowBody = table => table.querySelector(':scope > tbody > tr:has(> td.listHeader)')?.parentNode || table.tBodies[0];
  function takeHeld(table) {
    const box = table.querySelector(':scope > template.cp-rows-held');
    if (!box) return;
    held.set(table, [...table.querySelectorAll(ROWS), ...[...box.content.children].filter(tr => tr.localName === 'tr')]);
    box.remove();
  }
  // A held list this page does not page (not its only list) shows every row after all, in order.
  function releaseHeld(table) {
    const rows = held.get(table);
    if (!rows) return;
    held.delete(table);
    const every = document.createDocumentFragment();
    for (const tr of rows) every.appendChild(tr);
    rowBody(table).appendChild(every);
  }
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
    for (const tr of rowsOf(table)) {
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
    const rows = rowsOf(table);
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

  const ICONS = {
    first: '<path d="m11 17-5-5 5-5"/><path d="m18 17-5-5 5-5"/>',
    prev: '<path d="m15 18-6-6 6-6"/>',
    next: '<path d="m9 18 6-6-6-6"/>',
    last: '<path d="m6 17 5-5-5-5"/><path d="m13 17 5-5-5-5"/>',
  };
  const LABELS = { first: 'First page', prev: 'Previous page', next: 'Next page', last: 'Last page' };
  const pagerButton = go => `<button type="button" class="cp-pager-btn" data-go="${go}" aria-label="${LABELS[go]}" title="${LABELS[go]}">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[go]}</svg></button>`;

  // Count on the left, the page selector centered, an empty right column to keep it centered.
  function makePager() {
    const el = document.createElement('div');
    el.className = 'cp-pager';
    el.setAttribute('role', 'navigation');
    el.setAttribute('aria-label', 'Result pages');
    el.innerHTML = '<span class="cp-pager-count" aria-live="polite"><span class="cp-pager-spinner" aria-hidden="true"></span>' +
      '<span class="cp-pager-text"></span></span><span class="cp-pager-nav">' + pagerButton('first') + pagerButton('prev') +
      '<span class="cp-pager-page"></span>' + pagerButton('next') + pagerButton('last') + '</span><span class="cp-pager-end"></span>';
    return el;
  }

  // Sorting. With the whole list here, a click on a column header sorts it in place: no second search.
  // CommPilot's own header arrow (hidden, read by the bulk tools) keeps describing CommPilot's sort; the
  // header shows its own chevron for the order on screen.
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function nativeSort(table) {
    const arrow = table.querySelector('a.listSortHeader img[src*="uparrow.gif"], a.listSortHeader img[src*="downarrow.gif"]');
    const cell = arrow?.closest('td');
    if (!cell) return null;
    return { index: [...cell.parentElement.children].indexOf(cell), dir: /uparrow/.test(arrow.getAttribute('src')) ? 1 : -1 };
  }
  const sortKeys = new WeakMap();   // held list -> column -> row -> its text (a held list's rows do not change)
  function sortRows(table, sort) {
    const all = held.get(table);
    const rows = all || [...table.querySelectorAll(ROWS)];
    if (!rows.length) return;
    let known = null;
    if (all) {
      const columns = sortKeys.get(table) || new Map();
      sortKeys.set(table, columns);
      known = columns.get(sort.index) || new Map();
      columns.set(sort.index, known);
    }
    const key = tr => {
      if (known?.has(tr)) return known.get(tr);
      const td = tr.children[sort.index];
      const k = td ? textOf(td) || (td.querySelector('img') ? '✓' : '') : '';
      known?.set(tr, k);
      return k;
    };
    const sorted = rows.map((tr, i) => ({ tr, i, k: key(tr) }))
      .sort((a, b) => (a.k === '') - (b.k === '') || sort.dir * collator.compare(a.k, b.k) || a.i - b.i);
    if (all) { sorted.forEach(({ tr }, i) => { all[i] = tr; }); return; }   // render() puts the page's rows in
    const body = rows[rows.length - 1].parentNode, after = rows[rows.length - 1].nextSibling;
    // Rows already in place stay; the rest go back in one move (a swept list runs to thousands). They come out
    // from the end first: Firefox takes a row from the middle of thousands slowly, the last one at once.
    const from = sorted.findIndex(({ tr }, i) => tr !== rows[i]);
    if (from < 0) return;
    for (let i = rows.length - 1; i >= from; i--) rows[i].remove();
    const moving = document.createDocumentFragment();
    for (const { tr } of sorted.slice(from)) moving.appendChild(tr);
    body.insertBefore(moving, after);
  }
  function showSort(table, sort) {
    const head = table.querySelector(':scope > tbody > tr:has(> td.listHeader)');
    table.classList.add('cp-client-sorted');
    table.querySelectorAll('.cp-sort-client').forEach(mark => mark.remove());
    head?.querySelectorAll('td[aria-sort]').forEach(td => td.removeAttribute('aria-sort'));
    const cell = head?.children[sort.index];
    const link = cell?.querySelector('a.listSortHeader');
    if (!link) return;
    cell.setAttribute('aria-sort', sort.dir > 0 ? 'ascending' : 'descending');
    const mark = document.createElement('span');
    mark.className = 'cp-sort-ico cp-sort-client';
    mark.setAttribute('aria-hidden', 'true');
    const url = globalThis.chrome?.runtime?.getURL?.(`assets/icons/sort-${sort.dir > 0 ? 'asc' : 'desc'}.svg`);
    if (url) mark.style.setProperty('--cp-sort-icon', `url("${url}")`);
    link.appendChild(mark);
  }
  // The sort chosen for a list is kept for this tab's session, so Back from a row finds the list in the same
  // order. It is matched by page and column name.
  const SORT_KEY = 'cp-list-sort';
  const listPath = () => document.documentElement.getAttribute('data-cp-path') || location.pathname;
  const columnName = (table, index) =>
    textOf(table.querySelector(':scope > tbody > tr:has(> td.listHeader)')?.children[index] || document.createElement('td'));
  function rememberSort(table, sort) {
    try { sessionStorage.setItem(SORT_KEY, JSON.stringify({ path: listPath(), column: columnName(table, sort.index), dir: sort.dir })); } catch (e) {}
  }
  function rememberedSort(table) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SORT_KEY) || 'null');
      if (!saved || saved.path !== listPath() || !saved.column) return null;
      const cells = [...(table.querySelector(':scope > tbody > tr:has(> td.listHeader)')?.children || [])];
      const index = cells.findIndex(td => textOf(td) === saved.column && td.querySelector('a.listSortHeader'));
      return index < 0 ? null : { index, dir: saved.dir === -1 ? -1 : 1, client: true };
    } catch (e) { return null; }
  }

  function sortClick(event) {
    const link = event.target.closest?.('a.listSortHeader');
    const table = link?.closest('table');
    const state = table && pagers.get(table);
    if (!state) return;                       // CommPilot's own paging: CommPilot sorts
    event.preventDefault();
    event.stopImmediatePropagation();         // before CommPilot's doSort() on the link itself
    const cell = link.closest('td');
    const index = [...cell.parentElement.children].indexOf(cell);
    const current = state.sort || nativeSort(table);
    state.sort = { index, dir: current && current.index === index ? -current.dir : 1, client: true };
    sortRows(table, state.sort);
    showSort(table, state.sort);
    rememberSort(table, state.sort);
    state.start = 0;
    render(content(), table);
  }

  // Rows that fit between the first row's top and the window's bottom, leaving room for everything that follows
  // the list (pager, card edge, a Find line, the page's bottom gutter), so the page does not scroll. A list
  // further down a long form keeps CommPilot's 20.
  function fit(cell, shown) {
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

  // A full page of rows leaves less than a row of space under the list. Spread it over the rows (under a pixel
  // or two each) so the card reaches the bottom of the window with the pager right under the last row. It goes on
  // the rows on screen (their cells inherit it), not on the table: there it would restyle every row of the list,
  // thousands for a swept one, on each page turn.
  function clearFill(state) {
    for (const tr of state.filled || []) tr.style.removeProperty('--cp-row-fill');
    state.filled = [];
  }
  function fillRows(cell, state, shown) {
    const count = shown.length;
    const box = cell.getBoundingClientRect();
    const end = Math.max(...[...cell.children].map(el => {
      const r = el.getBoundingClientRect();
      return r.bottom + (parseFloat(getComputedStyle(el).marginBottom) || 0);
    }));
    const spare = box.bottom - (parseFloat(getComputedStyle(cell).paddingBottom) || 0) - end;
    if (spare <= 0 || count < 8) return;
    const fill = `${Math.min(4, spare / count / 2).toFixed(2)}px`;
    for (const tr of shown) tr.style.setProperty('--cp-row-fill', fill);
    state.filled = shown;
    if (cell.scrollHeight > cell.clientHeight) clearFill(state);   // never into a scroll
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
        const go = event.target.closest('[data-go]')?.dataset.go;
        if (!go || !state.perPage) return;
        const total = rowsOf(table).length;
        const lastStart = Math.max(0, Math.floor((total - 1) / state.perPage) * state.perPage);
        state.start = go === 'first' ? 0 : go === 'last' ? lastStart :
          Math.min(lastStart, Math.max(0, state.start + (go === 'next' ? 1 : -1) * state.perPage));
        render(cell, table);
      });
      table.addEventListener('click', sortClick, true);
      state.sort = rememberedSort(table);
      if (state.sort) showSort(table, state.sort);
    }
    // Rows that arrived after a sort on screen take their place in it.
    if (state.sort?.client) sortRows(table, state.sort);
    if (!state.el.isConnected) (native || table).after(state.el);
    native?.classList.add('cp-pager-native');
    render(cell, table);
  }

  function render(cell, table) {
    const state = pagers.get(table);
    if (!state) return;
    const all = held.get(table);
    const rows = all || [...table.querySelectorAll(ROWS)];
    // Only the rows that change place are touched: the page's rows and the ones it replaces. The first time, and
    // when rows came or went, every row is set. A held list swaps the page's rows in and the others out.
    const show = (from, count) => {
      const next = rows.slice(from, from + count);
      if (all) {
        const keep = new Set(next);
        for (const tr of state.shown || table.querySelectorAll(ROWS)) if (!keep.has(tr)) tr.remove();
        const page = document.createDocumentFragment();
        for (const tr of next) { tr.style.removeProperty('--cp-row-fill'); page.appendChild(tr); }
        rowBody(table).appendChild(page);
      } else if (state.shown && state.rowCount === rows.length) {
        for (const tr of state.shown) if (!next.includes(tr)) tr.classList.add('cp-row-off');
      } else {
        rows.forEach((tr, i) => tr.classList.toggle('cp-row-off', i < from || i >= from + count));
      }
      table.querySelectorAll(':scope > tbody > tr.cp-row-end').forEach(tr => tr.classList.remove('cp-row-end'));
      next.forEach((tr, i) => { tr.classList.remove('cp-row-off'); tr.classList.toggle('cp-row-end', i === next.length - 1); });
      state.shown = next;
      state.rowCount = rows.length;
    };
    // Measure with a full page of CommPilot's size showing, then show what fits.
    clearFill(state);
    if (!state.perPage) show(0, DEFAULT_PAGE);
    let perPage = fit(cell, state.shown);
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
    // Only a page that is full: the last, shorter page keeps its natural rows.
    if (pages > 1 && current < pages - 1 && perPage !== DEFAULT_PAGE) fillRows(cell, state, rows.slice(state.start, state.start + perPage));
    // While pjax.js fetches the rest, the pager says so and nothing else changes; the totals appear once.
    const loading = table.dataset.cpFill === 'loading';
    state.el.classList.toggle('cp-pager-loading', loading);
    const last = Math.min(rows.length, state.start + perPage);
    state.el.querySelector('.cp-pager-text').textContent = loading ? 'Loading more results' :
      rows.length === 1 ? '1 result' : pages === 1 ? `${num(rows.length)} results` : `${num(state.start + 1)}–${num(last)} of ${num(rows.length)}`;
    const nav = state.el.querySelector('.cp-pager-nav');
    nav.hidden = pages === 1 && !loading;
    nav.querySelector('.cp-pager-page').textContent = loading ? `Page ${num(current + 1)}` : `Page ${num(current + 1)} of ${num(pages)}`;
    for (const go of ['first', 'prev']) nav.querySelector(`[data-go="${go}"]`).disabled = current === 0;
    nav.querySelector('[data-go="next"]').disabled = current >= pages - 1;
    nav.querySelector('[data-go="last"]').disabled = current >= pages - 1 || loading;   // the end is not known yet
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
      try {
        takeHeld(table);
        if (tables.length !== 1) releaseHeld(table);
        wireRows(table); editColumn(table);
      } catch (error) { console.warn('[CommPilot lists] rows', error); }
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
