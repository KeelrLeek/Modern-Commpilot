/* CommPilot 2.0 result lists. A list fills the window: it shows as many rows as fit, with a pager for the rest,
   and the page size follows the window as it is resized. pjax.js fetches the list's other CommPilot pages into
   the same table (cpListFill, table[data-cp-fill]); the completed list is formatted before revealing it. If collection
   fails, CommPilot's own page and pager come back. A click anywhere on a row opens it: the row's own link is clicked, so
   CommPilot's handler does the navigation. The Edit column goes where it only repeats the row's link. An Export button saves
   every result of the search, all its pages, as an Excel workbook (pjax.js builds and saves it). */
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
  const headings = new WeakMap(), readyJobs = new WeakMap(), waiters = new WeakMap();
  const searchDesign = table => table.closest('.cp-search-design-a');
  const searchTitle = () => {
    const title=document.querySelector('.cp-frame-title')?.cloneNode(true);
    title?.querySelectorAll('button,.cp-frame-about,script,style').forEach(el=>el.remove());
    return clean(title?.textContent)||'Results';
  };
  const searchFiltered = table => [...searchDesign(table).querySelectorAll('[name^="findValue"]')].some(input=>clean(input.value));
  function searchCaption(table) {
    const label=searchTitle().toLowerCase();
    const filtered=searchFiltered(table);
    const entity=document.querySelector('td.headerBar span.headerAuthLevel')?.cloneNode(true);
    entity?.querySelectorAll('button,.cp-bc-attach,script').forEach(el=>el.remove());
    const place=entity&&clean(entity.textContent);
    return `${filtered?'Matching':'All'} ${label}${place?' in '+place:''}`;
  }
  function markSearchColumns(table) {
    if(!searchDesign(table))return;
    const head=table.querySelector(':scope > tbody > tr:has(> td.listHeader)');
    if(!head)return;
    [...head.children].forEach((cell,index)=>{
      const name=textOf(cell).toLowerCase().replace(/[^a-z]/g,'');
      const spacer=!name&&cell.querySelector('img[width="0"],img[width="20"]');
      const role=spacer?'spacer':name==='userid'?'user-id':name==='activated'?'activated':'';
      if(!role)return;
      cell.dataset.cpColumn=role;
      for(const row of rowsOf(table))if(row.children[index])row.children[index].dataset.cpColumn=role;
    });
  }
  function resultHeading(table,complete) {
    if(!content()?.querySelector('.cp-searchbar-wrap'))return null;
    let heading=headings.get(table);
    if(!heading){
      heading=document.createElement('div');heading.className='cp-results-heading';
      const count=document.createElement('span');count.className='cp-results-total';
      const summary=document.createElement('span');summary.className='cp-results-summary';
      const caption=document.createElement('span');caption.className='cp-results-caption';
      const tools=document.createElement('span');tools.className='cp-results-tools';
      if(searchDesign(table)){
        const all=document.createElement('button');all.type='button';all.className='cp-results-show-all';
        all.textContent='Show all '+searchTitle().toLowerCase();
        all.addEventListener('click',()=>searchDesign(table)?.querySelector('.cp-searchbar-reset')?.click());tools.appendChild(all);
      }
      summary.append(count,caption);heading.append(summary,tools);table.before(heading);headings.set(table,heading);
    }
    const total=rowsOf(table).length;
    heading.querySelector('.cp-results-total').textContent=complete?`${num(total)} ${total===1?'result':'results'}`:`${num(total)} results on this page`;
    if(searchDesign(table)){
      heading.querySelector('.cp-results-caption').textContent=searchCaption(table);
      heading.querySelector('.cp-results-show-all').hidden=!searchFiltered(table);
    }
    return heading.querySelector('.cp-results-tools');
  }
  function waiting(table) {
    table.dataset.cpResultsReady='false';
    table.setAttribute('aria-busy','true');
    let notice=waiters.get(table);
    if(!notice?.isConnected){
      notice=document.createElement('div');notice.className='cp-list-wait';notice.setAttribute('role','status');
      const text=document.createElement('span');text.textContent='Loading results…';notice.appendChild(text);(headings.get(table)||table).before(notice);waiters.set(table,notice);
    }
    if(headings.get(table)) headings.get(table).hidden=true;
  }
  function ready(table) {
    table.dataset.cpResultsReady='true';
    table.setAttribute('aria-busy','false');
    waiters.get(table)?.remove();
    if(headings.get(table))headings.get(table).hidden=false;
  }
  function cancelTurn(state) {
    state.turn=(state.turn||0)+1;
    for(const animation of state.animations||[])animation.cancel();
    state.animations=[];
    state.table.dataset.cpPagePhase='idle';
  }
  async function turnPage(cell,table) {
    const state=pagers.get(table);if(!state)return;
    const opacity=Math.min(.78,Number(getComputedStyle(table).opacity));
    cancelTurn(state);const turn=state.turn;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){render(cell,table);return;}
    // Commit in this task. Controls never move or disappear, and rapid clicks need no exit animation to finish.
    render(cell,table,true);
    table.dataset.cpPagePhase='entering';
    state.animations=[table.animate([{opacity},{opacity:1}],{duration:140,easing:'ease-out'})];
    await Promise.all(state.animations.map(animation=>animation.finished.catch(()=>{})));
    if(state.turn===turn){state.animations=[];table.dataset.cpPagePhase='idle';}
  }
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
    return [...cell.querySelectorAll('table')].filter(table => {
      if(table.closest('.cp-console') || table.matches('.cp-searchbar,.cp-frame-rule,.cp-frame-pager,.cp-pager-native'))return false;
      const headers=[...table.querySelectorAll(':scope > tbody > tr > td.listHeader')];
      // CommPilot draws its bottom rule as a separate table with an empty listHeader cell and a 1px GIF.
      // The class alone does not identify a result list; an empty search still has real column names.
      return headers.some(header=>textOf(header)) && (table.querySelector(ROWS)||cell.querySelector('.cp-searchbar-wrap'));
    });
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
    // Blanks follow populated values ascending and lead them descending, like reversing any other value.
    const sorted = rows.map((tr, i) => ({ tr, i, k: key(tr) }))
      .sort((a, b) => sort.dir * ((a.k === '') - (b.k === '') || collator.compare(a.k, b.k)) || a.i - b.i);
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

  // Export: every row of the search, in the order on screen, with the columns that carry a name (not Edit, not the
  // spacers). With the whole list here (lists.js pages it) the rows go to pjax.js as they are; when CommPilot's own
  // pager stayed (a search of more pages than pjax.js fills), pjax.js walks every page itself. pjax.js runs in the
  // page, so the request and its progress travel as JSON in DOM events.
  const exportButtons = new WeakMap();   // results table -> its Export button
  const EXPORT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
  let exporting = null;                  // { table, button } while pjax.js works
  function exportColumns(table) {
    const head = table.querySelector(':scope > tbody > tr:has(> td.listHeader)');
    return [...(head?.children || [])].map((td, index) => ({ index, name: textOf(td) })).filter(c => c.name && c.name !== 'Edit');
  }
  // A cell as text; a ticked box or CommPilot's check image is "Yes".
  function exportCell(td) {
    if (!td) return '';
    const text = textOf(td);
    if (text) return text;
    const box = td.querySelector('input[type="checkbox"]');
    if (box) return box.checked ? 'Yes' : 'No';
    return td.querySelector('img') ? 'Yes' : '';
  }
  function exportLabel(button, text, busy) {
    button.querySelector('.cp-export-text').textContent = text;
    button.classList.toggle('cp-export-busy', Boolean(busy));
  }
  function startExport(table, button) {
    if (exporting || button.disabled) return;
    const columns = exportColumns(table);
    if (!columns.length) return;
    const native = nativePager(table);
    const at = native && /Page\s+(\d+)\s+of\s+(\d+)/i.exec(native.textContent);
    const whole = pagers.has(table);
    exporting = { table, button };
    exportLabel(button, 'Exporting…', true);
    document.dispatchEvent(new CustomEvent('cp:list-export', { detail: JSON.stringify({
      complete: whole || !at,
      page: at ? +at[1] : 1, pages: at ? +at[2] : 1,
      columns: columns.map(c => c.index), headers: columns.map(c => c.name),
      rows: whole || !at ? rowsOf(table).map(tr => columns.map(c => exportCell(tr.children[c.index]))) : [],
    }) }));
  }
  document.addEventListener('cp:list-export-status', event => {
    if (!exporting) return;
    let status = {};
    try { status = JSON.parse(event.detail); } catch (e) {}
    const { button } = exporting;
    if (status.state === 'working') { exportLabel(button, `Exporting ${num(status.done)} of ${num(status.total)} pages…`, true); return; }
    exporting = null;
    exportLabel(button, status.state === 'done' ? `Exported ${num(status.count)}` : 'Could not export', false);
    button.title = status.state === 'done' ? 'Saved as an Excel workbook' : (status.message || 'Try again in a moment');
    setTimeout(() => { if (!exporting) { exportLabel(button, 'Export', false); button.title = EXPORT_TITLE; } }, 2600);
  });
  const EXPORT_TITLE = 'Save every result of this search, all pages, as an Excel workbook';
  function exportButton(table, slot) {
    let button = exportButtons.get(table);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'cp-export-btn';
      button.title = EXPORT_TITLE;
      button.innerHTML = `${EXPORT_ICON}<span class="cp-export-text">Export</span>`;
      button.addEventListener('click', () => startExport(table, button));
      exportButtons.set(table, button);
    }
    if (button.parentElement !== slot) slot.appendChild(button);
    // While pjax.js is still bringing the list's other pages in, the list is not whole yet.
    button.disabled = table.dataset.cpFill === 'loading';
  }
  // CommPilot's own pager stayed: the button sits on a row of its own under it.
  function nativeExportSlot(table, native) {
    const anchor = native || table;
    let row = anchor.nextElementSibling;
    if (!row?.classList.contains('cp-export-row')) {
      row = document.createElement('div');
      row.className = 'cp-export-row';
      anchor.after(row);
    }
    return row;
  }

  // Rows that fit between the first row's top and the window's bottom, leaving room for everything that follows
  // the list (pager, card edge, a Find line, the page's bottom gutter), so the page does not scroll. A list
  // further down a long form keeps CommPilot's 20.
  function fit(cell, shown, search = false) {
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
    return search ? Math.max(1, rows) : rows >= 8 ? rows : DEFAULT_PAGE;
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
    if (spare <= 0 || count < (searchDesign(state.table) ? 1 : 8)) return;
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
      exportButton(table, resultHeading(table,false)||nativeExportSlot(table,native));
      return;
    }
    if (!state) {
      state = { el: makePager(), table, start: 0, perPage: 0 };
      if(searchDesign(table)){
        const label=document.createElement('label');label.className='cp-page-size';label.append('Rows ');
        const select=document.createElement('select');select.setAttribute('aria-label','Rows per page');
        for(const value of ['10','20','50','auto']){const option=document.createElement('option');option.value=value;option.textContent=value==='auto'?'Auto':value;select.appendChild(option);}
        let saved='auto';try{saved=sessionStorage.getItem('cp-search-page-size')||saved;}catch{}
        select.value=['10','20','50','auto'].includes(saved)?saved:'auto';state.size=select.value;
        select.addEventListener('change',event=>{
          event.stopPropagation();
          state.size=select.value;state.start=0;state.reserveHeight=0;state.perPage=0;
          try{sessionStorage.setItem('cp-search-page-size',state.size);}catch{}
          turnPage(cell,table);
        });
        label.appendChild(select);state.el.querySelector('.cp-pager-end').appendChild(label);
      }
      pagers.set(table, state);
      state.el.addEventListener('click', event => {
        const button=event.target.closest('button[data-go]');
        if(!button)return;
        event.preventDefault();event.stopPropagation();
        const go=button.dataset.go;
        if (button.disabled || !state.perPage || table.dataset.cpResultsReady!=='true') return;
        const total = rowsOf(table).length;
        const lastStart = Math.max(0, Math.floor((total - 1) / state.perPage) * state.perPage);
        state.start = go === 'first' ? 0 : go === 'last' ? lastStart :
          Math.min(lastStart, Math.max(0, state.start + (go === 'next' ? 1 : -1) * state.perPage));
        turnPage(cell,table);
      },true);
      table.addEventListener('click', sortClick, true);
      state.sort = rememberedSort(table);
      if (state.sort) showSort(table, state.sort);
    }
    // Rows that arrived after a sort on screen take their place in it.
    if (state.sort?.client) sortRows(table, state.sort);
    if (!state.el.isConnected) (native || table).after(state.el);
    native?.classList.add('cp-pager-native');
    const exportRow = state.el.nextElementSibling;
    if (exportRow?.classList.contains('cp-export-row')) exportRow.remove();   // the pager has its own place for it now
    exportButton(table, resultHeading(table,true)||state.el.querySelector('.cp-pager-end'));
    render(cell, table);
  }

  function render(cell, table, motion=false) {
    const state = pagers.get(table);
    if (!state) return;
    if(!motion)cancelTurn(state);
    state.spacer?.remove();
    const all = held.get(table);
    const rows = all || [...table.querySelectorAll(ROWS)];
    // Re-measuring a shorter last page can change the fitted row count.
    // Keep Last selected; other pages retain their visible row when resized.
    const selectedPage = state.perPage ? Math.floor(state.start / state.perPage) : 0;
    const selectedLast = state.start > 0 && selectedPage === Math.ceil(rows.length / state.perPage) - 1;
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
    const fixed=state.size&&state.size!=='auto';
    let perPage = fixed?Number(state.size):fit(cell, state.shown, searchDesign(table));
    let pages = Math.max(1, Math.ceil(rows.length / perPage));
    let current = selectedLast ? pages - 1 : Math.min(pages - 1, Math.floor(state.start / perPage));
    show(current * perPage, perPage);
    // Margins the measure cannot see (a quirks-mode form's bottom margin) can still push the page into a
    // scroll; take off the rows that overflow.
    const overflow = cell.scrollHeight - cell.clientHeight;
    const shownRow = rows[current * perPage];
    if (!fixed && overflow > 0 && (perPage !== DEFAULT_PAGE || searchDesign(table)) && shownRow) {
      perPage = Math.max(searchDesign(table)?1:8, perPage - Math.ceil(overflow / (shownRow.getBoundingClientRect().height || 30)));
      pages = Math.max(1, Math.ceil(rows.length / perPage));
      current = selectedLast ? pages - 1 : Math.min(pages - 1, Math.floor(state.start / perPage));
      show(current * perPage, perPage);
    }
    state.perPage = perPage;
    state.start = current * perPage;
    if(table.dataset.cpFill!=='loading')freezeColumns(table, state);
    // Only a page that is full: the last, shorter page keeps its natural rows.
    if (!fixed && pages > 1 && current < pages - 1 && (perPage !== DEFAULT_PAGE || searchDesign(table))) fillRows(cell, state, rows.slice(state.start, state.start + perPage));
    state.reserveHeight=Math.max(state.reserveHeight||0,table.getBoundingClientRect().height);
    if(fixed){
      const head=table.querySelector(':scope > tbody > tr:has(> td.listHeader)');
      state.reserveHeight=Math.max(state.reserveHeight,(head?.getBoundingClientRect().height||0)+perPage*(state.shown[0]?.getBoundingClientRect().height||40));
    }
    if((pages>1&&current===pages-1)||(fixed&&rows.length<perPage)){
      const spare=state.reserveHeight-table.getBoundingClientRect().height;
      if(spare>1){
        const spacer=document.createElement('tr');spacer.className='cp-page-spacer';spacer.setAttribute('aria-hidden','true');
        const space=document.createElement('td');space.colSpan=table.querySelector('tr:has(> td.listHeader)')?.children.length||1;space.style.height=spare+'px';spacer.appendChild(space);rowBody(table).appendChild(spacer);state.spacer=spacer;
      }
    }
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
  function observeResults(cell) {
    if (!observer || observed === cell) return;
    observer.disconnect();
    observed = cell;
    if (cell) observer.observe(cell);
  }
  function refit() {
    if (!active()) return;
    const cell = content();
    if (!cell) return;
    for (const table of resultTables(cell)) if (pagers.has(table) && table.dataset.cpResultsReady!=='false') {pagers.get(table).reserveHeight=0;render(cell, table);}
  }

  let applyFrame = 0;
  function scheduleApply() {
    if (applyFrame) return;
    applyFrame = requestAnimationFrame(() => { applyFrame = 0; apply(); });
  }
  function apply() {
    if (!active()) { observeResults(null); return; }
    const cell = content();
    if (!cell || cell.querySelector(':scope > .cp-console')) { observeResults(null); return; }
    const tables = resultTables(cell);
    // A retained observer target also keeps its detached, potentially large
    // result list alive after navigation. Observe only the current list page.
    observeResults(tables.length ? cell : null);
    for (const table of tables) {
      if(table.dataset.cpResultsReady==='true')continue;
      waiting(table);
      const job={};readyJobs.set(table,job);
      Promise.resolve(document.fonts?.ready).then(()=>requestAnimationFrame(()=>{
        if(!table.isConnected || readyJobs.get(table)!==job)return;
        if(table.dataset.cpFill==='loading'){
          // Prepare the same hidden 10/20/50-row geometry while collecting. The native 20-row page must not
          // make the card twice as tall during loading and then collapse when the completed list is shown.
          if(searchDesign(table)&&tables.length===1&&!pagers.has(table)){markSearchColumns(table);page(cell,table);}
          return;
        }
        try {
          takeHeld(table);if(tables.length!==1)releaseHeld(table);
          wireRows(table);editColumn(table);markSearchColumns(table);
          if(tables.length===1)page(cell,table);
          else exportButton(table,resultHeading(table,true)||nativeExportSlot(table,nativePager(table)));
          ready(table);
          if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
            const animation=table.animate([{opacity:.78},{opacity:1}],{duration:140,easing:'ease-out'});
            const state=pagers.get(table);if(state)state.animations=[animation];
          }
          document.dispatchEvent(new Event('cp:list-ready'));
        }catch(error){console.warn('[CommPilot lists] results',error);ready(table);}
      }));
    }
  }

  document.addEventListener('cp:list-page',event=>{
    let request;try{request=JSON.parse(event.detail);}catch{return;}
    if(!request||typeof request!=='object'||Array.isArray(request))return;
    const cell=content();if(!cell||!Number.isSafeInteger(request.offset)||request.offset<0)return;
    const table=resultTables(cell).find(table=>table.dataset.cpFill==='done'&&table.dataset.cpResultsReady==='true'&&
      table.dataset.cpReturnPage===request.returnPage&&table.dataset.cpTableName===request.tableName);
    const state=table&&pagers.get(table);if(!state?.perPage)return;
    const last=Math.max(0,Math.floor((rowsOf(table).length-1)/state.perPage)*state.perPage);
    state.start=Math.min(last,Math.floor(request.offset/state.perPage)*state.perPage);
    event.preventDefault();turnPage(cell,table);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  // Same frame as forms.js (registered first), so a new page paints once, already in its final form.
  document.addEventListener('cp:reskin', () => {for(const table of resultTables(content()||document.createElement('div')))if(table.dataset.cpResultsReady!=='true')waiting(table);scheduleApply();});
  document.addEventListener('cp:list-fill', () => {for(const table of resultTables(content()||document.createElement('div')))waiting(table);scheduleApply();});
  document.addEventListener('cp:theme-change', scheduleApply);
  document.fonts?.ready.then(() => requestAnimationFrame(refit));
})();
