/* Group Numbers: preview and apply department assignments from an Excel workbook. */
(function () {
  if (window !== window.top || window.__cpNumberBulkLoaded) return;
  window.__cpNumberBulkLoaded = true;

  const LIST = '/commpilot/Group/GroupDnManagement/index.jsp';
  const EDIT = '/commpilot/Group/GroupDnManagement/Nested/index.jsp';
  let dialog = null;
  let stopRequested = false;
  const knownCountryCodes = new Set();

  const currentPath = () => document.documentElement.getAttribute('data-cp-path') || location.pathname;
  const normalizedPhone = value => {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    return digits;
  };
  const normalizedLabel = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  function numberDepartment(row) {
    // A blank native cell means None; an absent cell is incomplete evidence.
    if (!Array.isArray(row?.cells) || typeof row.cells[5] !== 'string')
      throw Error('The Numbers result is missing its Department column. Reload the Numbers page and try again.');
    return row.cells[5].trim() || 'None';
  }
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
      headers: ['Phone Number', 'Department', 'Range End'], rows: [], widths: [23, 34, 23],
      textColumns: [0, 2] }]);
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
      // The ZIP directory's uncompressed size can be incorrect. Bound the actual output before XML
      // parsing so a tiny upload cannot expand into an unbounded allocation and stall this tab.
      const reader = stream.getReader(), text = new TextDecoder(), chunks = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 12 * 1024 * 1024) {
            await reader.cancel();
            throw Error('Workbook sheet is too large.');
          }
          chunks.push(text.decode(value, { stream: true }));
        }
        chunks.push(text.decode());
        return chunks.join('');
      } finally { reader.releaseLock(); }
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
    let headersSeen = false;
    for (const row of sheet.getElementsByTagName('row')) {
      const index = Number(row.getAttribute('r'));
      const values = ['', '', ''];
      for (const cell of row.getElementsByTagName('c')) {
        const reference = cell.getAttribute('r') || '';
        const column = /^([ABC])\d+$/i.exec(reference)?.[1]?.toUpperCase();
        if (!column) continue;
        if (cell.getElementsByTagName('f').length) throw Error(`Formula in ${reference}; enter text values.`);
        const type = cell.getAttribute('t');
        if (type && !['n', 's', 'inlineStr', 'str'].includes(type))
          throw Error(`Cell ${reference} must contain text or a number, not a boolean, date, or error.`);
        if (type === 's') {
          const index = cellText(cell, 'v').trim();
          if (!/^\d+$/.test(index) || !Number.isSafeInteger(Number(index)) || Number(index) >= shared.length)
            throw Error(`Cell ${reference} refers to a missing shared string. Re-save the workbook and try again.`);
        }
        let value = type === 's' ? shared[Number(cellText(cell, 'v'))] :
          type === 'inlineStr' ? cellText(cell, 't') : cellText(cell, 'v');
        if (/^\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value || '')) {
          const number = Number(value);
          if (Number.isSafeInteger(number)) value = String(number);
        }
        values['ABC'.indexOf(column)] = String(value || '').trim();
      }
      if (index === 1) {
        if (normalizedLabel(values[0]) !== 'phone number' ||
            normalizedLabel(values[1]) !== 'department' ||
            (values[2] && normalizedLabel(values[2]) !== 'range end'))
          throw Error('The first row must be Phone Number, Department, and optional Range End.');
        headersSeen = true;
      } else if (index > 1 && values.some(Boolean)) {
        rows.push({ line: index, phone: values[0], department: values[1], rangeEnd: values[2] });
      }
      if (rows.length > 2000) throw Error('Limit each workbook to 2,000 assignments.');
    }
    if (!headersSeen) throw Error('The first worksheet has no assignment headers.');
    if (!rows.length) throw Error('The workbook has no assignments. Fill rows under the headers.');
    const expanded = [];
    const phoneLike = /^[+]?\d[\d\s().-]*$/;
    for (const row of rows) {
      if (row.phone && !phoneLike.test(row.phone))
        throw Error(`Row ${row.line}: Phone Number must contain only phone digits and punctuation.`);
      if (!row.rangeEnd) { expanded.push(row); continue; }
      if (!phoneLike.test(row.phone) || !phoneLike.test(row.rangeEnd))
        throw Error(`Row ${row.line}: enter full phone numbers for both ends of the range.`);
      const first = normalizedPhone(row.phone);
      const last = normalizedPhone(row.rangeEnd);
      if (first.length !== last.length || first.length < 7 || first.length > 15)
        throw Error(`Row ${row.line}: both range endpoints must have the same number length.`);
      const count = BigInt(last) - BigInt(first) + 1n;
      if (count < 1n) throw Error(`Row ${row.line}: Range End comes before Phone Number.`);
      if (count > 2000n || BigInt(expanded.length) + count > 2000n)
        throw Error(`Row ${row.line}: the workbook exceeds the 2,000-number limit.`);
      for (let i = 0; i < Number(count); i++) {
        const digits = (BigInt(first) + BigInt(i)).toString().padStart(first.length, '0');
        expanded.push({ line: `${row.line} (${i + 1}/${count})`,
          phone: digits.length === 10 ? `+1-${digits}` : `+${digits}`,
          department: row.department });
      }
    }
    if (expanded.length > 2000) throw Error('The workbook exceeds the 2,000-number limit.');
    return expanded;
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

  async function lookupNumberRows(phone) {
    const digits = normalizedPhone(phone);
    const exact = digits.length === 10 ? `+1-${digits}` : String(phone).trim();
    const criteria = [];
    const add = (op, value) => {
      if (!criteria.some(item => item.op === op && item.value === value))
        criteria.push({ key: 'Dn', op, value });
    };
    add('EQUAL_TO', exact);
    // International DNs are commonly stored as +<country code>-<national number>.
    // Country codes have 1–3 digits. Try each exact spelling before a suffix
    // search; always compare the returned full DN by digits before accepting it.
    for (const code of knownCountryCodes) if (digits.startsWith(code))
      add('EQUAL_TO', `+${code}-${digits.slice(code.length)}`);
    for (const length of [1, 2, 3]) if (digits.length > length + 3)
      add('EQUAL_TO', `+${digits.slice(0, length)}-${digits.slice(length)}`);
    for (const length of [10, 9, 8, 7]) if (digits.length >= length)
      add('CONTAINS', digits.slice(-length));
    let successfulSearch = false;
    let tooMany = false;
    for (const criterion of criteria) {
      try {
        const found = await window.cpListSearch([criterion], {});
        if (found.tooMany) { tooMany = true; continue; }
        successfulSearch = true;
        const matches = found.rows.filter(row =>
          normalizedPhone(row.cells[0]) === digits && row.drill?.url === EDIT);
        if (matches.length) {
          const countryCode = /^\+(\d{1,3})-/.exec(matches[0].cells[0])?.[1];
          if (countryCode) knownCountryCodes.add(countryCode);
          return matches;
        }
      } catch (error) {
        // Only a successful empty search warrants trying another number format.
        // A failed read must remain an error, not become "not found" after more POSTs.
        throw Error('CommPilot could not complete the number lookup. ' + (error.message || 'Try again after checking the connection.'));
      }
    }
    if (tooMany) throw Error('CommPilot returned too many matches for this number. Use its full system format.');
    if (!successfulSearch) throw Error('CommPilot could not complete a number lookup.');
    return [];
  }

  async function preflightDirect(sourceRows, setStatus, setProgress) {
    const preview = [];
    const repeated = new Set();
    let departments;
    for (let i = 0; i < sourceRows.length; i++) {
      const input = sourceRows[i];
      const number = normalizedPhone(input.phone);
      const item = { ...input, status: 'ready', error: '', current: '', after: '',
        targetValue: '', targetName: '', canonical: '', drill: null };
      if (!number || !input.department) item.error = 'Enter a phone number and department.';
      else if (repeated.has(number)) item.error = 'Phone number appears twice in the workbook.';
      repeated.add(number);
      if (!item.error) {
        setStatus(`Checking workbook number ${i + 1} of ${sourceRows.length}…`);
        setProgress('Checking numbers', i, sourceRows.length, `Row ${input.line}: ${input.phone}`);
        try {
          const matches = await lookupNumberRows(input.phone);
          if (!matches.length) throw Error('Number was not found in this group.');
          const departmentsSeen = new Set(matches.map(row => normalizedLabel(numberDepartment(row))));
          const drillKeys = new Set(matches.map(row => JSON.stringify(row.drill.params)));
          if (departmentsSeen.size !== 1 || drillKeys.size !== 1)
            throw Error('Number has conflicting department assignments.');
          const match = matches[0];
          // These choices belong to the group. Read them once per preview;
          // applyOne still reopens and checks the live selector before each save.
          if (!departments) {
            await navigate(match.drill.url, match.drill.params, EDIT);
            departments = formOptions();
          }
          const targets = departments.filter(entry =>
            normalizedLabel(entry.name) === normalizedLabel(input.department) ||
            entry.value === input.department);
          if (targets.length !== 1) throw Error(targets.length ?
            'Department name is ambiguous.' : 'Department was not found.');
          item.canonical = match.cells[0];
          item.current = numberDepartment(match);
          item.targetValue = targets[0].value;
          item.targetName = targets[0].name;
          item.drill = match.drill;
          if (normalizedLabel(item.current) === normalizedLabel(targets[0].name))
            item.status = 'unchanged';
        } catch (error) { item.error = error.message; item.status = 'error'; }
        if (location.pathname !== LIST) await navigate(LIST, {}, LIST);
      }
      preview.push(item);
      setProgress('Checking numbers', i + 1, sourceRows.length,
        `Checked row ${input.line}: ${input.phone}`);
    }
    return preview;
  }

  async function preflight(sourceRows, setStatus, setProgress) {
    if (location.pathname !== LIST) await navigate(LIST, {}, LIST);
    setStatus('Checking the group numbers…');
    setProgress('Loading group numbers', 0, 0, 'CommPilot is searching across the group.');
    if (typeof window.cpListSearch !== 'function') throw Error('Number search is unavailable.');
    let found;
    try { found = await window.cpListSearch([], {}); }
    catch (error) { found = { tooMany: true }; }
    if (found.tooMany) {
      setStatus('The group list is too large; checking the workbook numbers directly…');
      return preflightDirect(sourceRows, setStatus, setProgress);
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
    setProgress('Checking departments', 0, 0, `${found.rows.length} group number rows loaded.`);
    await navigate(first.drill.url, first.drill.params, EDIT);
    const departments = formOptions();
    await navigate(LIST, {}, LIST);
    const repeated = new Set();
    const preview = sourceRows.map((input, index) => {
      const item = { ...input, status: 'ready', error: '', current: '', after: '',
        targetValue: '', targetName: '', canonical: '', drill: null };
      const number = normalizedPhone(input.phone);
      if (!number || !input.department) item.error = 'Enter a phone number and department.';
      else if (repeated.has(number)) item.error = 'Phone number appears twice in the workbook.';
      repeated.add(number);
      const matches = byNumber.get(number) || [];
      if (!item.error && !matches.length) item.error = 'Number was not found in this group.';
      const keys = new Set(matches.map(row => JSON.stringify(row.drill.params)));
      const current = new Set(matches.map(row => normalizedLabel(numberDepartment(row))));
      if (!item.error && (keys.size > 1 || current.size > 1))
        item.error = 'Number has multiple different assignments; use the individual Edit page.';
      const options = departments.filter(option =>
        normalizedLabel(option.name) === normalizedLabel(input.department) ||
        option.value === input.department);
      if (!item.error && options.length !== 1)
        item.error = options.length ? 'Department name is ambiguous.' : 'Department was not found.';
      if (item.error) item.status = 'error';
      else {
        item.current = numberDepartment(matches[0]);
        item.targetValue = options[0].value;
        item.targetName = options[0].name;
        item.canonical = matches[0].cells[0];
        item.drill = matches[0].drill;
        if (normalizedLabel(item.current) === normalizedLabel(options[0].name))
          item.status = 'unchanged';
      }
      setProgress('Checking workbook rows', index + 1, sourceRows.length,
        `Checked row ${input.line}: ${input.phone}`);
      return item;
    });
    return preview;
  }

  async function applyOne(item, onStage) {
    // The Edit page's selected department is a pick-list context, not a readback
    // of this number. Re-read the Numbers list before each save instead.
    onStage('Checking current department');
    if (location.pathname !== LIST) await navigate(LIST, {}, LIST);
    const matches = await lookupNumberRows(item.canonical);
    if (!matches.length) throw Error('Number was not found during the save-time check.');
    const departments = new Set(matches.map(row => normalizedLabel(numberDepartment(row))));
    const drillKeys = new Set(matches.map(row => JSON.stringify(row.drill.params)));
    if (departments.size !== 1 || drillKeys.size !== 1)
      throw Error('Number has conflicting assignments during the save-time check.');
    const liveCurrent = numberDepartment(matches[0]);
    if (normalizedLabel(liveCurrent) === normalizedLabel(item.targetName)) {
      item.after = liveCurrent;
      return 'unchanged';
    }
    if (normalizedLabel(liveCurrent) !== normalizedLabel(item.current))
      throw Error(`Number now belongs to ${liveCurrent}, but preview showed ${item.current}. ` +
        'Check this row and upload the workbook again.');
    onStage('Opening number');
    await navigate(matches[0].drill.url, matches[0].drill.params, EDIT);
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
    onStage('Staging department');
    await waitForReskin(() => form.requestSubmit());
    const staged = document.querySelector('select[name="unassignList"]');
    if (location.pathname !== EDIT || !staged ||
        ![...staged.options].some(option => option.value === item.canonical))
      throw Error('CommPilot did not stage this number.');
    const apply = document.querySelector('form[name="mainForm"] input[name="apply"]');
    if (!apply) throw Error('Apply button is missing.');
    onStage('Saving in CommPilot');
    await waitForReskin(() => apply.click());
    const content = document.querySelector('td[width="82%"]')?.innerText || '';
    if (location.pathname !== EDIT || !/\bSaved\b/.test(content) ||
        /\b(?:Failed|An error occurred)\b/i.test(content))
      throw Error('CommPilot did not confirm the save.');
    return 'submitted';
  }

  async function verifySaved(items, setProgress) {
    if (!items.length) return { verified: 0, errors: 0, unverified: 0 };
    // The Edit form's department selection is driven by its navigation parameters.
    // Read the fresh Numbers list to verify persisted values independently.
    setProgress('Reading back results', 0, items.length,
      'Checking CommPilot’s number list after the saves.');
    if (location.pathname !== LIST) {
      try { await navigate(LIST, {}, LIST); }
      catch (error) {
        items.forEach(item => { item.status = 'unverified'; item.error =
          'CommPilot accepted the save, but the Numbers page could not reopen.'; });
        return { verified: 0, errors: 0, unverified: items.length };
      }
    }
    let byNumber = null;
    try {
      const found = await window.cpListSearch([], {});
      if (!found.tooMany) {
        byNumber = new Map();
        for (const row of found.rows) {
          const number = normalizedPhone(row.cells[0]);
          const matches = byNumber.get(number) || [];
          matches.push(row);
          byNumber.set(number, matches);
        }
      }
    } catch (error) { /* An exact lookup below can still verify each number. */ }
    let verified = 0, errors = 0, unverified = 0;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      try {
        let matches = byNumber?.get(normalizedPhone(item.canonical));
        if (!byNumber) {
          setProgress('Verifying number', index, items.length, item.canonical);
          matches = await lookupNumberRows(item.canonical);
        }
        matches = matches || [];
        const departments = new Set(matches.map(numberDepartment));
        if (!matches.length || departments.size !== 1) {
          item.status = 'error';
          item.error = matches.length ? 'CommPilot returned conflicting departments after save.' :
            'Number was not found during readback.';
          errors++;
        } else {
          item.after = [...departments][0];
          if (normalizedLabel(item.after) === normalizedLabel(item.targetName)) {
            item.status = 'done';
            verified++;
          } else {
            item.status = 'error';
            item.error = `CommPilot shows ${item.after} after save, not ${item.targetName}.`;
            errors++;
          }
        }
      } catch (error) {
        item.status = 'unverified';
        item.error = `CommPilot accepted the save, but readback was unavailable: ${error.message}`;
        unverified++;
      }
      setProgress('Verifying results', index + 1, items.length,
        `Row ${item.line} · ${item.canonical}: ${item.status === 'done' ? 'verified' : item.error}`);
    }
    return { verified, errors, unverified };
  }

  function openDialog() {
    if (dialog) return;
    stopRequested = false;
    const overlay = document.createElement('div');
    overlay.className = 'cp-bulk-overlay';
    overlay.innerHTML = `<div class="cp-bulk-dialog" role="dialog" aria-modal="true"
      aria-labelledby="cp-bulk-title"><h2 id="cp-bulk-title">Bulk assign number departments</h2>
      <p>Enter the department name as it appears in CommPilot. Full international numbers may be
      entered as digits or in CommPilot's +country-code-number format. Leave Range End blank for one
      number, or enter the last number of an inclusive range. Use <b>None</b> to clear a department.</p>
      <div class="cp-bulk-actions"><button type="button" data-action="template">Download blank Excel template</button>
      <label class="cp-bulk-file">Choose filled Excel file<input type="file" accept=".xlsx"></label></div>
      <p class="cp-bulk-status" role="status">Download the template, fill it, then choose the file.</p>
      <div class="cp-bulk-progress" hidden><div class="cp-bulk-progress-head">
      <span data-progress-phase></span><strong data-progress-count></strong></div>
      <progress max="100" value="0"></progress><div data-progress-detail></div></div>
      <div class="cp-bulk-preview"></div>
      <div class="cp-bulk-footer"><button type="button" data-action="apply" disabled>Apply assignments</button>
      <button type="button" data-action="close">Close</button></div></div>`;
    document.body.appendChild(overlay);
    const releaseFocus = window.cpFocusBulkDialog(overlay);
    dialog = overlay;
    let preview = [];
    let working = false;
    const status = overlay.querySelector('.cp-bulk-status');
    const table = overlay.querySelector('.cp-bulk-preview');
    const apply = overlay.querySelector('[data-action="apply"]');
    const close = overlay.querySelector('[data-action="close"]');
    const progress = overlay.querySelector('.cp-bulk-progress');
    const progressBar = progress.querySelector('progress');
    let previewPage = 0;
    const setStatus = message => { status.textContent = message; };
    const setProgress = (phase, done, total, detail) => {
      progress.hidden = false;
      progress.querySelector('[data-progress-phase]').textContent = phase;
      progress.querySelector('[data-progress-detail]').textContent = detail || '';
      progress.querySelector('[data-progress-count]').textContent = total ?
        `${done} / ${total} (${Math.round(done * 100 / total)}%)` : 'Working…';
      if (total) progressBar.value = Math.round(done * 100 / total);
      else progressBar.removeAttribute('value');
    };
    const render = () => {
      table.replaceChildren();
      if (!preview.length) return;
      const counts = { ready: 0, unchanged: 0, error: 0, done: 0,
        submitted: 0, unverified: 0 };
      preview.forEach(item => { counts[item.status] = (counts[item.status] || 0) + 1; });
      const summary = document.createElement('p');
      summary.textContent = `${counts.ready} to change · ${counts.unchanged} already correct · ` +
        `${counts.error} errors · ${counts.done} verified · ${counts.unverified} unverified`;
      table.appendChild(summary);
      const grid = document.createElement('table');
      grid.innerHTML = '<thead><tr><th>Row</th><th>Phone Number</th><th>Before</th><th>Requested</th><th>After</th><th>Result</th></tr></thead>';
      const body = document.createElement('tbody');
      const ordered = preview.length > 100 ?
        [...preview.filter(item => item.status === 'error'),
          ...preview.filter(item => item.status !== 'error')] : preview;
      const pageSize = 100;
      const pageCount = Math.ceil(ordered.length / pageSize);
      previewPage = Math.min(previewPage, Math.max(0, pageCount - 1));
      const first = previewPage * pageSize;
      ordered.slice(first, first + pageSize).forEach(item => {
        const tr = document.createElement('tr');
        [item.line, item.phone, item.current || '—', item.targetName || item.department,
          item.after || (item.status === 'unchanged' ? item.current : '—'),
          item.error || ({ ready: 'Ready', unchanged: 'Already correct',
            submitted: 'Saved; checking', done: 'Verified', unverified: 'Readback unavailable' }
          [item.status] || item.status)]
          .forEach(value => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); });
        if (item.status === 'error' || item.status === 'unverified') tr.className = 'cp-bulk-error';
        else if (item.status === 'done') tr.className = 'cp-bulk-verified';
        body.appendChild(tr);
      });
      grid.appendChild(body);
      table.appendChild(grid);
      if (pageCount > 1) {
        const pages = document.createElement('div');
        pages.className = 'cp-bulk-pages';
        const previous = document.createElement('button');
        previous.type = 'button'; previous.textContent = 'Previous';
        previous.disabled = previewPage === 0;
        previous.addEventListener('click', () => { previewPage--; render(); });
        const label = document.createElement('span');
        label.textContent = `Numbers ${first + 1}–${Math.min(first + pageSize, ordered.length)} ` +
          `of ${ordered.length} · page ${previewPage + 1} of ${pageCount}` +
          (counts.error ? ' · errors first' : '');
        const next = document.createElement('button');
        next.type = 'button'; next.textContent = 'Next';
        next.disabled = previewPage >= pageCount - 1;
        next.addEventListener('click', () => { previewPage++; render(); });
        pages.append(previous, label, next);
        table.appendChild(pages);
      }
      apply.disabled = working || !counts.ready || !!counts.error || !!counts.unverified;
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
      previewPage = 0;
      render();
      try {
        setStatus('Reading the workbook…');
        setProgress('Reading workbook', 0, 0, file.name);
        const rows = await readAssignments(file);
        preview = await preflight(rows, setStatus, setProgress);
        const errors = preview.filter(item => item.status === 'error').length;
        const changes = preview.filter(item => item.status === 'ready').length;
        setProgress('Preflight complete', rows.length, rows.length,
          `${changes} to change · ${rows.length - errors - changes} already correct · ${errors} error${errors === 1 ? '' : 's'}`);
        setStatus(errors ? `Fix ${errors} number${errors === 1 ? '' : 's'} in the workbook or ranges, then choose it again.` :
          changes ? 'Review the changes, then choose Apply assignments.' :
            'All requested numbers are already in the selected departments.');
      } catch (error) { setStatus(error.message);
        setProgress('Preflight stopped', 0, 0, error.message); }
      finally { event.target.value = ''; working = false; close.disabled = false; render(); }
    });
    apply.addEventListener('click', async () => {
      if (working || preview.some(item => item.status === 'error')) return;
      working = true;
      stopRequested = false;
      render();
      close.textContent = 'Stop after current number';
      const targets = preview.filter(item => item.status === 'ready');
      let submitted = 0;
      let processed = 0;
      let alreadyCorrectDuringApply = 0;
      let saveError = null;
      try {
        for (const item of targets) {
          if (stopRequested) break;
          setStatus(`Saving ${processed + 1} of ${targets.length}: ${item.canonical}…`);
          setProgress('Applying assignments', processed, targets.length,
            `Row ${item.line} · ${item.canonical}: opening`);
          try {
            const result = await applyOne(item, stage => setProgress('Applying assignments', processed,
              targets.length, `Row ${item.line} · ${item.canonical}: ${stage}`));
            item.status = result;
            if (result === 'submitted') submitted++;
            else alreadyCorrectDuringApply++;
            processed++;
            setProgress('Applying assignments', processed, targets.length,
              `Row ${item.line} · ${item.canonical}: ` +
              (result === 'submitted' ? 'CommPilot accepted the save' : 'Already correct at save time'));
            render();
          } catch (error) {
            item.status = 'error';
            item.error = error.message;
            render();
            saveError = Error(`Row ${item.line} · ${item.canonical}: ${error.message}`);
            break;
          }
        }
        const checked = await verifySaved(targets.filter(item => item.status === 'submitted'), setProgress);
        render();
        if (saveError) setStatus(`Stopped: ${saveError.message} ${checked.verified} earlier assignment${checked.verified === 1 ? '' : 's'} verified.`);
        else if (checked.errors) setStatus(`${checked.verified} verified; ${checked.errors} did not match CommPilot’s readback.`);
        else if (checked.unverified) setStatus(`CommPilot accepted ${submitted} save${submitted === 1 ? '' : 's'}, but readback was unavailable. Check the results before retrying.`);
        else setStatus(stopRequested ? `Stopped after ${checked.verified} verified assignment${checked.verified === 1 ? '' : 's'}.` :
          `Verified ${checked.verified} assignment${checked.verified === 1 ? '' : 's'}.` +
          (alreadyCorrectDuringApply ? ` ${alreadyCorrectDuringApply} already correct at save time.` : '') +
          ' Review Before and After below.');
        setProgress(saveError || checked.errors || checked.unverified || stopRequested ? 'Stopped' : 'Complete',
          checked.verified + alreadyCorrectDuringApply, targets.length,
          saveError ? saveError.message : checked.unverified ? 'Readback unavailable.' :
            checked.errors ? 'One or more saved values did not match.' : 'Before and After results are shown below.');
      } catch (error) { setStatus(`Stopped: ${error.message} Check results before retrying.`);
        setProgress('Stopped on an error', submitted, targets.length, error.message); }
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
      releaseFocus();
      dialog = null;
      mountButton();
    });
  }

  document.addEventListener('cp:reskin', () => setTimeout(mountButton, 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();
})();
