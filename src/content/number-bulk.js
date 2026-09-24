/* Group Numbers: preview and apply department assignments from an Excel workbook. */
(function () {
  if (window !== window.top || window.__cpNumberBulkLoaded) return;
  window.__cpNumberBulkLoaded = true;

  const LIST = '/commpilot/Group/GroupDnManagement/index.jsp';
  const EDIT = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
  let dialog = null;
  let stopRequested = false;

  const currentPath = () => document.documentElement.getAttribute('data-cp-path') || location.pathname;
  const normalizedPhone = value => {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    return digits;
  };
  const normalizedLabel = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const cellText = (parent, name) => [...parent.getElementsByTagName(name)]
    .map(element => element.textContent || '').join('');

  function mountButton() {
    if (currentPath() !== LIST || dialog) return;
    const cell = document.querySelector('td[width="82%"]');
    if (!cell || cell.querySelector('#cp-bulk-number-launch')) return;
    const firstOk = cell.querySelector('input[name="ok"]');
    if (!firstOk) return;
    const button = document.createElement('button');
    button.id = 'cp-bulk-number-launch';
    button.type = 'button';
    button.textContent = 'Bulk assign departments';
    button.addEventListener('click', openDialog);
    firstOk.insertAdjacentElement('afterend', button);
  }

  function downloadTemplate() {
    if (typeof window.cpXlsxBuild !== 'function') throw Error('Excel template builder is unavailable.');
    const bytes = window.cpXlsxBuild([{ name: 'Assignments',
      headers: ['Phone Number', 'Department'], rows: [], widths: [23, 34],
      textColumns: [0] }]);
    const blob = new Blob([bytes], { type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Number Department Assignments.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function unzipWorkbook(file) {
    if (file.size > 8 * 1024 * 1024) throw Error('Workbook is larger than 8 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw Error('This is not a valid .xlsx workbook.');
    const count = view.getUint16(end + 10, true);
    if (count > 200 || count === 0xffff) throw Error('Workbook has too many ZIP entries.');
    let offset = view.getUint32(end + 16, true);
    const decoder = new TextDecoder();
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw Error('Invalid workbook ZIP index.');
      const method = view.getUint16(offset + 10, true);
      const compressed = view.getUint32(offset + 20, true);
      const uncompressed = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const local = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      if (uncompressed > 12 * 1024 * 1024) throw Error('Workbook sheet is too large.');
      if (view.getUint32(local, true) !== 0x04034b50)
        throw Error('Invalid workbook ZIP entry.');
      const start = local + 30 + view.getUint16(local + 26, true) +
        view.getUint16(local + 28, true);
      if (start + compressed > bytes.length) throw Error('Incomplete workbook ZIP entry.');
      entries.set(name, { method, data: bytes.slice(start, start + compressed) });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return async name => {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.method === 0) return decoder.decode(entry.data);
      if (entry.method !== 8 || typeof DecompressionStream !== 'function')
        throw Error('This browser cannot read the workbook compression.');
      const stream = new Blob([entry.data]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      return decoder.decode(await new Response(stream).arrayBuffer());
    };
  }

  function parseXml(source, label) {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    if (doc.querySelector('parsererror')) throw Error(`${label} contains invalid XML.`);
    return doc;
  }

  async function readAssignments(file) {
    if (!/\.xlsx$/i.test(file.name)) throw Error('Choose an .xlsx file from the downloaded template.');
    const entry = await unzipWorkbook(file);
    const sharedXml = await entry('xl/sharedStrings.xml');
    const shared = sharedXml ? [...parseXml(sharedXml, 'Shared strings').getElementsByTagName('si')]
      .map(item => cellText(item, 't')) : [];
    const sheetXml = await entry('xl/worksheets/sheet1.xml');
    if (!sheetXml) throw Error('The first worksheet is missing.');
    const sheet = parseXml(sheetXml, 'Assignments worksheet');
    const rows = [];
    for (const row of sheet.getElementsByTagName('row')) {
      const index = Number(row.getAttribute('r'));
      const values = ['', ''];
      for (const cell of row.getElementsByTagName('c')) {
        const reference = cell.getAttribute('r') || '';
        const column = /^([AB])\d+$/i.exec(reference)?.[1]?.toUpperCase();
        if (!column) continue;
        if (cell.getElementsByTagName('f').length) throw Error(`Formula in ${reference}; enter text values.`);
        const type = cell.getAttribute('t');
        let value = type === 's' ? shared[Number(cellText(cell, 'v'))] :
          type === 'inlineStr' ? cellText(cell, 't') : cellText(cell, 'v');
        if (/^\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value || '')) {
          const number = Number(value);
          if (Number.isSafeInteger(number)) value = String(number);
        }
        values[column === 'A' ? 0 : 1] = String(value || '').trim();
      }
      if (index === 1) {
        if (normalizedLabel(values[0]) !== 'phone number' ||
            normalizedLabel(values[1]) !== 'department')
          throw Error('The first row must be Phone Number and Department.');
      } else if (index > 1 && (values[0] || values[1])) {
        rows.push({ line: index, phone: values[0], department: values[1] });
      }
      if (rows.length > 2000) throw Error('Limit each workbook to 2,000 assignments.');
    }
    if (!rows.length) throw Error('The workbook has no assignments. Fill rows under the headers.');
    return rows;
  }

  function waitForReskin(action, timeout = 30000) {
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        document.removeEventListener('cp:reskin', onReskin);
        if (error) reject(error); else setTimeout(resolve, 0);
      };
      const onReskin = () => finish();
      const timer = setTimeout(() => finish(Error('CommPilot did not return a page. Check the result before retrying.')),
        timeout);
      document.addEventListener('cp:reskin', onReskin);
      try { action(); } catch (error) { finish(error); }
    });
  }

  async function navigate(url, params, expected) {
    await waitForReskin(() => window.redirectPost(url, params || {}));
    if (location.pathname !== expected)
      throw Error(`CommPilot opened ${location.pathname} instead of ${expected}.`);
  }

  function formOptions() {
    const select = document.querySelector('td[width="82%"] select[name="deptDropDownList"]');
    if (!select) throw Error('Department selector is missing.');
    return [...select.options].map(option => ({ name: option.textContent.trim(), value: option.value }));
  }

  async function preflightDirect(sourceRows, setStatus) {
    const preview = [];
    const repeated = new Set();
    for (let i = 0; i < sourceRows.length; i++) {
      const input = sourceRows[i];
      const number = normalizedPhone(input.phone);
      const item = { ...input, status: 'ready', error: '', current: '', targetValue: '',
        canonical: '', drill: null };
      if (!number || !input.department) item.error = 'Enter a phone number and department.';
      else if (repeated.has(number)) item.error = 'Phone number appears twice in the workbook.';
      repeated.add(number);
      if (!item.error) {
        setStatus(`Checking workbook number ${i + 1} of ${sourceRows.length}…`);
        const key = number.length === 10 ? `+1-${number}` : input.phone.trim();
        try {
          await navigate(EDIT, { key, P_key: key }, EDIT);
          const source = document.querySelector('select[name="assignedList"]');
          const option = [...(source?.options || [])].find(entry =>
            normalizedPhone(entry.value) === number);
          if (!option) throw Error('Number was not found in this group.');
          const select = document.querySelector('select[name="deptDropDownList"]');
          const departments = formOptions();
          const targets = departments.filter(entry =>
            normalizedLabel(entry.name) === normalizedLabel(input.department) ||
            entry.value === input.department);
          if (targets.length !== 1) throw Error(targets.length ?
            'Department name is ambiguous.' : 'Department was not found.');
          item.canonical = option.value;
          item.current = select.selectedOptions[0]?.textContent.trim() || 'None';
          item.targetValue = targets[0].value;
          item.drill = { url: EDIT, params: { key, P_key: key } };
          if (normalizedLabel(item.current) === normalizedLabel(targets[0].name))
            item.status = 'unchanged';
        } catch (error) { item.error = error.message; item.status = 'error'; }
        if (location.pathname !== LIST) await navigate(LIST, {}, LIST);
      }
      preview.push(item);
    }
    return preview;
  }

  async function preflight(sourceRows, setStatus) {
    if (location.pathname !== LIST) await navigate(LIST, {}, LIST);
    setStatus('Checking the group numbers…');
    if (typeof window.cpListSearch !== 'function') throw Error('Number search is unavailable.');
    let found;
    try { found = await window.cpListSearch([], {}); }
    catch (error) { found = { tooMany: true }; }
    if (found.tooMany) {
      setStatus('The group list is too large; checking the workbook numbers directly…');
      return preflightDirect(sourceRows, setStatus);
    }
    const byNumber = new Map();
    for (const row of found.rows) {
      const key = normalizedPhone(row.cells[0]);
      if (!key || !row.drill || row.drill.url !== EDIT) continue;
      const match = byNumber.get(key) || [];
      match.push(row);
      byNumber.set(key, match);
    }
    if (!byNumber.size) throw Error('No editable group numbers were returned.');
    const first = found.rows.find(row => row.drill?.url === EDIT);
    setStatus('Reading the group departments…');
    await navigate(first.drill.url, first.drill.params, EDIT);
    const departments = formOptions();
    await navigate(LIST, {}, LIST);
    const repeated = new Set();
    const preview = sourceRows.map(input => {
      const item = { ...input, status: 'ready', error: '', current: '', targetValue: '',
        canonical: '', drill: null };
      const number = normalizedPhone(input.phone);
      if (!number || !input.department) item.error = 'Enter a phone number and department.';
      else if (repeated.has(number)) item.error = 'Phone number appears twice in the workbook.';
      repeated.add(number);
      const matches = byNumber.get(number) || [];
      if (!item.error && !matches.length) item.error = 'Number was not found in this group.';
      const keys = new Set(matches.map(row => JSON.stringify(row.drill.params)));
      const current = new Set(matches.map(row => normalizedLabel(row.cells[5])));
      if (!item.error && (keys.size > 1 || current.size > 1))
        item.error = 'Number has multiple different assignments; use the individual Edit page.';
      const options = departments.filter(option =>
        normalizedLabel(option.name) === normalizedLabel(input.department) ||
        option.value === input.department);
      if (!item.error && options.length !== 1)
        item.error = options.length ? 'Department name is ambiguous.' : 'Department was not found.';
      if (item.error) item.status = 'error';
      else {
        item.current = matches[0].cells[5] || 'None';
        item.targetValue = options[0].value;
        item.canonical = matches[0].cells[0];
        item.drill = matches[0].drill;
        if (normalizedLabel(item.current) === normalizedLabel(options[0].name))
          item.status = 'unchanged';
      }
      return item;
    });
    return preview;
  }

  async function applyOne(item) {
    await navigate(item.drill.url, item.drill.params, EDIT);
    const form = document.forms.mainForm;
    const dept = form?.elements.deptDropDownList;
    const source = form?.elements.assignedList;
    if (!form || !dept || !source || !form.elements.toAdd || !form.elements.action)
      throw Error('Assign Numbers form is missing a required control.');
    const target = [...dept.options].find(option => option.value === item.targetValue);
    if (!target) throw Error('Department changed since preview.');
    const number = [...source.options].find(option => option.value === item.canonical);
    if (!number) throw Error('Number changed since preview.');
    dept.value = item.targetValue;
    number.selected = true;
    form.elements.toAdd.value = item.canonical;
    form.elements.action.value = 'add';
    await waitForReskin(() => form.requestSubmit());
    const staged = document.querySelector('select[name="unassignList"]');
    if (location.pathname !== EDIT || !staged ||
        ![...staged.options].some(option => option.value === item.canonical))
      throw Error('CommPilot did not stage this number.');
    const apply = document.querySelector('form[name="mainForm"] input[name="apply"]');
    if (!apply) throw Error('Apply button is missing.');
    await waitForReskin(() => apply.click());
    const content = document.querySelector('td[width="82%"]')?.innerText || '';
    if (location.pathname !== EDIT || !/\bSaved\b/.test(content) ||
        /\b(?:Failed|An error occurred)\b/i.test(content))
      throw Error('CommPilot did not confirm the save.');
  }

  function openDialog() {
    if (dialog) return;
    stopRequested = false;
    const overlay = document.createElement('div');
    overlay.className = 'cp-bulk-overlay';
    overlay.innerHTML = `<div class="cp-bulk-dialog" role="dialog" aria-modal="true"
      aria-labelledby="cp-bulk-title"><h2 id="cp-bulk-title">Bulk assign number departments</h2>
      <p>Fill one row per group number. Enter the department name exactly as it appears in CommPilot.
      Use <b>None</b> to clear a department.</p>
      <div class="cp-bulk-actions"><button type="button" data-action="template">Download blank Excel template</button>
      <label class="cp-bulk-file">Choose filled Excel file<input type="file" accept=".xlsx"></label></div>
      <p class="cp-bulk-status" role="status">Download the template, fill it, then choose the file.</p>
      <div class="cp-bulk-preview"></div>
      <div class="cp-bulk-footer"><button type="button" data-action="apply" disabled>Apply assignments</button>
      <button type="button" data-action="close">Close</button></div></div>`;
    document.body.appendChild(overlay);
    dialog = overlay;
    let preview = [];
    let working = false;
    const status = overlay.querySelector('.cp-bulk-status');
    const table = overlay.querySelector('.cp-bulk-preview');
    const apply = overlay.querySelector('[data-action="apply"]');
    const close = overlay.querySelector('[data-action="close"]');
    const setStatus = message => { status.textContent = message; };
    const render = () => {
      table.replaceChildren();
      if (!preview.length) return;
      const counts = { ready: 0, unchanged: 0, error: 0, done: 0 };
      preview.forEach(item => { counts[item.status] = (counts[item.status] || 0) + 1; });
      const summary = document.createElement('p');
      summary.textContent = `${counts.ready} to change · ${counts.unchanged} already correct · ${counts.error} errors · ${counts.done} saved`;
      table.appendChild(summary);
      const grid = document.createElement('table');
      grid.innerHTML = '<thead><tr><th>Row</th><th>Phone Number</th><th>Current</th><th>Department</th><th>Result</th></tr></thead>';
      const body = document.createElement('tbody');
      preview.slice(0, 200).forEach(item => {
        const tr = document.createElement('tr');
        [item.line, item.phone, item.current || '—', item.department,
          item.error || ({ ready: 'Ready', unchanged: 'Already correct', done: 'Saved' }[item.status] || item.status)]
          .forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
        if (item.status === 'error') tr.className = 'cp-bulk-error';
        body.appendChild(tr);
      });
      grid.appendChild(body);
      table.appendChild(grid);
      if (preview.length > 200) {
        const note = document.createElement('p');
        note.textContent = `Showing the first 200 of ${preview.length} rows.`;
        table.appendChild(note);
      }
      apply.disabled = working || !counts.ready || !!counts.error;
    };
    overlay.querySelector('[data-action="template"]').addEventListener('click', () => {
      try { downloadTemplate(); } catch (error) { setStatus(error.message); }
    });
    overlay.querySelector('input[type="file"]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file || working) return;
      working = true;
      close.disabled = true;
      apply.disabled = true;
      preview = [];
      render();
      try {
        setStatus('Reading the workbook…');
        const rows = await readAssignments(file);
        preview = await preflight(rows, setStatus);
        const errors = preview.filter(item => item.status === 'error').length;
        setStatus(errors ? `Fix ${errors} row${errors === 1 ? '' : 's'} in the workbook and choose it again.` :
          'Review the changes, then choose Apply assignments.');
      } catch (error) { setStatus(error.message); }
      finally { working = false; close.disabled = false; render(); }
    });
    apply.addEventListener('click', async () => {
      if (working || preview.some(item => item.status === 'error')) return;
      working = true;
      stopRequested = false;
      render();
      close.textContent = 'Stop after current number';
      const targets = preview.filter(item => item.status === 'ready');
      let saved = 0;
      try {
        for (const item of targets) {
          if (stopRequested) break;
          setStatus(`Saving ${saved + 1} of ${targets.length}: ${item.canonical}…`);
          try {
            await applyOne(item);
            item.status = 'done';
            saved++;
            render();
          } catch (error) {
            item.status = 'error';
            item.error = error.message;
            render();
            throw error;
          }
        }
        setStatus(stopRequested ? `Stopped after ${saved} saved assignment${saved === 1 ? '' : 's'}.` :
          `Saved ${saved} assignment${saved === 1 ? '' : 's'}.`);
      } catch (error) { setStatus(`Stopped: ${error.message} ${saved} saved before this error.`); }
      finally {
        working = false;
        close.textContent = 'Close';
        try { await navigate(LIST, {}, LIST); } catch (error) { /* Show result above. */ }
        render();
      }
    });
    close.addEventListener('click', () => {
      if (working) { stopRequested = true; setStatus('Stopping after the current number…'); return; }
      overlay.remove();
      dialog = null;
      mountButton();
    });
  }

  document.addEventListener('cp:reskin', () => setTimeout(mountButton, 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();
})();
