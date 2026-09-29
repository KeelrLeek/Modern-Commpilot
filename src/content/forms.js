/* CommPilot 2.0 form layouts. Each transform recognizes one native CommPilot pattern exactly and leaves any
   page it does not recognize alone. CommPilot's own controls stay in the form and remain the source of truth:
   the new layout either moves the real inputs or drives them with real clicks, so OK / Apply, CommPilot's own
   scripts, and PJAX saves behave as before. Re-applied after every in-page navigation (cp:reskin). */
(() => {
  if (window !== window.top) return;

  const active = () => Boolean(document.documentElement.dataset.cpDirection) &&
    document.body?.id === 'initBody.menuTemplate';
  const content = () => document.querySelector('td[width="82%"]');
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();   // \s includes the non-breaking space

  /* ---- List search criteria: one toolbar line (mockup pick C) ---------------------------------------- */
  function searchBar(cell) {
    const search = cell.querySelector('#search0');
    const table = search?.closest('table');
    if (!table || table.classList.contains('cp-searchbar') || !table.querySelector('tr#tr0 [name^="findValue"]')) return;
    table.classList.add('cp-searchbar');
    const wrap = make('div', 'cp-searchbar-wrap');
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    // CommPilot's "+" (in the last criteria row) keeps its own addRow logic; this button just presses it.
    const add = make('button', 'cp-searchbar-add', '+ Add criteria');
    add.type = 'button';
    const plus = () => [...table.querySelectorAll('input[type="button"]')].filter(b => b.value.trim() === '+').pop();
    add.addEventListener('click', () => { plus()?.click(); add.hidden = !plus(); });
    add.hidden = !plus();
    wrap.appendChild(add);
  }

  /* ---- Small settings forms: settings rows (mockup pick B) ------------------------------------------- */
  // A settings form is CommPilot's end-user layout: rows of [label cell][control cell] inside
  // td.enduserbody > table.enduserbody > … > td[width=100%] > table.
  function readSettings(cell) {
    const outers = cell.querySelectorAll('td.enduserbody > table.enduserbody');
    if (outers.length !== 1) return null;
    const form = cell.querySelector('form[name="mainForm"]');
    if (!form || form.querySelector('input[type="password"], input[type="file"], fieldset')) return null;
    const host = outers[0].querySelector(':scope > tbody > tr > td[width="100%"] > table');
    if (!host || host.querySelector('table')) return null;
    const rows = [];
    for (const tr of host.querySelectorAll(':scope > tbody > tr')) {
      const controls = tr.querySelectorAll('input:not([type="hidden"]), select, textarea');
      const cells = [...tr.children].filter(td => td.tagName === 'TD');
      if (!controls.length) {
        const text = clean(tr.textContent);
        if (!text) continue;                                   // spacer row
        if (cells.length !== 2) return null;
        rows.push({ kind: 'static', label: clean(cells[0].textContent).replace(/:$/, ''), value: clean(cells[1].textContent) });
        continue;
      }
      if (cells.length !== 2) return null;
      const [first, second] = cells;
      const box = first.querySelector('input[type="checkbox"]');
      if (box) {
        if (first.querySelectorAll('input, select').length !== 1 || second.querySelector('input, select, textarea')) return null;
        rows.push({ kind: 'check', label: clean(second.textContent), input: box });
        continue;
      }
      if (first.querySelector('input, select, textarea')) return null;
      let label = clean(first.textContent).replace(/:$/, '');
      const required = /^\*/.test(label);
      label = label.replace(/^\*\s*/, '');
      if (!label) return null;
      const radios = [...second.querySelectorAll('input[type="radio"]')];
      if (radios.length) {
        if (radios.length > 5 || radios.length !== second.querySelectorAll('input, select, textarea').length) return null;
        const options = radios.map(r => ({ input: r, text: clean(r.nextSibling?.nodeType === 3 ? r.nextSibling.textContent : r.value) }));
        if (options.some(o => !o.text)) return null;
        rows.push({ kind: 'choice', label, required, options });
        continue;
      }
      rows.push({ kind: 'field', label, required, cell: second });
    }
    if (!rows.some(r => r.kind !== 'static') || rows.length > 10) return null;
    return { host, rows, form };
  }

  function settingsRows(cell) {
    if (cell.querySelector('.cp-set')) return;
    const found = readSettings(cell);
    if (!found) return;
    const { host, rows, form } = found;
    const card = make('div', 'cp-set');
    const title = clean(cell.querySelector('.screenName')?.textContent);
    if (title) card.appendChild(make('div', 'cp-set-head', title));
    const syncs = [];
    for (const row of rows) {
      const line = make('div', 'cp-set-row');
      const label = make(row.kind === 'field' ? 'label' : 'div', 'cp-set-label');
      if (row.required) label.appendChild(make('span', 'cp-set-req', '*'));
      label.appendChild(document.createTextNode(row.label));
      const control = make('div', 'cp-set-control');
      if (row.kind === 'static') {
        control.appendChild(make('span', 'cp-set-static', row.value));
      } else if (row.kind === 'field') {
        // The real input moves into the row, so typing, validation and saving are CommPilot's own.
        [...row.cell.childNodes].forEach(node => control.appendChild(node));
        const input = control.querySelector('input:not([type="hidden"]), select, textarea');
        if (input?.id) label.htmlFor = input.id;
      } else if (row.kind === 'choice') {
        const group = make('div', 'cp-seg');
        group.setAttribute('role', 'radiogroup');
        group.setAttribute('aria-label', row.label);
        for (const option of row.options) {
          const button = make('button', 'cp-seg-opt', option.text);
          button.type = 'button';
          button.setAttribute('role', 'radio');
          button.addEventListener('click', () => { if (!option.input.checked) option.input.click(); sync(); });
          group.appendChild(button);
          syncs.push(() => {
            button.setAttribute('aria-checked', String(option.input.checked));
            button.disabled = option.input.disabled;
          });
        }
        control.appendChild(group);
      } else if (row.kind === 'check') {
        const toggle = make('button', 'cp-switch');
        toggle.type = 'button';
        toggle.setAttribute('role', 'switch');
        toggle.setAttribute('aria-label', row.label);
        toggle.addEventListener('click', () => { row.input.click(); sync(); });
        control.appendChild(toggle);
        syncs.push(() => {
          toggle.setAttribute('aria-checked', String(row.input.checked));
          toggle.disabled = row.input.disabled;
        });
      }
      line.append(label, control);
      card.appendChild(line);
    }
    function sync() { syncs.forEach(fn => fn()); }
    // CommPilot's own scripts can check, clear, enable, or disable controls in reaction to each other.
    form.addEventListener('change', sync);
    form.addEventListener('click', () => setTimeout(sync, 0));
    host.classList.add('cp-set-native');
    host.parentNode.insertBefore(card, host);
    sync();
  }

  /* ---- Available / Assigned pick lists: paired cards (mockup pick B) --------------------------------- */
  // CommPilot's pick list: one row of [select multiple][cell of Add / Remove buttons][select multiple], under a
  // header row of listHeader titles. The real selects stay in the form (hidden) and remain the state; the
  // cards mirror them, and the move buttons press CommPilot's own buttons.
  const MOVES = [
    { test: /^add\s*all/i, label: 'Add all »' }, { test: /^add/i, label: 'Add ›', primary: true },
    { test: /^remove\s*all/i, label: '« Remove all' }, { test: /^remove/i, label: '‹ Remove' }
  ];
  const ORDER = ['Add ›', 'Add all »', '‹ Remove', '« Remove all'];

  function pickLists(cell) {
    for (const row of new Set([...cell.querySelectorAll('select[multiple]')].map(s => s.closest('tr')))) {
      if (!row || row.classList.contains('cp-dl-native')) continue;
      const cells = [...row.children].filter(td => td.tagName === 'TD');
      if (cells.length !== 3) continue;
      const [left, middle, right] = cells;
      const avail = left.querySelector('select[multiple]'), asgn = right.querySelector('select[multiple]');
      const natives = [...middle.querySelectorAll('input[type="button"], button')];
      if (!avail || !asgn || middle.querySelector('select') || natives.length < 2) continue;
      const buttons = natives.map(b => {
        const text = clean(b.value || b.textContent);
        const move = MOVES.find(m => m.test.test(text));
        return move && { native: b, ...move };
      }).filter(Boolean);
      if (!buttons.length) continue;
      buildPickList(row, cells.length, avail, asgn, buttons);
    }
  }

  function headerTitles(row) {
    for (let tr = row.previousElementSibling; tr; tr = tr.previousElementSibling) {
      const heads = [...tr.children].filter(td => td.classList.contains('listHeader'));
      if (heads.length >= 2) return { row: tr, left: clean(heads[0].textContent), right: clean(heads[heads.length - 1].textContent) };
    }
    return { row: null, left: 'Available', right: 'Assigned' };
  }

  function buildPickList(row, span, avail, asgn, buttons) {
    const titles = headerTitles(row);
    const card = make('div', 'cp-dl');
    const panes = {};
    for (const [side, select, title] of [['avail', avail, titles.left || 'Available'], ['asgn', asgn, titles.right || 'Assigned']]) {
      const pane = make('div', 'cp-dl-pane');
      const head = make('div', 'cp-dl-head');
      head.append(make('span', 'cp-dl-title', title), make('span', 'cp-dl-count'));
      const filter = make('input', 'cp-dl-filter');
      filter.type = 'search';
      filter.placeholder = 'Filter…';
      filter.setAttribute('aria-label', 'Filter ' + title);
      const list = make('div', 'cp-dl-list');
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-multiselectable', 'true');
      list.setAttribute('aria-label', title);
      pane.append(head, filter, list);
      panes[side] = { pane, select, filter, list, count: head.lastChild, anchor: -1 };
      filter.addEventListener('input', () => render(side));
    }
    const moves = make('div', 'cp-dl-moves');
    for (const label of ORDER) {
      const move = buttons.find(b => b.label === label);
      if (!move) continue;
      const button = make('button', 'cp-dl-move' + (move.primary ? ' cp-dl-primary' : ''), label);
      button.type = 'button';
      button.addEventListener('click', () => { move.native.click(); refresh(); });
      move.button = button;
      moves.appendChild(button);
    }
    card.append(panes.avail.pane, moves, panes.asgn.pane);

    // Real options, minus CommPilot's blank placeholder in an empty list.
    const options = select => [...select.options].filter(o => o.value !== '' || clean(o.textContent));
    function choose(side, index, event) {
      const { select } = panes[side];
      const list = options(select);
      if (event.shiftKey && panes[side].anchor >= 0) {
        const [from, to] = [panes[side].anchor, index].sort((a, b) => a - b);
        list.forEach((o, i) => { o.selected = i >= from && i <= to; });
      } else {
        list[index].selected = !list[index].selected;
        panes[side].anchor = index;
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));   // CommPilot's own change handlers
      render(side);
    }
    function moveOne(side, index) {
      const list = options(panes[side].select);
      list.forEach((o, i) => { o.selected = i === index; });
      const move = buttons.find(b => b.label === (side === 'avail' ? 'Add ›' : '‹ Remove'));
      move?.native.click();
      refresh();
    }
    function render(side) {
      const { select, filter, list, count } = panes[side];
      const all = options(select);
      const term = filter.value.trim().toLowerCase();
      count.textContent = String(all.length);
      const focused = document.activeElement?.closest?.('.cp-dl-list') === list ? document.activeElement.dataset.index : null;
      list.textContent = '';
      all.forEach((option, index) => {
        const text = clean(option.textContent);
        if (term && !text.toLowerCase().includes(term)) return;
        const item = make('div', 'cp-dl-row');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.tabIndex = -1;
        item.dataset.index = String(index);
        item.append(make('span', 'cp-dl-box'), make('span', 'cp-dl-text', text));
        item.addEventListener('click', event => choose(side, index, event));
        item.addEventListener('dblclick', () => moveOne(side, index));
        item.addEventListener('keydown', event => {
          if (event.key === ' ') { event.preventDefault(); choose(side, index, event); }
          else if (event.key === 'Enter') { event.preventDefault(); moveOne(side, index); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const next = event.key === 'ArrowDown' ? item.nextElementSibling : item.previousElementSibling;
            if (next) { item.tabIndex = -1; next.tabIndex = 0; next.focus(); }
          }
        });
        list.appendChild(item);
      });
      if (!list.children.length) list.appendChild(make('div', 'cp-dl-empty', term ? 'No matches' : 'Nothing here'));
      const first = list.querySelector('.cp-dl-row');
      const again = focused != null && list.querySelector(`.cp-dl-row[data-index="${focused}"]`);
      (again || first)?.setAttribute('tabindex', '0');
      if (again) again.focus();
    }
    function refresh() {
      render('avail'); render('asgn');
      for (const b of buttons) if (b.button) b.button.disabled = b.native.disabled;
    }
    // CommPilot moves options with its own script; redraw whenever either list changes.
    const observer = new MutationObserver(refresh);
    observer.observe(avail, { childList: true, subtree: true });
    observer.observe(asgn, { childList: true, subtree: true });

    const holder = document.createElement('tr');
    holder.className = 'cp-dl-holder';
    const td = document.createElement('td');
    td.colSpan = span;
    td.appendChild(card);
    holder.appendChild(td);
    row.parentNode.insertBefore(holder, row);
    row.classList.add('cp-dl-native');
    titles.row?.classList.add('cp-dl-native');
    refresh();
  }

  /* ---- Schedule event editor: summary and pickers (mockup pick B) ------------------------------------ */
  // Replaces the name, date/time, all-day, Repeats and Daily/Weekly rows. Monthly / Yearly patterns and the
  // recurrence range stay as CommPilot's own rows below the card (its script still shows and hides them).
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const ICON_CAL = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

  function eventEditor(cell) {
    const form = cell.querySelector('form[name="mainForm"]');
    const f = name => form?.querySelector(`[name="${name}"]`);
    if (!form || cell.querySelector('.cp-ev') || !f('eventName') || !f('startDate') || !f('endDate') || !f('recurType')) return;
    const tables = [...cell.querySelectorAll('td.enduserbody > table.enduserbody')];
    const details = f('startDate').closest('fieldset')?.querySelector('table');
    if (!tables.length || !details) return;
    const h24 = f('use24HourNotation')?.value === 'true';
    const pad = n => String(n).padStart(2, '0');

    // CommPilot keeps each date as m/d/yyyy text plus hidden month/day/year parts.
    const readDate = name => {
      const [m, d, y] = (f(name).value || '').split('/').map(Number);
      return y ? `${y}-${pad(m)}-${pad(d)}` : '';
    };
    const writeDate = (name, iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      if (!y) return;
      const text = f(name);
      text.value = `${m}/${d}/${y}`;
      for (const [part, value] of [['month', m], ['day', d], ['year', y]]) {
        const hidden = f(`${name}_${part}`);
        if (hidden) hidden.value = String(value);
      }
      text.dispatchEvent(new Event('change', { bubbles: true }));
      text.dispatchEvent(new Event('blur'));
    };
    // …and each time as h:mm text with an AM/PM list (or 24-hour text), plus hidden hour/minute parts.
    const readTime = name => {
      const [h, m] = (f(name)?.value || '').split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) return '';
      const pm = !h24 && f(name.replace('Time', 'Ampm'))?.value === 'PM';
      return `${pad(h24 ? h : (h % 12) + (pm ? 12 : 0))}:${pad(m)}`;
    };
    const writeTime = (name, hhmm) => {
      const [H, M] = hhmm.split(':').map(Number);
      if (Number.isNaN(H)) return;
      const text = f(name);
      if (h24) text.value = `${H}:${pad(M)}`;
      else {
        text.value = `${H % 12 || 12}:${pad(M)}`;
        const ampm = f(name.replace('Time', 'Ampm'));
        if (ampm) { ampm.value = H >= 12 ? 'PM' : 'AM'; ampm.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      if (f(name + '_hour')) f(name + '_hour').value = String(H);
      if (f(name + '_minute')) f(name + '_minute').value = String(M);
      text.dispatchEvent(new Event('change', { bubbles: true }));
      text.dispatchEvent(new Event('blur'));
    };
    const label = time => {
      const [H, M] = time.split(':').map(Number);
      return Number.isNaN(H) ? '' : h24 ? `${pad(H)}:${pad(M)}` : `${H % 12 || 12}:${pad(M)} ${H >= 12 ? 'PM' : 'AM'}`;
    };
    const longDate = iso => {
      const [y, m, d] = iso.split('-').map(Number);
      return y ? new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    };
    const recurText = () => clean(f('recurType').options[f('recurType').selectedIndex]?.textContent) || 'Never';

    const card = make('div', 'cp-ev');
    const summary = make('div', 'cp-ev-sum');
    summary.innerHTML = ICON_CAL;
    const summaryText = make('span');
    summary.appendChild(summaryText);
    card.appendChild(summary);
    const row = (key, ...children) => {
      const line = make('div', 'cp-ev-row');
      const k = make('span', 'cp-ev-k', key);
      const v = make('div', 'cp-ev-v');
      v.append(...children);
      line.append(k, v);
      card.appendChild(line);
      return line;
    };
    const scheduleName = [...tables[0].querySelectorAll('tr')].find(tr => /Schedule Name/i.test(tr.textContent) && !tr.querySelector('input'));
    if (scheduleName) row('Schedule', make('span', 'cp-ev-static', clean(scheduleName.lastElementChild?.textContent)));
    row('Event', f('eventName'));                                   // the real name field moves into the card

    const picker = (type, name) => {
      const input = make('input', 'cp-ev-pick');
      input.type = type;
      input.setAttribute('aria-label', name === 'startDate' ? 'Start date' : name === 'endDate' ? 'End date' :
        name === 'startTime' ? 'Start time' : 'End time');
      input.addEventListener('change', () => { (type === 'date' ? writeDate : writeTime)(name, input.value); sync(); });
      return input;
    };
    const startDate = picker('date', 'startDate'), startTime = picker('time', 'startTime');
    const endDate = picker('date', 'endDate'), endTime = picker('time', 'endTime');
    row('Starts', startDate, startTime);
    const allDay = make('button', 'cp-switch');
    allDay.type = 'button';
    allDay.setAttribute('role', 'switch');
    allDay.setAttribute('aria-label', 'All day');
    allDay.addEventListener('click', () => { f('allDayEvent')?.click(); sync(); });
    const allDayLabel = make('span', 'cp-ev-muted', 'All day');
    row('Ends', endDate, endTime, allDayLabel, allDay);

    const segments = make('div', 'cp-seg');
    segments.setAttribute('role', 'radiogroup');
    segments.setAttribute('aria-label', 'Repeats');
    const recurButtons = [...f('recurType').options].map(option => {
      const button = make('button', 'cp-seg-opt', clean(option.textContent));
      button.type = 'button';
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => {
        f('recurType').value = option.value;
        f('recurType').dispatchEvent(new Event('change', { bubbles: true }));   // CommPilot shows its pattern rows
        sync();
      });
      segments.appendChild(button);
      return { button, option };
    });
    row('Repeats', segments);

    const chips = make('div', 'cp-ev-days');
    const dayButtons = DAYS.map(day => {
      const box = f('recurWeekly' + day);
      const chip = make('button', 'cp-ev-day', day[0]);
      chip.type = 'button';
      chip.setAttribute('aria-label', day);
      chip.addEventListener('click', () => { box?.click(); sync(); });
      chips.appendChild(chip);
      return { chip, box };
    });
    const weeklyEvery = make('span', 'cp-ev-muted', 'every');
    const weeklyUnit = make('span', 'cp-ev-muted', 'week(s)');
    const weekly = row('On', chips, weeklyEvery, ...(f('recurWeeklyInterval') ? [f('recurWeeklyInterval')] : []), weeklyUnit);
    const daily = row('Every', ...(f('recurDailyInterval') ? [f('recurDailyInterval')] : []), make('span', 'cp-ev-muted', 'day(s)'));

    function sync() {
      if (document.activeElement !== startDate) startDate.value = readDate('startDate');
      if (document.activeElement !== endDate) endDate.value = readDate('endDate');
      if (document.activeElement !== startTime) startTime.value = readTime('startTime');
      if (document.activeElement !== endTime) endTime.value = readTime('endTime');
      const allDayOn = !!f('allDayEvent')?.checked;
      allDay.setAttribute('aria-checked', String(allDayOn));
      allDay.disabled = !f('allDayEvent') || f('allDayEvent').disabled;
      startTime.disabled = allDayOn || f('startTime').disabled;
      endTime.disabled = allDayOn || !f('endTime') || f('endTime').disabled;
      startDate.disabled = f('startDate').disabled;
      endDate.disabled = f('endDate').disabled;
      const recur = recurText();
      recurButtons.forEach(({ button, option }) => {
        button.setAttribute('aria-checked', String(option.selected));
        button.disabled = f('recurType').disabled;
      });
      dayButtons.forEach(({ chip, box }) => {
        chip.setAttribute('aria-pressed', String(!!box?.checked));
        chip.disabled = !box || box.disabled;
      });
      weekly.hidden = recur !== 'Weekly';
      daily.hidden = recur !== 'Daily';
      // One plain sentence for the whole event.
      const when = allDayOn ? 'all day' : [label(readTime('startTime')), label(readTime('endTime'))].filter(Boolean).join(' – ');
      const from = longDate(readDate('startDate'));
      const picked = DAYS.filter(d => f('recurWeekly' + d)?.checked);
      const weekdays = picked.length === 5 && !picked.includes('Saturday') && !picked.includes('Sunday');
      const days = weekdays ? 'weekdays' : picked.map(d => d.slice(0, 3)).join(', ') || 'no days';
      const every = n => (n === '1' || !n ? '' : n + ' ');
      summaryText.textContent =
        recur === 'Weekly' ? `Every ${every(f('recurWeeklyInterval')?.value)}week${f('recurWeeklyInterval')?.value > 1 ? 's' : ''} on ${days}, ${when}, from ${from}.` :
        recur === 'Daily' ? `Every ${every(f('recurDailyInterval')?.value)}day${f('recurDailyInterval')?.value > 1 ? 's' : ''}, ${when}, from ${from}.` :
        recur === 'Never' ? `Once on ${from}, ${when}.` :
        `${recur}, ${when}, from ${from}.`;
    }
    form.addEventListener('change', sync);
    form.addEventListener('input', sync);
    form.addEventListener('click', () => setTimeout(sync, 0));

    // Hide what the card replaces; everything else (Monthly / Yearly rows, the range) stays CommPilot's.
    tables[0].classList.add('cp-ev-native');
    const replaced = el => el?.closest('tr')?.classList.add('cp-ev-native');
    for (const tr of details.querySelectorAll(':scope > tbody > tr')) {
      const text = clean(tr.textContent);
      if (/^(Event Time|Recurrence Pattern):?$/i.test(text)) tr.classList.add('cp-ev-native');
    }
    ['startDate', 'endDate', 'recurType'].forEach(name => replaced(f(name)));
    replaced(details.querySelector('#durationTime'));
    details.querySelector('#rowDaily')?.classList.add('cp-ev-native');
    details.querySelector('#rowWeekly')?.classList.add('cp-ev-native');
    tables[0].parentNode.insertBefore(card, tables[0]);
    sync();
  }

  /* ---- Shared page frame: header with actions, one content card ------------------------------------- */
  // CommPilot pages share one frame: title (td.screenName), description (td.tip), an action bar above and a
  // duplicate below (tr#buttonbartop / tr#buttonbarbottom), and the content cell (td.enduserbody). The page's own
  // buttons move beside the title (they stay in the form); the duplicate bar hides; the content is one card.
  function pageFrame(cell) {
    if (cell.querySelector(':scope > .cp-console')) return;   // the menu board (pjax.js) replaces the page
    const frame = cell.querySelector('form[name="mainForm"] > table');
    if (!frame || frame.classList.contains('cp-frame')) return;
    const rows = frame.querySelectorAll(':scope > tbody > tr');
    const title = frame.querySelector(':scope > tbody > tr > td.screenName');
    const body = frame.querySelector(':scope > tbody > tr > td.enduserbody');
    if (!title || !body || rows.length > 16) return;
    frame.classList.add('cp-frame');
    body.classList.add('cp-frame-body');
    // Spacer rows (empty cells, one-pixel images) only add height between the parts.
    const blank = el => !clean(el.textContent) &&
      !el.querySelector('input:not([type="hidden"]), select, textarea, button, a, table, fieldset, .cp-set, .cp-dl, .cp-ev');
    rows.forEach(tr => { if (blank(tr)) tr.classList.add('cp-frame-spacer'); });
    const top = frame.querySelector(':scope > tbody > tr#buttonbartop > td.buttonbar');
    const bottom = frame.querySelector(':scope > tbody > tr#buttonbarbottom');
    // Only a bar of plain buttons moves; anything else (text, fields) keeps CommPilot's bar.
    const movable = top && [...top.childNodes].every(n => n.nodeType === 3 ? !clean(n.textContent) :
      n.nodeType === 8 || n.tagName === 'SCRIPT' || n.tagName === 'BR' ||
      (n.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'reset'].includes(n.type)) || n.tagName === 'BUTTON');
    // The header is built like the menu board's section headers (mockup pick D): the open folder's icon (the one
    // it has in the sidebar; native-theme.js maps the name to it), the title, the page's actions and an accent
    // underline.
    const head = make('div', 'cp-frame-head');
    const folder = clean(document.querySelector('form[name="leftNavForm"] a.leftnavfolderopen')?.textContent).toLowerCase();
    if (folder) {
      const icon = make('span', 'cp-frame-ico');
      icon.setAttribute('data-cp-name', folder);
      icon.setAttribute('aria-hidden', 'true');
      head.appendChild(icon);
    }
    const name = make('span', 'cp-frame-title');
    name.append(...title.childNodes);
    head.appendChild(name);
    if (movable) {
      const actions = make('div', 'cp-frame-actions');
      top.querySelectorAll('input[type="submit"], input[type="button"], input[type="reset"], button').forEach(b => actions.appendChild(b));
      if (actions.children.length) head.appendChild(actions);
      top.closest('tr').classList.add('cp-frame-moved');
      bottom?.classList.add('cp-frame-moved');
    }
    title.appendChild(head);
    title.closest('tr').classList.add('cp-frame-titlerow');
    const tip = frame.querySelector(':scope > tbody > tr > td.tip');
    if (tip && clean(tip.textContent)) describe(tip, name);
    // Blank rows inside the content (an &nbsp; line or spacer images) separate groups of fields: keep them as a
    // small, even gap instead of a full text line.
    const spacerOnly = tr => [...tr.querySelectorAll('img')].every(img => /onepx\.gif$/i.test(img.getAttribute('src') || ''));
    body.querySelectorAll('tr:not(.cp-frame-spacer)').forEach(tr => { if (blank(tr) && spacerOnly(tr)) tr.classList.add('cp-frame-gap'); });
    // A settings card headed with the page's own title repeats it.
    body.querySelectorAll('.cp-set-head').forEach(h => { if (clean(h.textContent).toLowerCase() === clean(name.textContent).toLowerCase()) h.hidden = true; });
    // Results, the empty band CommPilot draws under them, and the pager, so the card can give them dividers
    // and one inset.
    for (const table of body.querySelectorAll('table')) {
      if (table.querySelector(':scope > tbody > tr > td.listHeader') && table.querySelector(':scope > tbody > tr[id^="Row"]')) {
        table.classList.add('cp-frame-results');
        table.querySelectorAll(':scope > tbody > tr:not([id^="Row"])').forEach(tr => { if (blank(tr)) tr.classList.add('cp-frame-spacer'); });
      } else if (blank(table) && table.querySelector(':scope > tbody > tr > td.listHeader')) table.classList.add('cp-frame-rule');
      // The older one-line "Find" form some lists keep under the pager.
      if (!table.querySelector('table') && !table.classList.contains('cp-searchbar') && table.querySelector('[name="findKey"]'))
        table.classList.add('cp-findline');
      if (!table.querySelector('table') && /\[\s*Page\s+\d+\s+of\s+\d+\s*\]/.test(table.textContent))
        table.classList.add('cp-frame-pager');
    }
  }

  // A page's description sits behind an info button beside the title (mockup pick), so the content starts right
  // under the header; the button opens it in a small card below the title.
  // Just the "i", drawn on the chip's 21px inner box and centred in it (dot 5.75–7.75, stem 8.75–15.25).
  const INFO = '<svg viewBox="0 0 21 21" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'aria-hidden="true"><path d="M10.5 9.75v4.5M10.5 6.75h.01"/></svg>';
  function describe(tip, name) {
    const about = make('div', 'cp-frame-about');
    about.id = 'cp-frame-about';
    about.setAttribute('role', 'note');
    about.hidden = true;
    about.append(...tip.childNodes);
    const info = make('button', 'cp-frame-info');
    info.type = 'button';
    info.title = 'About this page';
    info.setAttribute('aria-label', 'About this page');
    info.setAttribute('aria-controls', about.id);
    info.setAttribute('aria-expanded', 'false');
    info.innerHTML = INFO;
    info.addEventListener('click', () => {
      about.hidden = !about.hidden;
      info.setAttribute('aria-expanded', String(!about.hidden));
    });
    name.append(info, about);
    tip.closest('tr').classList.add('cp-frame-moved');
  }
  // The description card closes on Escape (back to its button) and on a click anywhere else.
  function closeAbout(refocus) {
    const about = document.querySelector('.cp-frame-about:not([hidden])');
    if (!about) return false;
    about.hidden = true;
    const info = about.parentElement.querySelector('.cp-frame-info');
    info?.setAttribute('aria-expanded', 'false');
    if (refocus) info?.focus();
    return true;
  }
  document.addEventListener('click', event => { if (!event.target.closest?.('.cp-frame-about, .cp-frame-info')) closeAbout(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && closeAbout(true)) event.preventDefault(); });

  function apply() {
    if (!active()) return;
    const cell = content();
    if (!cell) return;
    for (const transform of [searchBar, eventEditor, settingsRows, pickLists, pageFrame]) {
      try { transform(cell); } catch (error) { console.warn('[CommPilot forms]', transform.name, error); }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  document.addEventListener('cp:reskin', () => requestAnimationFrame(apply));
  document.addEventListener('cp:morphed', () => requestAnimationFrame(apply));
  document.addEventListener('cp:theme-change', apply);
})();
