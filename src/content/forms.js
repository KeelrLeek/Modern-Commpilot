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
  // A choice that turns something on or off, by its words.
  const toneOf = text => /^(on|enabled?|active|activated)$/i.test(clean(text)) ? 'on'
    : /^(off|disabled?|inactive|deactivated)$/i.test(clean(text)) ? 'off' : '';

  /* ---- List search criteria: selected User Search design A ---------------------------------------- */
  function searchHints(table) {
    for(const input of table.querySelectorAll('input[name^="findValue"]')){
      if(input.placeholder)continue;
      const field=input.closest('tr')?.querySelector('select[name^="findKey"]');
      const label=clean(field?.selectedOptions[0]?.textContent);
      if(label)input.placeholder=label==='User ID'?'Enter a user ID…':`Enter ${label.toLowerCase()}…`;
    }
  }
  function searchBar(cell) {
    const search = cell.querySelector('#search0');
    const table = search?.closest('table');
    if (!table || table.classList.contains('cp-searchbar') || !table.querySelector('tr#tr0 [name^="findValue"]')) return;
    table.classList.add('cp-searchbar');
    (cell.querySelector('form[name="mainForm"] > table > tbody > tr > td.enduserbody') || table.closest('td.enduserbody'))?.classList.add('cp-search-design-a');
    const wrap = make('div', 'cp-searchbar-wrap');
    table.parentNode.insertBefore(wrap, table);
    wrap.appendChild(table);
    // CommPilot's "+" (in the last criteria row) keeps its own addRow logic; this button just presses it.
    const add = make('button', 'cp-searchbar-add', '+ Add criteria');
    add.type = 'button';
    const plus = () => [...table.querySelectorAll('input[type="button"]')].filter(b => b.value.trim() === '+').pop();
    add.addEventListener('click', () => { plus()?.click(); add.hidden = !plus(); searchHints(table); });
    add.hidden = !plus();
    const actions = make('div','cp-searchbar-actions');
    const reset = make('button','cp-searchbar-reset','Reset');
    reset.type = 'button';
    reset.addEventListener('click',()=>{
      // Drive the native row-removal and field-change handlers. form.reset() would restore a spent token.
      for (let count=0;count<30;count++) {
        const minus=[...table.querySelectorAll('input[type="button"]')].filter(button=>button.value.trim()==='-').pop();
        if (!minus) break;
        const before=table.querySelectorAll('tr[id^="tr"]').length;minus.click();
        if (table.querySelectorAll('tr[id^="tr"]').length>=before) break;
      }
      const field=table.querySelector('select[name="findKey0"]');
      if (field) {field.selectedIndex=0;field.dispatchEvent(new Event('change',{bubbles:true}));}
      table.querySelectorAll('[name^="findValue"]').forEach(input=>{
        if (input.tagName==='SELECT') input.selectedIndex=0; else input.value='';
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      const operator=table.querySelector('select[name="findOp0"]');if(operator)operator.selectedIndex=0;
      add.hidden=!plus();
      (table.querySelector('input[name="search"]') || search).click();
    });
    actions.append(reset,add);wrap.appendChild(actions);
    searchHints(table);
  }

  // Changing a criteria row's field (User ID → Last Name) keeps what was typed. CommPilot's getChoice builds the row a
  // new, empty value box and a new operator list on every change; the text goes into the new box when it is a text
  // box too (up to its length), and the operator (Contains …) stays when the new field offers it. Both are remembered
  // per row, so they come back after a field with a list of values and only Equal To (Department) in between.
  const kept = new WeakMap();   // findKeyN select -> { text, op } last chosen in its row
  document.addEventListener('change', event => {
    const key = event.target;
    const row = /^findKey(\d+)$/.exec(key?.name || '')?.[1];
    if (row == null || key.tagName !== 'SELECT') return;
    const box = document.getElementById(`findValue${row}`), ops = document.getElementById(`findOp${row}`);
    const memo = kept.get(key) || {};
    if (box?.tagName === 'INPUT') memo.text = box.value;
    if (ops?.options?.length > 1) memo.op = ops.value;   // a choice, not the only operator a field has
    kept.set(key, memo);
    let done = false;
    // CommPilot's handler is on the select itself: carry after it, as the event reaches the document (or, for a
    // change that does not bubble, right after).
    const after = e => { if (e === event) carry(); };
    const carry = () => {
      if (done) return;
      done = true;
      document.removeEventListener('change', after);
      const newBox = document.getElementById(`findValue${row}`), newOps = document.getElementById(`findOp${row}`);
      if (memo.text && newBox && newBox !== box && newBox.tagName === 'INPUT' && !newBox.value)
        newBox.value = newBox.maxLength > 0 ? memo.text.slice(0, newBox.maxLength) : memo.text;
      if (memo.op && newOps && newOps !== ops && newOps.value !== memo.op && [...newOps.options].some(o => o.value === memo.op)) {
        newOps.value = memo.op;
        newOps.dispatchEvent(new Event('change', { bubbles: true }));   // the dropdown over it shows the choice
      }
      if(key.closest('.cp-searchbar'))searchHints(key.closest('.cp-searchbar'));
    };
    document.addEventListener('change', after);
    setTimeout(carry);
  }, true);

  /* ---- Settings forms: aligned rows (mockup pick A, 2026-10-02) ---------------------------------------- */
  // CommPilot's forms are tables of [label][control] cells (two pairs to a row on big pages), fieldsets for sections,
  // checkbox and radio rows, read-only rows and notes. formLayout reads them into items and lays every page out the
  // same way: one field per row, the label in a fixed column, CommPilot's side-by-side pairs kept on one line, two
  // columns on a wide screen. The real controls move into the layout and stay in the form, so OK / Apply, PJAX saves
  // and CommPilot's own scripts behave as before. Its emptied tables stay behind, hidden, and the layout follows them:
  // when CommPilot shows or hides a row (or a cell, or a fieldset's div), or puts new controls into a cell, the
  // matching item does the same. Anything the reader does not understand moves across whole ("raw"), so no field is
  // lost; a page with nothing readable (lists, searches, the board) keeps today's look.
  const CONTROL = 'input:not([type="hidden"]), select, textarea';
  const offInline = el => el?.style?.display === 'none';
  const offUpTo = (el, stop) => { for (let n = el; n && n !== stop; n = n.parentElement) if (offInline(n)) return true; return false; };
  // A cell's own words: without its controls, their option lists, the extension's select buttons and hidden parts.
  function ownText(td) {
    // Reject controls before traversing their children. Cloning a cell first also
    // clones every option in a large department list just to discard that select.
    const walk = document.createTreeWalker(td, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT :
        node.matches('input, select, textarea, button, .bw-select-shell, script, style, [style*="display: none"], [style*="display:none"]')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
    });
    let text = '', node;
    while ((node = walk.nextNode())) text += node.data;
    return clean(text);
  }
  const controlsIn = el => [...el.querySelectorAll(CONTROL)];
  const isList = table => !!table.querySelector(':scope > tbody > tr > td.listHeader');
  const isPager = table => !table.querySelector('table') && /\[\s*Page\s+\d+\s+of\s+\d+\s*\]/i.test(clean(table.textContent));
  const isLabel = text => /:\s*$/.test(text);
  const labelOf = text => {
    const label = clean(text).replace(/:\s*$/, '');
    return { label: label.replace(/^\*\s*/, ''), required: /^\*/.test(label) };
  };
  // How wide a field wants to be, from what it holds.
  function fieldSize(ctl) {
    if (!ctl) return 'm';
    if (ctl.tagName === 'SELECT') {
      let longest = 0;
      for (const option of ctl.options) longest = Math.max(longest, clean(option.textContent).length);
      return longest <= 6 ? 'xs' : longest <= 18 ? 's' : longest <= 34 ? 'm' : 'l';
    }
    if (ctl.tagName === 'TEXTAREA') return 'xl';
    const n = Number(ctl.getAttribute('maxlength')) || Number(ctl.getAttribute('size')) || 30;
    return n <= 6 ? 'xs' : n <= 16 ? 's' : n <= 34 ? 'm' : n <= 60 ? 'l' : 'xl';
  }
  const INPUT_WIDTH = { xs: '88px', s: '180px', m: '260px', l: '320px', xl: '360px' };

  // A radio's words, however CommPilot wrote them: the radio inside its own <label>, or what follows it up to the next
  // control (plain text, a <label for>, a <span>), or a <label for> elsewhere, or its value.
  function radioOption(r) {
    const wrap = r.closest('label');
    if (wrap && wrap.querySelectorAll('input').length === 1) return { input: r, wrap, text: clean(wrap.textContent) };
    const nodes = [];
    for (let n = r.nextSibling; n; n = n.nextSibling) {
      if (n.nodeType === 1 && (n.matches('input, select, textarea, br, table, div, p, fieldset') || n.querySelector('input, select, textarea'))) break;
      nodes.push(n);
    }
    const words = clean(nodes.map(n => n.nodeType === 1 && n.matches('script, style') ? '' : n.textContent).join(' '));
    const elsewhere = [...(r.labels || [])].find(l => !nodes.some(n => n === l || n.contains?.(l)));
    return { input: r, nodes, text: words || clean(elsewhere?.textContent) || clean(r.value) };
  }

  // One table row → items. Returns null when the row is not a plain form row (the caller keeps it whole).
  function readRow(tr, items) {
    const cells = [...tr.children].filter(td => td.tagName === 'TD');
    if (!cells.length || tr.querySelector('table')) return cells.length ? null : true;
    const shown = cells.filter(td => !offInline(td));
    // A row of label-less boxes (CommPilot's "Specific phone numbers" grid): one line of a grid.
    const filled = shown.filter(td => controlsIn(td).length || ownText(td));
    if (filled.length >= 2 && filled.every(td => controlsIn(td).length && !ownText(td) &&
        controlsIn(td).every(c => !/^(checkbox|radio)$/.test(c.type)))) {
      items.push({ type: 'inputs', cells: filled });
      return true;
    }
    if (!tr.querySelector(CONTROL)) {
      const texted = cells.filter(td => ownText(td));
      if (!texted.length) return true;                                                     // a spacer row
      // A row of labels only ("Alternate User ID:" "Description:"): column headings, if boxes follow.
      if (texted.length >= 2 && texted.every(td => isLabel(ownText(td)))) { items.push({ type: 'heads', cells: texted, row: tr }); return true; }
      if (texted.length === 1 && !isLabel(ownText(texted[0]))) {
        const prev = items[items.length - 1];
        const under = cells.indexOf(texted[0]) > 0 && cells.slice(0, cells.indexOf(texted[0])).every(td => !ownText(td));
        if (prev?.type === 'field' && !prev.grid && under && !texted[0].querySelector('a')) { (prev.hints ||= []).push(texted[0]); return true; }
        const link = texted[0].querySelector('a');
        if (link && clean(link.textContent) === ownText(texted[0])) items.push({ type: 'link', node: link, cell: texted[0] });
        else items.push({ type: 'note', cell: texted[0] });
        return true;
      }
    }
    const mine = items.length;   // items from before this row
    let pending = null;          // a label waiting for its control
    for (let i = 0; i < cells.length; i++) {
      const td = cells[i];
      const ctls = controlsIn(td);
      const text = ownText(td);
      const prev = items[items.length - 1];
      if (!ctls.length) {
        const link = td.querySelector('a');
        if (link && clean(link.textContent) === text) { items.push({ type: 'link', node: link, cell: td }); continue; }
        if (!text) continue;
        if (pending) { items.push({ type: 'fact', label: pending.label, cells: [td] }); pending = null; continue; }
        const next = cells[i + 1];
        if (next && !controlsIn(next).length && isLabel(text) && !offInline(td)) {
          // A label, then plain text: a read-only fact (its value can run over a few cells).
          const values = [];
          let j = i + 1;
          for (; j < cells.length && !controlsIn(cells[j]).length && !cells[j].querySelector('a') && !(values.length && isLabel(ownText(cells[j]))); j++)
            values.push(cells[j]);
          items.push({ type: 'fact', label: labelOf(text).label, cells: values });
          i = j - 1;
          continue;
        }
        if (isLabel(text) || (next && controlsIn(next).length)) { pending = labelOf(text); continue; }
        // Text after a field in its row ("Activated" / "Not Activated"): its hint, which follows the cell.
        if (prev?.type === 'field' && items.indexOf(prev) >= mine) { (prev.hints ||= []).push(td); continue; }
        items.push({ type: 'note', cell: td });
        continue;
      }
      const radios = ctls.filter(c => c.type === 'radio');
      const boxes = ctls.filter(c => c.type === 'checkbox');
      if (radios.length && radios.length === ctls.length) {
        const options = radios.map(radioOption);
        if (!pending && prev?.type === 'choice' && prev.name === radios[0].name) prev.options.push(...options);
        else items.push({ type: 'choice', name: radios[0].name, label: pending?.label || '', required: pending?.required, options, cell: td });
        pending = null;
        continue;
      }
      if (boxes.length === 1 && ctls.length === 1) {
        const next = cells[i + 1];
        // Its words are in the next cell, sometimes with a field among them ("Enforce Association Limit [24] Hours").
        const labelCell = !text && next && ownText(next) && !controlsIn(next).some(c => /^(checkbox|radio)$/.test(c.type)) ? next : null;
        // [checkbox][Enforce Association Limit:][24][Hours]: the box switches the field after its words on.
        const after = [];
        if (labelCell && !controlsIn(labelCell).length && isLabel(ownText(labelCell)) && cells[i + 2] && controlsIn(cells[i + 2]).length) {
          after.push(cells[i + 2]);
          for (let j = i + 3; j < cells.length && !controlsIn(cells[j]).length && ownText(cells[j]) && !isLabel(ownText(cells[j])); j++) after.push(cells[j]);
        }
        items.push({ type: 'check', input: boxes[0], heading: pending?.label || '', cell: td, labelCell, after });
        pending = null;
        i += (labelCell ? 1 : 0) + after.length;
        continue;
      }
      // A control cell: its label is the pending one, or "Label: [control]" inside the cell.
      let label = pending;
      if (!label && text && /:/.test(text)) label = labelOf(text.split(/:\s/)[0] + ':');
      if (!label && prev?.type === 'field' && prev.line !== tr && cells.slice(0, i).every(c => !ownText(c)) && !prev.grid) {
        (prev.more ||= []).push(td);   // a second line for the field above (Address line 2)
        continue;
      }
      items.push({ type: 'field', label: label?.label || '', required: !!label?.required, cell: td, control: ctls[0],
        size: fieldSize(ctls[0]), inlineLabel: !pending && !!label });
      pending = null;
    }
    if (pending) items.push({ type: 'note', text: pending.label, asLabel: true });   // "Specific phone numbers:" over a grid
    return true;
  }

  // A content table → items; rows it cannot read stay whole, in place.
  function readTable(table, items) {
    if (isList(table)) { items.push({ type: 'raw', node: table, list: true }); return; }
    // The pager line ("[ Page 1 of 3 ]") stays as served: lists.js and the bulk tools read it.
    if (isPager(table)) { items.push({ type: 'raw', node: table }); return; }
    // CommPilot's tabs (General Settings | Internal Calls Settings) keep their own strip.
    if (table.querySelector(':scope > tbody > tr > :is(td.tab, td.tabActive)')) { items.push({ type: 'raw', node: table }); return; }
    // Search criteria and pick lists keep CommPilot's markup: searchBar and pickLists turn them into their own widgets.
    if (table.querySelector('#search0, [name^="findValue"], select[multiple]') &&
        (table.querySelectorAll(':scope > tbody > tr').length === 1 || table.querySelector(':scope > tbody > tr#tr0'))) {
      items.push({ type: 'raw', node: table });
      return;
    }
    for (const tr of table.querySelectorAll(':scope > tbody > tr')) {
      if (offInline(tr) && !tr.querySelector(CONTROL)) continue;
      const fieldsets = tr.querySelectorAll(':scope > td > fieldset, :scope > td > div > fieldset');
      if (fieldsets.length) { fieldsets.forEach(fs => readFieldset(fs, items, tr)); continue; }
      const inner = tr.children.length === 1 && tr.querySelector(':scope > td > table');
      if (inner && !inner.querySelector('table')) { readTable(inner, items); continue; }
      if (tr.querySelector('#search0, select[multiple], [name^="findValue"]')) { items.push({ type: 'raw', node: tr, row: true }); continue; }
      const before = items.length;
      if (readRow(tr, items) === null) { items.length = before; items.push({ type: 'raw', node: tr, row: true }); }
      // A leading 20px spacer cell indents the row: sub-options of the setting above.
      const lead = tr.firstElementChild;
      const indent = lead?.getAttribute('width') === '20' && !clean(lead.textContent) && !lead.querySelector(CONTROL);
      for (const item of items.slice(before)) { item.line ||= tr; if (indent && item.type !== 'inputs') item.indent = true; }
    }
  }
  function readFieldset(fs, items, tr) {
    // A first legend can contain controls exempt from the fieldset's disabled state.
    // Keep that native structure rather than moving those controls out of their legend.
    if (fs.querySelector(':scope > legend')?.querySelector(CONTROL)) {
      items.push({ type: 'raw', node: fs, line: tr });
      return;
    }
    const section = { type: 'section', title: clean(fs.querySelector(':scope > legend')?.textContent), items: [], node: fs, row: tr };
    for (const child of fs.children) {
      if (child.tagName === 'TABLE') readTable(child, section.items);
      else if (child.tagName === 'FIELDSET') readFieldset(child, section.items, tr);
    }
    section.items = gather(section.items);
    items.push(section);
  }
  // Runs of label-less box rows become one field holding a grid, labelled by the note just above them.
  function gather(items) {
    const out = [];
    for (const item of items) {
      const prev = out[out.length - 1];
      if (prev?.type === 'heads' && item.type !== 'inputs') {
        // Headings with no boxes under them: read-only label / value pairs after all.
        out.pop();
        for (let k = 0; k < prev.cells.length; k += 2) out.push({ type: 'fact', label: labelOf(ownText(prev.cells[k])).label, cells: prev.cells.slice(k + 1, k + 2), line: prev.row });
      }
      if (item.type !== 'inputs') { out.push(item); continue; }
      if (prev?.type === 'field' && prev.grid) { prev.grid.push(item.cells); continue; }
      if (prev?.type === 'heads') { out.pop(); out.push({ type: 'field', label: '', grid: [item.cells], heads: prev.cells, size: 'xl', line: item.line }); continue; }
      let label = '';
      if (prev?.type === 'note' && (prev.asLabel || (prev.cell && isLabel(ownText(prev.cell))))) {
        label = prev.asLabel ? prev.text : ownText(prev.cell).replace(/:\s*$/, '');
        out.pop();
      }
      out.push({ type: 'field', label, grid: [item.cells], size: 'xl', line: item.line });
    }
    const last = out[out.length - 1];
    if (last?.type === 'heads') { out.pop(); out.push({ type: 'note', cell: last.row }); }
    return out;
  }
  function readForm(body) {
    const items = [];
    const walk = parent => {
      for (const child of parent.children) {
        if (child.tagName === 'TABLE' && child.classList.contains('enduserbody')) {
          const main = child.querySelector(':scope > tbody > tr > td[width="100%"]');
          if (main) walk(main); else readTable(child, items);
        } else if (child.tagName === 'TABLE') readTable(child, items);
        else if (child.tagName === 'FIELDSET') readFieldset(child, items, null);
        else if (/^(DIV|SPAN|P)$/.test(child.tagName) && child.querySelector(CONTROL + ', table')) items.push({ type: 'raw', node: child });
      }
    };
    walk(body);
    return gather(items);
  }

  // Items → the layout. Every element remembers what it came from (`mirror`) so it can follow CommPilot's changes.
  function buildForm(items) {
    const root = make('div', 'fx');
    const mirrors = [];    // { el, from: [elements whose inline display decides it] }
    const fills = [];      // { cell, into, nodes }: a CommPilot cell whose controls moved, and where to
    const facts = [];
    let started = false, grid = null, activeFieldset = null;
    const follow = (el, ...from) => mirrors.push({ el, from: from.filter(Boolean) });
    const fill = (cell, into) => { const nodes = [...cell.childNodes]; into.append(...nodes); fills.push({ cell, into, nodes }); };
    const group = (title, item, parentGrid) => {
      // Keep the real fieldset and its ancestry. Native scripts can disable it and
      // immediately submit in the same task; an asynchronously mirrored wrapper
      // would briefly submit fields that the PBX had just disabled.
      const section = item ? item.node : make('section', 'fx-sec');
      const parent = section.parentElement;
      section.classList.add('fx-sec');
      if (item) for (const child of [...section.children])
        if (/^(TABLE|LEGEND)$/.test(child.tagName)) child.classList.add('fx-native');
      if (title) { section.dataset.title = title; section.appendChild(make('h3', 'fx-sec-title', title)); }
      grid = make('div', 'fx-grid');
      section.appendChild(grid);
      (parentGrid || root).appendChild(section);
      if (item) follow(section, section, parent?.tagName === 'DIV' ? parent : null, item.row);
      return section;
    };
    const place = (item, el) => {
      if (!grid) group('');
      if (item.indent) el.dataset.indent = '';
      follow(el, item.line, item.cell);
      // Fields CommPilot put side by side stay on one line.
      const last = grid.lastElementChild;
      if (item.line && last?.classList.contains('fx-line') && last.cpLine === item.line) last.appendChild(el);
      else if (item.line && item.type !== 'raw' && item.type !== 'note') {
        const line = make('div', 'fx-line');
        line.cpLine = item.line;
        line.appendChild(el);
        grid.appendChild(line);
      } else grid.appendChild(el);
    };
    const add = item => {
      if (item.type === 'section') {
        const previous = activeFieldset;
        const previousGrid = grid;
        activeFieldset = item;
        group(item.title, item, previous ? previousGrid : null);
        item.items.forEach(add);
        activeFieldset = previous;
        grid = previous ? previousGrid : null;
        return;
      }
      if (!['fact', 'link', 'note'].includes(item.type)) started = true;
      if (item.type === 'link' && item.line && grid) {
        // A link in a field's row (Configure Identity/Device Profile) sits beside that field.
        const last = grid.lastElementChild;
        const field = last?.classList.contains('fx-line') && last.cpLine === item.line && [...last.children].reverse().find(c => c.classList.contains('fx-field'));
        if (field) { linkButton(item.node); field.querySelector(':scope > .fx-ctl').appendChild(item.node); return; }
      }
      if (item.type === 'fact' && !started) { facts.push(item); return; }
      if (item.type === 'link' && !started && facts.length && saves(item.node)) {
        // "Change User ID (Also saves current screen data)" joins its fact in the strip.
        const fact = facts.find(f => new RegExp('\\b' + f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(item.node.textContent));
        if (fact) { linkButton(item.node); fact.action = item.node; return; }
      }
      const el = render(item, fill, follow);
      if (el) place(item, el);
    };
    items.forEach(add);
    if (facts.length) {
      const strip = make('div', 'fx-facts');
      for (const f of facts) {
        const fact = make('div', 'fx-fact');
        const value = make('span', 'fx-fact-v');
        f.cells.forEach(c => { fill(c, value); follow(fact, f.line, c); });
        if (!clean(value.textContent)) value.dataset.empty = '';
        fact.append(make('span', 'fx-fact-k', f.label), value);
        if (f.action) fact.appendChild(f.action);
        strip.appendChild(fact);
      }
      root.prepend(strip);
    }
    root.querySelectorAll('.fx-line').forEach(l => { l.dataset.n = String(l.children.length); });
    root.querySelectorAll('.fx-sec').forEach(s => {
      if (s.tagName !== 'FIELDSET' && !s.querySelector('.fx-grid > *')) s.remove();
    }); // Original fieldsets can still contain submitted hidden metadata.
    return { root, mirrors, fills };
  }
  const saves = a => /\(([^)]*\bsaves\b[^)]*)\)/i.test(a.textContent);
  // "Change User ID (Also saves current screen data)" → a small "Change User ID" button marked "saves first".
  function linkButton(a) {
    a.classList.add('fx-linkbtn');
    if (!a.getAttribute('role') && !a.getAttribute('href')) a.setAttribute('role', 'button');
    const m = a.textContent.match(/^(.*?)\s*\(([^)]*\bsaves\b[^)]*)\)\s*$/i);
    if (m) { a.textContent = clean(m[1]); a.title = m[2].replace(/^also /i, '').replace(/^./, c => c.toUpperCase()); a.classList.add('fx-saves'); }
  }
  let uid = 0;
  function render(item, fill, follow) {
    if (item.type === 'fact') {
      const el = make('div', 'fx-item fx-field fx-static');
      const value = make('div', 'fx-ctl fx-value');
      item.cells.forEach(c => { fill(c, value); follow(el, c); });
      if (!clean(value.textContent)) value.dataset.empty = '';
      el.append(make('div', 'fx-label', item.label), value);
      return el;
    }
    if (item.type === 'link') {
      linkButton(item.node);
      const el = make('div', 'fx-item fx-actionrow');
      el.appendChild(item.node);
      return el;
    }
    if (item.type === 'note') {
      const el = make('div', 'fx-item fx-note');
      if (item.cell) fill(item.cell, el); else el.textContent = item.text;
      return el;
    }
    if (item.type === 'raw') {
      item.node.classList.remove('fx-native');
      const el = make('div', 'fx-item fx-raw' + (item.list ? ' fx-list' : ''));
      if (item.row) {
        // A whole row CommPilot's scripts may still address: it moves inside a table of its own.
        const table = document.createElement('table');
        const tbody = document.createElement('tbody');
        tbody.appendChild(item.node);
        table.appendChild(tbody);
        el.appendChild(table);
      } else el.appendChild(item.node);
      return el;
    }
    if (item.type === 'check') {
      // A checkbox is a switch; its words sit beside it, and a label CommPilot gave it sits in the label column.
      const el = make('div', 'fx-item fx-check');
      const label = make('label', 'fx-check-label');
      item.input.classList.add('fx-switch');
      label.appendChild(item.input);
      const text = make('span', 'fx-check-text');
      if (item.labelCell) { fill(item.labelCell, text); follow(el, item.labelCell); }
      else fill(item.cell, text);
      if (item.after?.length) for (const n of [...text.childNodes]) if (n.nodeType === 3) n.textContent = n.textContent.replace(/:\s*$/, ' ');
      if (!clean(text.textContent) && item.heading) text.textContent = item.heading;
      label.appendChild(text);
      if (item.heading && clean(text.textContent) !== item.heading) el.appendChild(make('div', 'fx-label', item.heading));
      const line = make('div', 'fx-check-line');
      line.appendChild(label);
      for (const cell of item.after || []) { const part = make('span', 'fx-ctl fx-check-after'); fill(cell, part); line.appendChild(part); }
      el.appendChild(line);
      return el;
    }
    if (item.type === 'choice') {
      const el = make('div', 'fx-item fx-choice' + (item.label ? '' : ' fx-nolabel'));
      el.appendChild(make('div', 'fx-label', item.label));
      const ctl = make('div', 'fx-ctl fx-opts');
      ctl.setAttribute('role', 'radiogroup');
      if (item.label) ctl.setAttribute('aria-label', item.label);
      if (item.options.length <= 4 && item.options.every(o => o.text && o.text.length <= 22)) ctl.classList.add('fx-seg');
      for (const o of item.options) {
        if (o.wrap) { o.wrap.classList.add('fx-opt'); ctl.appendChild(o.wrap); continue; }   // CommPilot's own label
        const label = make('label', 'fx-opt');
        const span = make('span');
        span.append(...o.nodes);
        // CommPilot spaces its options with &nbsp; (\s covers it): trim them off the ends.
        const ends = [...span.childNodes].filter(n => n.nodeType === 3);
        if (ends.length) {
          ends[0].textContent = ends[0].textContent.replace(/^\s+/, '');
          ends[ends.length - 1].textContent = ends[ends.length - 1].textContent.replace(/\s+$/, '');
        }
        if (!clean(span.textContent)) span.textContent = o.text;
        label.append(o.input, span);
        ctl.appendChild(label);
      }
      // An On | Off pair lights its chosen side in the app's On or Off colour, like the board's switches (forms.css).
      if (ctl.classList.contains('fx-seg')) {
        const tones = [...ctl.querySelectorAll(':scope > .fx-opt')].map(opt => [opt, toneOf(opt.textContent)]);
        if (tones.some(([, t]) => t === 'on') && tones.some(([, t]) => t === 'off')) for (const [opt, t] of tones) if (t) opt.dataset.tone = t;
      }
      // Anything else in the radios' cell (a field after "Other:") stays with them.
      if (item.cell && controlsIn(item.cell).length) fill(item.cell, ctl);
      el.appendChild(ctl);
      return el;
    }
    if (item.type === 'field') {
      const el = make('div', 'fx-item fx-field' + (item.label ? '' : ' fx-nolabel'));
      el.dataset.size = item.size;
      const label = make('label', 'fx-label', item.label);
      if (item.required) label.appendChild(make('span', 'fx-req', '*'));
      const ctl = make('div', 'fx-ctl');
      if (item.grid) {
        ctl.classList.add('fx-boxgrid');
        ctl.style.setProperty('--fx-cols', String(Math.max(...item.grid.map(r => r.length))));
        for (const head of item.heads || []) ctl.appendChild(make('div', 'fx-boxhead', ownText(head).replace(/:\s*$/, '')));
        for (const row of item.grid) for (const cell of row) { const box = make('div', 'fx-box'); fill(cell, box); ctl.appendChild(box); }
        el.dataset.grid = '';
      } else {
        fill(item.cell, ctl);
        // "Label: [control]" in one cell: the words move to the label, out of the control's place.
        if (item.inlineLabel) for (const n of [...ctl.childNodes]) if (n.nodeType === 3 && /:/.test(n.textContent)) { n.remove(); break; }
      }
      for (const more of item.more || []) { const line = make('div', 'fx-ctl-more'); fill(more, line); ctl.appendChild(line); follow(line, more); }
      const first = ctl.querySelector(CONTROL);
      if (first) { if (!first.id) first.id = 'fx-f' + (++uid); label.htmlFor = first.id; }
      const boxes = [...ctl.querySelectorAll(CONTROL)].filter(b => !b.closest('.fx-ctl-more'));
      if (boxes.length > 1 && !item.grid) {
        ctl.dataset.multi = '';
        boxes.forEach(b => { if (b.tagName === 'INPUT') b.style.setProperty('--fx-in', INPUT_WIDTH[fieldSize(b)]); });
      }
      el.append(label, ctl);
      for (const cell of item.hints || []) { const hint = make('div', 'fx-hint'); fill(cell, hint); follow(hint, cell); el.appendChild(hint); }
      return el;
    }
    return null;
  }

  function formLayout(cell) {
    // Search criteria and native paging buttons belong to lists.js, even when the pager resembles a field row.
    if (cell.querySelector(':scope > .cp-console, .fx, .cp-ev, .cp-searchbar-wrap')) return;
    const body = cell.querySelector('form[name="mainForm"] > table > tbody > tr > td.enduserbody');
    if (!body) return;
    const items = readForm(body);
    // Only a page with something to set: lists, searches and read-only pages keep today's look.
    const settable = i => ['field', 'check', 'choice'].includes(i.type) || (i.type === 'section' && i.items.some(settable));
    if (!items.some(settable)) return;
    if (items.reduce((n, i) => n + (i.type === 'section' ? i.items.length : 1), 0) > 400) return;   // not a form: a sheet
    const { root, mirrors, fills } = buildForm(items);
    const host = [...body.children].find(c => c.tagName === 'TABLE' || c.tagName === 'FIELDSET');
    body.insertBefore(root, host || null);
    for (const child of [...body.children]) if (child !== root && /^(TABLE|FIELDSET)$/.test(child.tagName)) child.classList.add('fx-native');
    // Follow CommPilot: rows, cells and fieldset divs it shows and hides, and controls it puts into a cell.
    const sync = () => {
      for (const m of mirrors) m.el.hidden = m.from.some(n => offUpTo(n, body));
      for (const section of root.querySelectorAll('.fx-sec')) if (!section.hidden)
        section.classList.toggle('fx-empty-sec', ![...section.querySelectorAll('.fx-item')].some(i => !i.hidden));
      root.cpChips?.();
    };
    const refill = f => {
      const added = [...f.cell.childNodes];
      if (!added.length) return;
      const names = new Set(added.flatMap(n => n.nodeType === 1 ? [n, ...n.querySelectorAll('[name]')] : []).map(n => n.getAttribute?.('name')).filter(Boolean));
      for (const n of f.nodes) if (n.nodeType !== 1 || [n, ...n.querySelectorAll('[name]')].some(x => names.has(x.getAttribute?.('name')))) n.remove();
      f.into.append(...added);
      f.into.removeAttribute('data-empty');
      f.nodes = added;
    };
    // A control CommPilot puts somewhere else in its (hidden) tables, e.g. a cell that was empty when the page opened:
    // it joins its row's field, or the row comes into the layout whole, so it is never hidden from you.
    const strays = () => {
      for (const native of body.querySelectorAll('.fx-native')) {
        for (const ctl of native.querySelectorAll(CONTROL)) {
          if (ctl.closest('.fx-native') !== native) continue;
          const tr = ctl.closest('tr');
          const owner = tr && mirrors.find(m => m.from.includes(tr) && m.el.matches('.fx-item'));
          const into = owner?.el.querySelector(':scope > .fx-ctl, :scope > .fx-check-line');
          const cell = ctl.closest('td');
          if (into && cell) {
            const f = fills.find(x => x.cell === cell);
            if (f) refill(f);
            else { const nodes = [...cell.childNodes]; into.append(...nodes); fills.push({ cell, into, nodes }); }
            continue;
          }
          const fieldset = ctl.closest('fieldset');
          const host = fieldset ? fieldset.querySelector(':scope > .fx-grid') || fieldset : root;
          if (!tr || tr.contains(host)) continue;
          const el = make('div', 'fx-item fx-raw');
          const table = document.createElement('table');
          const tbody = document.createElement('tbody');
          tbody.appendChild(tr);
          table.appendChild(tbody);
          el.appendChild(table);
          host.appendChild(el);
        }
      }
    };
    const observer = new MutationObserver(records => {
      if (!root.isConnected) { observer.disconnect(); return; }
      let changed = false, added = false;
      for (const r of records) {
        if (r.type === 'attributes') {
          if (!root.contains(r.target) || r.target.matches('fieldset.fx-sec') || r.target.closest('.fx-native')) changed = true;
          continue;
        }
        const f = r.addedNodes.length && fills.find(x => x.cell === r.target);
        if (f) refill(f);
        else if (r.addedNodes.length && (!root.contains(r.target) || r.target.closest?.('.fx-native'))) added = true;
      }
      if (added) strays();
      if (changed || added) sync();
    });
    observer.observe(body, { attributes: true, attributeFilter: ['style', 'disabled'], subtree: true, childList: true });
    strays();   // anything the reader left behind shows from the start
    sync();
    root.cpSync = sync;
  }

  /* ---- Device profile editor: native section links, shared form styling ----------------------------- */
  function deviceProfileLayout(cell) {
    let path = document.documentElement.dataset.cpPath || location.pathname;
    if (/^\/commpilot\/Common\/(?:find|findAll|page|sort)\.jsp$/.test(path)) {
      const owner = history.state?.cpNav?.params?.returnPage;
      if (owner) path = owner.startsWith('/commpilot/') ? owner : '/commpilot' + owner;
    }
    if (!/^\/commpilot\/(?:Group|ServiceProvider|Operator\/System)\/DeviceInventory\/Modify\//.test(path)) return;
    const body = cell.querySelector('form[name="mainForm"] > table > tbody > tr > td.enduserbody');
    if (!body || body.classList.contains('cp-device-editor')) return;
    const tabs = [...body.querySelectorAll('a.tab, .tabActive')].filter(tab => !tab.parentElement.closest('.tabActive'));
    const table = tabs[0]?.closest('table');
    if (!table || tabs.length < 2 || !tabs.every(tab => tab.closest('table') === table)) return;
    body.classList.add('cp-device-editor');
    const nav = make('nav', 'cp-device-tabs');
    nav.setAttribute('aria-label', 'Device profile sections');
    for (const tab of tabs) {
      if (tab.matches('.tabActive')) {
        const current = make('span', 'cp-device-tab is-current', ownText(tab));
        current.setAttribute('aria-current', 'page');
        nav.appendChild(current);
      } else {
        tab.classList.add('cp-device-tab');
        tab.setAttribute('role', 'link');
        tab.tabIndex = 0;
        tab.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tab.click(); }
        });
        nav.appendChild(tab);   // preserve native IDs and listeners for PJAX's tab bridge
      }
    }
    const nativeWrap = table.closest('.fx-raw');
    (nativeWrap && !nativeWrap.querySelector(CONTROL) ? nativeWrap : table).classList.add('cp-device-native');
    body.prepend(nav);
    const root = body.querySelector('.fx');
    if (root && !root.querySelector('.fx-facts')) {
      const facts = [...root.querySelectorAll('.fx-static')].filter(field =>
        /^(?:Identity\/Device Profile (?:Name|Type)|Device Type URL)$/i.test(clean(field.querySelector('.fx-label')?.textContent)));
      if (facts.length >= 2) {
        const strip = make('div', 'fx-facts');
        for (const fact of facts) {
          fact.className = 'fx-fact';
          fact.querySelector('.fx-label').className = 'fx-fact-k';
          fact.querySelector('.fx-ctl').className = 'fx-fact-v';
          strip.appendChild(fact);
        }
        root.prepend(strip);
      }
    }
    // Some deployments nest the host and port in another table. The general reader preserves that row whole;
    // align its real controls here instead of retaining the native 50% right-aligned cells.
    for (const raw of body.querySelectorAll('.fx-raw:not(.cp-device-native)')) {
      const inputs = [...raw.querySelectorAll('input:not([type="hidden"])')];
      const host = inputs.find(input => /^(?:ipAddress|hostName|deviceIpAddress)$/i.test(input.name));
      const port = inputs.find(input => /^(?:port|portNumber)$/i.test(input.name));
      if (!host || !port || inputs.length !== 2 || raw.querySelector('select, textarea')) continue;
      const row = make('div', 'cp-device-endpoint');
      for (const [input, text, size] of [[host,'Host Name/IP Address','m'],[port,'Port','xs']]) {
        const field = make('div', 'fx-item fx-field');
        field.dataset.size = size;
        const label = make('label', 'fx-label', text);
        if (!input.id) input.id = 'fx-f' + (++uid);
        label.htmlFor = input.id;
        const control = make('div', 'fx-ctl');
        control.appendChild(input);
        field.append(label, control);
        row.appendChild(field);
      }
      raw.before(row);
      raw.classList.add('cp-device-native');
    }
  }

  /* ---- Shared Call Appearance: connected form (selected mockup B) ---------------------------------- */
  // Reuse the form reader's actual controls and list, including their IDs and native handlers. In particular,
  // Find still submits CommPilot's search and Delete still only marks an appearance until OK / Apply.
  // Recognize the overview by its contents, too: Find can return it at /Common/find.jsp.
  function sharedCallAppearance(cell) {
    const root = cell.querySelector('.fx');
    if (!root || root.classList.contains('cp-sca')) return;
    if (!/^Shared Call Appearance$/i.test(clean(cell.querySelector('td.screenName')?.textContent))) return;
    const checks = [...root.querySelectorAll('.fx-check')];
    const patterns = [/^Alert all appearances for Click.to.Dial calls$/i, /^Alert all appearances for Group Paging calls$/i,
      /^Allow Call Retrieve from another location$/i, /^Allow bridging between locations$/i, /^Enable Call Park notification$/i];
    const options = patterns.map(pattern => checks.find(el => pattern.test(clean(el.querySelector('.fx-check-text')?.textContent))));
    const tone = [...root.querySelectorAll('.fx-choice')].find(el => /^Bridge Warning tone:?$/i.test(clean(el.querySelector('.fx-label')?.textContent)));
    const arrangement = [...root.querySelectorAll('.fx-choice')].find(el => /^Multiple Call Arrangement:?$/i.test(clean(el.querySelector('.fx-label')?.textContent)));
    const policy = [...root.querySelectorAll('a, button, input[type="button"]')]
      .find(el => /^Configure device policies$/i.test(clean(el.value || el.textContent)));
    const list = [...root.querySelectorAll('.fx-list > table')].find(table => {
      const heads = [...table.querySelectorAll(':scope > tbody > tr > td.listHeader')].map(ownText).filter(Boolean);
      return ['Delete', 'Identity/Device Profile Type', 'Identity/Device Profile Name', 'Line/Port']
        .every(label => heads.some(text => text.toLowerCase() === label.toLowerCase()));
    });
    // Legacy SCA lists render Find / Find All as headerLink anchors wired to doFind / doFindAll, not buttons.
    const find = [...root.querySelectorAll('input, button, a')].find(el => /^Find$/i.test(clean(el.value || el.textContent)));
    const search = find?.closest('.fx-raw');
    if (options.some(el => !el) || !tone || !policy || !list || !search ||
        !search.querySelector('[name^="findValue"]')) return;   // an unfamiliar variant keeps the general layout
    // Some variants place these settings inside native policy fieldsets. Keep the
    // general layout there so regrouping cannot detach controls from that policy.
    if ([...options, tone, arrangement, policy, list, search].some(el => el?.closest('fieldset'))) return;

    root.classList.add('cp-sca');
    const heading = (title, caption) => {
      const head = make('div', 'cp-sca-heading');
      head.append(make('h3', 'fx-sec-title', title), make('p', 'fx-hint', caption));
      return head;
    };
    const settings = make('section', 'cp-sca-settings');
    settings.setAttribute('aria-label', 'Call behavior');
    settings.appendChild(heading('Call behavior', 'Applies to all appearances'));
    const group = make('div', 'cp-sca-options');
    group.append(...options);
    settings.appendChild(group);
    // This native On / Off choice belongs with the call settings, rather than being left below Find.
    if (arrangement) {
      arrangement.classList.add('cp-sca-arrangement');
      settings.appendChild(arrangement);
    }

    tone.classList.add('cp-sca-tone');
    const label = tone.querySelector('.fx-label');
    label.textContent = 'Bridge warning tone';
    label.appendChild(make('span', 'cp-sca-caption', 'Choose when a warning is played'));

    const policies = make('div', 'cp-sca-policies');
    const policyLabel = make('div');
    policyLabel.append(make('span', 'cp-sca-policy-label', 'Device policies'),
      make('span', 'cp-sca-caption', 'Manage rules for shared devices'));
    policies.append(policyLabel, policy);

    const devices = make('section', 'cp-sca-devices');
    devices.setAttribute('aria-label', 'Shared appearances');
    devices.appendChild(heading('Shared appearances', 'Device profiles sharing this user’s line'));
    const listItem = list.closest('.fx-list');
    listItem.classList.add('cp-sca-results');
    list.classList.add('cp-sca-table');
    // The list module discovers the native pager among the result table's siblings. Keep it there, so it can
    // retain server paging when not all pages were fetched, and replace it only when the whole list is here.
    for (const item of [...root.querySelectorAll('.fx-raw')]) {
      if (item === listItem || item === search || item.querySelector(CONTROL)) continue;
      const pager = item.querySelector(':scope > table');
      if (pager && !pager.querySelector('table') && /\[\s*Page\s+\d+\s+of\s+\d+\s*\]/i.test(clean(pager.textContent))) {
        listItem.appendChild(pager);
        item.remove();
      }
    }
    search.classList.add('cp-sca-find');
    find.classList.add('cp-sca-find-button');
    devices.append(listItem, search);
    // Move only recognized pieces. Keep any extra native fields, notices, and validation messages visible.
    for (const item of [...root.querySelectorAll('.fx-note, .fx-static, .fx-actionrow')]) {
      if (!item.querySelector(CONTROL + ', a, button') && /^(Device Policies:?\s*[—-]?|[—-])$/i.test(clean(item.textContent))) item.remove();
    }
    root.prepend(settings, tone, policies, devices);
    for (const line of root.querySelectorAll('.fx-line')) if (!line.childElementCount) line.remove();
    for (const section of root.querySelectorAll('.fx-sec'))
      if (section.tagName !== 'FIELDSET' && !section.querySelector('.fx-item')) section.remove();
  }

  /* ---- After the frame: unsaved changes, section chips, empty lists (mockup extras, 2026-10-02) ---------- */
  const valueOf = el => el.type === 'checkbox' || el.type === 'radio' ? el.checked :
    el.tagName === 'SELECT' ? [...el.selectedOptions].map(o => o.value).join('\n') : el.value;
  function formExtras(cell) {
    const root = cell.querySelector('.fx');
    if (root && !root.cpExtras) {
      root.cpExtras = true;
      // Unsaved changes: what each field holds the first time you reach for the page (a click, a key, a focus) is the
      // starting point, so values the page's own scripts fill in as it opens never count as yours. A changed field
      // gets a dot, the header a count.
      let start = null;
      root.cpBegin = () => { start ||= new Map([...root.querySelectorAll(CONTROL)].map(el => [el, valueOf(el)])); };
      root.cpDirty = () => {
        if (!start) return;
        let n = 0;
        for (const item of root.querySelectorAll('.fx-item, .fx-fact')) {
          const any = [...item.querySelectorAll(CONTROL)].some(el => start.has(el) && valueOf(el) !== start.get(el));
          item.classList.toggle('is-dirty', any);
          if (any) n++;
        }
        const actions = cell.querySelector('.cp-frame-actions');
        let pill = cell.querySelector('.fx-unsaved');
        if (!pill && actions && n) { pill = make('span', 'fx-unsaved'); pill.setAttribute('role', 'status'); actions.prepend(pill); }
        if (pill) { pill.hidden = !n; pill.textContent = n === 1 ? '1 unsaved change' : `${n} unsaved changes`; }
      };
      // Section chips: a page with titled sections gets chips under its title that jump to each one.
      // Titled sections, and the untitled one at the top as "Details".
      const sections = [...root.querySelectorAll(':scope > .fx-sec')]
        .filter(s => !s.classList.contains('fx-empty-sec')).filter((s, i) => s.dataset.title || i === 0);
      const head = cell.querySelector('.cp-frame-head');
      if (head && !root.closest('.cp-device-editor') && sections.length >= 2 && sections.some(s => s.dataset.title)) {
        const nav = make('nav', 'fx-jump');
        nav.setAttribute('aria-label', 'Sections on this page');
        const chips = sections.map(section => {
          const chip = make('button', 'fx-jump-chip', section.dataset.title ? section.dataset.title.replace(/^./, c => c.toUpperCase()) : 'Details');
          chip.type = 'button';
          chip.addEventListener('click', () => {
            section.style.scrollMarginTop = Math.round(head.getBoundingClientRect().height + 16) + 'px';
            section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
          });
          nav.appendChild(chip);
          return { chip, section };
        });
        head.appendChild(nav);
        root.cpChips = () => {
          const line = head.getBoundingClientRect().bottom + 24;
          let on = chips.find(c => !c.section.hidden) || chips[0];
          for (const c of chips) { c.chip.hidden = c.section.hidden; if (!c.section.hidden && c.section.getBoundingClientRect().top <= line) on = c; }
          for (const c of chips) c.chip.classList.toggle('is-on', c === on);
        };
        root.cpChips();
      }
    }
    // Empty lists: "No Entries Present" becomes a quiet empty state that names what will show, with its own Add.
    for (const td of cell.querySelectorAll('td')) {
      if (td.querySelector('td, .fx-empty') || !/^No Entries Present\.?$/i.test(clean(td.textContent))) continue;
      const table = td.closest('table');
      // A heading's words only: CommPilot keeps its sort scripts inside the heading cells.
      const heads = [...table.querySelectorAll(':scope > tbody > tr > td.listHeader')].map(ownText).filter(Boolean);
      const add = [...cell.querySelectorAll('.cp-frame-actions :is(input, button), td.buttonbar :is(input, button)')]
        .find(b => /^add\b/i.test(clean(b.value || b.textContent)));
      const box = make('div', 'fx-empty');
      box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M3.5 9.5h17M8 14h8"/></svg>';
      const words = make('div', 'fx-empty-words');
      const cols = heads.filter(h => !/^(edit|active|delete|select)$/i.test(h)).slice(0, 3).map(h => h.toLowerCase());
      words.append(make('b', '', 'Nothing here yet'),
        make('span', '', cols.length ? 'Entries you add show here with their ' + cols.join(', ') + '.' : 'Entries you add show here.'));
      box.appendChild(words);
      if (add) {
        const button = make('button', 'fx-empty-add', '+ ' + clean(add.value || add.textContent));
        button.type = 'button';
        button.addEventListener('click', () => add.click());
        box.appendChild(button);
      }
      td.textContent = '';
      td.appendChild(box);
      td.colSpan = Math.max(heads.length, 1);
      td.closest('tr').classList.add('fx-empty-row');
    }
  }
  // One listener each for the whole session: the current page's layout answers.
  const currentForm = () => document.querySelector('td[width="82%"] .fx');
  // You reaching for the page (before the change happens) sets the starting point; a change updates the count.
  const reach = event => {
    const form = currentForm();
    if (form?.cpBegin && event.isTrusted && event.target?.closest?.('td[width="82%"], .bw-search-popover')) form.cpBegin();
  };
  for (const type of ['pointerdown', 'keydown', 'focusin']) document.addEventListener(type, reach, true);
  const edited = () => { const form = currentForm(); if (form?.cpDirty) setTimeout(form.cpDirty, 0); };
  for (const type of ['input', 'change', 'click']) document.addEventListener(type, edited, true);
  document.addEventListener('scroll', () => currentForm()?.cpChips?.(), { capture: true, passive: true });

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
      if (heads.length >= 2) return { row: tr, left: ownText(heads[0]), right: ownText(heads[heads.length - 1]) };
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
    const unavailable = (select, option) => select.matches(':disabled') || !option || option.disabled ||
      option.parentElement?.matches('optgroup:disabled');
    function choose(side, index, event) {
      const { select } = panes[side];
      const list = options(select);
      if (unavailable(select, list[index])) return;
      if (event.shiftKey && panes[side].anchor >= 0) {
        const [from, to] = [panes[side].anchor, index].sort((a, b) => a - b);
        list.forEach((o, i) => { if (!unavailable(select, o)) o.selected = i >= from && i <= to; });
      } else {
        list[index].selected = !list[index].selected;
        panes[side].anchor = index;
      }
      select.dispatchEvent(new Event('change', { bubbles: true }));   // CommPilot's own change handlers
      // The change listener refreshes both panes and the native button states.
    }
    function moveOne(side, index) {
      const select = panes[side].select, list = options(select);
      if (unavailable(select, list[index])) return;
      list.forEach((o, i) => { o.selected = i === index; });
      const move = buttons.find(b => b.label === (side === 'avail' ? 'Add ›' : '‹ Remove'));
      move?.native.click();
      refresh();
    }
    function render(side) {
      const { select, filter, list, count } = panes[side];
      const all = options(select);
      list.setAttribute('aria-disabled', String(select.matches(':disabled')));
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
        item.setAttribute('aria-disabled', String(!!unavailable(select, option)));
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
            const direction = event.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling';
            let next = item[direction];
            while (next?.getAttribute('aria-disabled') === 'true') next = next[direction];
            if (next) { item.tabIndex = -1; next.tabIndex = 0; next.focus(); }
          }
        });
        list.appendChild(item);
      });
      if (!list.children.length) list.appendChild(make('div', 'cp-dl-empty', term ? 'No matches' : 'Nothing here'));
      const first = list.querySelector('.cp-dl-row[aria-disabled="false"]');
      const again = focused != null && list.querySelector(`.cp-dl-row[aria-disabled="false"][data-index="${focused}"]`);
      (again || first)?.setAttribute('tabindex', '0');
      if (again) again.focus();
    }
    function refresh() {
      render('avail'); render('asgn');
      for (const b of buttons) if (b.button) b.button.disabled = b.native.matches(':disabled');
    }
    // CommPilot moves options with its own script; redraw whenever either list changes.
    const observer = new MutationObserver(refresh);
    for (const select of [avail, asgn]) {
      observer.observe(select, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['disabled', 'selected'] });
      select.addEventListener('change', refresh);
    }
    for (const b of buttons) observer.observe(b.native, { attributes: true, attributeFilter: ['disabled'] });
    for (let parent = row.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === 'FIELDSET') observer.observe(parent, { attributes: true, attributeFilter: ['disabled'] });

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
    const editable = control => !!control && !control.matches(':disabled') && !control.readOnly;

    // CommPilot keeps each date as m/d/yyyy text plus hidden month/day/year parts.
    const readDate = name => {
      const [m, d, y] = (f(name).value || '').split('/').map(Number);
      return y ? `${y}-${pad(m)}-${pad(d)}` : '';
    };
    const writeDate = (name, iso) => {
      const [y, m, d] = iso ? iso.split('-').map(Number) : ['', '', ''];
      if (iso && !y) return;
      const text = f(name);
      text.value = iso ? `${m}/${d}/${y}` : '';
      for (const [part, value] of [['month', m], ['day', d], ['year', y]]) {
        const hidden = f(`${name}_${part}`);
        if (hidden) hidden.value = String(value);
      }
      text.dispatchEvent(new Event('change', { bubbles: true }));
      text.dispatchEvent(new Event('blur'));
    };
    // …and each time as h:mm text with an AM/PM list (or 24-hour text), plus hidden hour/minute parts.
    const readTime = name => {
      const raw = f(name)?.value || '';
      if (!raw) return '';
      const [h, m] = raw.split(':').map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
      const pm = !h24 && f(name.replace('Time', 'Ampm'))?.value === 'PM';
      return `${pad(h24 ? h : (h % 12) + (pm ? 12 : 0))}:${pad(m)}`;
    };
    const writeTime = (name, hhmm) => {
      const [H, M] = hhmm ? hhmm.split(':').map(Number) : ['', ''];
      if (hhmm && (!Number.isFinite(H) || !Number.isFinite(M))) return;
      const text = f(name);
      if (!hhmm) text.value = '';
      else if (h24) text.value = `${H}:${pad(M)}`;
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
      if (!time) return '';
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
      input.addEventListener('change', () => {
        if (editable(f(name))) (type === 'date' ? writeDate : writeTime)(name, input.value);
        else input.value = (type === 'date' ? readDate : readTime)(name);
        sync();
      });
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
        if (!editable(f('recurType')) || option.matches(':disabled')) { sync(); return; }
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
    const intervals = [];
    const interval = (name, label) => {
      const native = f(name);
      if (!native) return [];
      // As with dates, leave the successful form control inside its native fieldset.
      // Moving it here would change submission when that fieldset is disabled.
      const input = make('input', 'cp-ev-interval');
      input.type = 'text';
      input.setAttribute('aria-label', label);
      if (native.hasAttribute('maxlength')) input.maxLength = native.maxLength;
      if (native.hasAttribute('size')) input.size = native.size;
      for (const type of ['input', 'change']) input.addEventListener(type, () => {
        if (editable(native)) {
          native.value = input.value;
          native.dispatchEvent(new Event(type, { bubbles: true }));
        } else input.value = native.value;
        sync();
      });
      intervals.push({ input, native });
      return [input];
    };
    const weekly = row('On', chips, weeklyEvery, ...interval('recurWeeklyInterval', 'Weekly interval'), weeklyUnit);
    const daily = row('Every', ...interval('recurDailyInterval', 'Daily interval'), make('span', 'cp-ev-muted', 'day(s)'));

    function sync() {
      if (document.activeElement !== startDate) startDate.value = readDate('startDate');
      if (document.activeElement !== endDate) endDate.value = readDate('endDate');
      if (document.activeElement !== startTime) startTime.value = readTime('startTime');
      if (document.activeElement !== endTime) endTime.value = readTime('endTime');
      const allDayOn = !!f('allDayEvent')?.checked;
      allDay.setAttribute('aria-checked', String(allDayOn));
      allDay.disabled = !editable(f('allDayEvent'));
      startTime.disabled = allDayOn || !editable(f('startTime'));
      endTime.disabled = allDayOn || !editable(f('endTime'));
      startDate.disabled = !editable(f('startDate'));
      endDate.disabled = !editable(f('endDate'));
      const recur = recurText();
      recurButtons.forEach(({ button, option }) => {
        button.setAttribute('aria-checked', String(option.selected));
        button.disabled = !editable(f('recurType')) || option.matches(':disabled');
      });
      dayButtons.forEach(({ chip, box }) => {
        chip.setAttribute('aria-pressed', String(!!box?.checked));
        chip.disabled = !editable(box);
      });
      for (const { input, native } of intervals) {
        if (document.activeElement !== input) input.value = native.value;
        input.disabled = !editable(native);
      }
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
    // Native scripts also change permissions without firing input/change events.
    // Observe only native controls/ancestors, not the proxy buttons updated by sync.
    const stateObserver = new MutationObserver(sync);
    const observed = new Set();
    for (const name of ['startDate', 'endDate', 'startTime', 'endTime', 'allDayEvent', 'recurType',
      'recurWeeklyInterval', 'recurDailyInterval', ...DAYS.map(day => 'recurWeekly' + day)]) {
      const control = f(name);
      if (!control) continue;
      observed.add(control);
      for (let parent = control.parentElement; parent && parent !== form; parent = parent.parentElement)
        if (parent.tagName === 'FIELDSET') observed.add(parent);
    }
    for (const node of observed) stateObserver.observe(node, { attributes: true,
      attributeFilter: ['disabled', 'readonly'], subtree: node.tagName === 'SELECT' });

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
      !el.querySelector('input:not([type="hidden"]), select, textarea, button, a, table, fieldset, .fx, .cp-dl, .cp-ev');
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
    // Results, the empty band CommPilot draws under them, and the pager, so the card can give them dividers
    // and one inset.
    for (const table of body.querySelectorAll('table')) {
      const hasColumns=[...table.querySelectorAll(':scope > tbody > tr > td.listHeader')].some(header=>ownText(header));
      if (!table.classList.contains('cp-searchbar') && hasColumns && (table.querySelector(':scope > tbody > tr[id^="Row"]') || body.classList.contains('cp-search-design-a'))) {
        table.classList.add('cp-frame-results');
        table.querySelectorAll(':scope > tbody > tr:not([id^="Row"])').forEach(tr => { if (blank(tr)) tr.classList.add('cp-frame-spacer'); });
      } else if (blank(table) && table.querySelector(':scope > tbody > tr > td.listHeader')) table.classList.add('cp-frame-rule');
      // The older one-line "Find" form some lists keep under the pager.
      if (!table.querySelector('table') && !table.classList.contains('cp-searchbar') && table.querySelector('[name="findKey"]'))
        table.classList.add('cp-findline');
      if (isPager(table))
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
    for (const transform of [searchBar, eventEditor, formLayout, pickLists, deviceProfileLayout, sharedCallAppearance, pageFrame, formExtras]) {
      try { transform(cell); } catch (error) { console.warn('[CommPilot forms]', transform.name, error); }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  // Navigation can announce both a morph and a reskin in the same frame.
  // Read the current content when the callback runs, including a replacement page.
  let applyQueued = false;
  function scheduleApply() {
    if (applyQueued) return;
    applyQueued = true;
    requestAnimationFrame(() => { applyQueued = false; apply(); });
  }
  document.addEventListener('cp:reskin', scheduleApply);
  document.addEventListener('cp:morphed', scheduleApply);
  document.addEventListener('cp:theme-change', scheduleApply);
})();
