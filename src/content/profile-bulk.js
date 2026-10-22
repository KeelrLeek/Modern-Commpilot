/* Group Identity/Device Profiles: preview and delete unused profiles by extension. */
(function () {
  if (window !== window.top || window.__cpProfileBulkLoaded) return;
  window.__cpProfileBulkLoaded = true;

  const LIST = '/commpilot/Group/DeviceInventory/';
  const PROFILE = '/commpilot/Group/DeviceInventory/Modify/Profile/index.jsp';
  const USERS = '/commpilot/Group/DeviceInventory/Modify/Users/';
  let dialog = null;
  let stopRequested = false;
  const path = () => document.documentElement.getAttribute('data-cp-path') || location.pathname;
  const content = () => document.querySelector('td[width="82%"]');

  function mountButton() {
    if (path() !== LIST || dialog) return;
    const cell = content();
    if (!cell || cell.querySelector('#cp-bulk-profile-launch')) return;
    const beside = cell.querySelector('input[name="add"], input[name="ok"]');
    if (!beside) return;
    const button = document.createElement('button');
    button.id = 'cp-bulk-profile-launch';
    button.type = 'button';
    button.textContent = 'Clean up unused profiles';
    button.addEventListener('click', openDialog);
    beside.insertAdjacentElement('afterend', button);
  }

  function downloadTemplate() {
    if (typeof window.cpXlsxBuild !== 'function') throw Error('Excel template builder is unavailable.');
    const bytes = window.cpXlsxBuild([{ name: 'Extensions', headers: ['Extension'],
      rows: [], widths: [22], textColumns: [0] }]);
    const blob = new Blob([bytes], { type:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Unused Device Profile Extensions.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  async function readExtensions(file) {
    if (!/\.xlsx$/i.test(file.name)) throw Error('Choose an .xlsx file from the downloaded template.');
    if (file.size > 8 * 1024 * 1024) throw Error('Workbook is larger than 8 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw Error('This is not a valid .xlsx workbook.');
    const count = view.getUint16(end + 10, true);
    if (!count || count > 200 || count === 0xffff) throw Error('Workbook has too many ZIP entries.');
    let offset = view.getUint32(end + 16, true);
    const entries = new Map();
    const decoder = new TextDecoder();
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
      if (uncompressed > 12 * 1024 * 1024 || view.getUint32(local, true) !== 0x04034b50)
        throw Error('Invalid workbook ZIP entry.');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      if (start + compressed > bytes.length) throw Error('Incomplete workbook ZIP entry.');
      entries.set(name, { method, data: bytes.slice(start, start + compressed) });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    const entry = async name => {
      const item = entries.get(name);
      if (!item) return null;
      if (item.method === 0) return decoder.decode(item.data);
      if (item.method !== 8 || typeof DecompressionStream !== 'function')
        throw Error('This browser cannot read the workbook compression.');
      const stream = new Blob([item.data]).stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      // Bound actual decompression, not just the size claimed by the ZIP directory.
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
    const xml = (source, label) => {
      const doc = new DOMParser().parseFromString(source, 'application/xml');
      if (doc.querySelector('parsererror')) throw Error(`${label} contains invalid XML.`);
      return doc;
    };
    const cellText = (parent, tag) => [...parent.getElementsByTagName(tag)]
      .map(element => element.textContent || '').join('');
    const sharedXml = await entry('xl/sharedStrings.xml');
    const shared = sharedXml ? [...xml(sharedXml, 'Shared strings').getElementsByTagName('si')]
      .map(item => cellText(item, 't')) : [];
    const sheetXml = await entry('xl/worksheets/sheet1.xml');
    if (!sheetXml) throw Error('The first worksheet is missing.');
    const rows = [];
    let header = false;
    for (const row of xml(sheetXml, 'Extensions worksheet').getElementsByTagName('row')) {
      const line = Number(row.getAttribute('r'));
      const cell = [...row.getElementsByTagName('c')]
        .find(item => /^A\d+$/i.test(item.getAttribute('r') || ''));
      if (!cell) continue;
      if (cell.getElementsByTagName('f').length) throw Error(`Formula in A${line}; enter text values.`);
      const type = cell.getAttribute('t');
      if (type && !['n', 's', 'inlineStr', 'str'].includes(type))
        throw Error(`Cell A${line} must contain text or a number, not a boolean, date, or error.`);
      if (type === 's') {
        const index = cellText(cell, 'v').trim();
        if (!/^\d+$/.test(index) || !Number.isSafeInteger(Number(index)) || Number(index) >= shared.length)
          throw Error(`Cell A${line} refers to a missing shared string. Re-save the workbook and try again.`);
      }
      let value = type === 's' ? shared[Number(cellText(cell, 'v'))] :
        type === 'inlineStr' ? cellText(cell, 't') : cellText(cell, 'v');
      if (/^\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value || '') && Number.isSafeInteger(Number(value)))
        value = String(Number(value));
      value = String(value || '').trim();
      if (line === 1) {
        if (value.toLowerCase() !== 'extension') throw Error('Cell A1 must say Extension.');
        header = true;
      } else if (value) rows.push({ line, extension: value });
      if (rows.length > 2000) throw Error('Limit each workbook to 2,000 extensions.');
    }
    if (!header) throw Error('The first worksheet needs an Extension header in A1.');
    if (!rows.length) throw Error('The workbook has no extensions.');
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
      const deadline = () => {
        if (window.cpHasPendingNativeRequest?.()) { timer = setTimeout(deadline, 250); return; }
        finish(Error('CommPilot did not return a page. Check this profile before retrying.'));
      };
      let timer = setTimeout(deadline, timeout);
      document.addEventListener('cp:reskin', onReskin);
      try { action(); } catch (error) { finish(error); }
    });
  }

  async function navigate(url, params, expected) {
    await waitForReskin(() => window.redirectPost(url, params || {}));
    if (location.pathname !== expected)
      throw Error(`CommPilot opened ${location.pathname} instead of ${expected}.`);
  }

  async function searchProfiles(op, value) {
    if (location.pathname !== LIST) await navigate(LIST, {}, LIST);
    const found = await window.cpListSearch([{ key: 'DeviceName', op, value }], {});
    if (found.tooMany) throw Error(`CommPilot returned too many profile names for ${value}.`);
    const matches = found.rows.filter(row =>
      op === 'CONTAINS' ? row.cells[0]?.includes(value) : row.cells[0] === value);
    // Presence is determined by the name. Losing its Edit link does not prove
    // that a profile disappeared, particularly during deletion readback.
    if (matches.some(row => row.drill?.url !== PROFILE))
      throw Error('A matching profile has no usable Edit target. Reload the profile list and try again.');
    return matches;
  }

  function profileIdentity() {
    const form = document.forms.mainForm;
    const name = form?.elements.namedItem('deviceName')?.value ||
      form?.elements.namedItem('key')?.value || '';
    const text = content()?.innerText || '';
    const count = /(?:^|\n)\s*Assigned Lines\/Ports:\s*(\d+)/m.exec(text);
    if (!name || !count) throw Error('CommPilot did not show the profile name and assigned-line count.');
    return { name, assigned: Number(count[1]) };
  }

  async function inspectProfile(name, drill) {
    await navigate(drill.url, drill.params, PROFILE);
    const details = profileIdentity();
    if (details.name !== name) throw Error('CommPilot opened a different profile.');
    if (details.assigned > 0) return { assigned: details.assigned, users: null };
    await navigate(USERS, drill.params, USERS);
    const found = await window.cpListSearch([], {});
    if (found.tooMany) throw Error('CommPilot could not count this profile’s Users rows.');
    return { assigned: 0, users: found.rows.length };
  }

  async function preflight(rows, setStatus, setProgress) {
    if (typeof window.cpListSearch !== 'function') throw Error('Profile search is unavailable.');
    const result = [];
    const byName = new Map();
    const seen = new Set();
    for (let i = 0; i < rows.length; i++) {
      const input = rows[i];
      setStatus(`Searching extension ${i + 1} of ${rows.length}: ${input.extension}…`);
      setProgress('Finding profiles', i, rows.length, `Workbook row ${input.line}`);
      const base = { extension: input.extension, line: input.line, name: '', type: '',
        assigned: null, users: null, before: 'Present', after: '', status: 'ready', error: '' };
      if (!/^\d{1,15}$/.test(input.extension)) {
        result.push({ ...base, status: 'error', error: 'Enter a 1–15 digit extension.' });
        continue;
      }
      if (seen.has(input.extension)) {
        result.push({ ...base, status: 'error', error: 'Extension appears twice in the workbook.' });
        continue;
      }
      seen.add(input.extension);
      try {
        const matches = await searchProfiles('CONTAINS', input.extension);
        if (!matches.length) {
          result.push({ ...base, status: 'missing', before: '—', after: '—',
            error: 'No profile name contains this extension.' });
        }
        for (const match of matches) {
          const name = match.cells[0];
          if (byName.has(name)) {
            byName.get(name).extension += `, ${input.extension}`;
            continue;
          }
          const item = { ...base, name, type: match.cells[1] || '', drill: match.drill };
          byName.set(name, item);
          result.push(item);
          try {
            const details = await inspectProfile(name, match.drill);
            item.assigned = details.assigned;
            item.users = details.users;
            if (details.assigned || details.users) {
              item.status = 'in-use';
              item.after = 'Present';
            }
          } catch (error) { item.status = 'error'; item.error = error.message; }
        }
      } catch (error) { result.push({ ...base, status: 'error', error: error.message }); }
      if (location.pathname !== LIST) await navigate(LIST, {}, LIST);
      setProgress('Finding profiles', i + 1, rows.length,
        `Checked extension ${input.extension}`);
    }
    return result;
  }

  async function deleteOne(item, onStage) {
    onStage('Checking exact profile name');
    const matches = await searchProfiles('EQUAL_TO', item.name);
    if (!matches.length) { item.after = 'Absent'; return 'already-gone'; }
    if (matches.length !== 1) throw Error('CommPilot returned duplicate exact profile names.');
    const drill = matches[0].drill;
    onStage('Checking assigned lines and users');
    const details = await inspectProfile(item.name, drill);
    item.assigned = details.assigned;
    item.users = details.users;
    if (details.assigned || details.users) { item.after = 'Present'; return 'in-use'; }
    onStage('Opening profile to delete');
    await navigate(drill.url, drill.params, PROFILE);
    const live = profileIdentity();
    if (live.name !== item.name || live.assigned !== 0)
      throw Error('Profile name or assigned-line count changed before deletion.');
    const button = document.querySelector('td[width="82%"] form[name="mainForm"] input[name="delete"]');
    if (!button) throw Error('CommPilot Delete button is missing.');
    if (button.matches(':disabled')) throw Error('CommPilot Delete button is disabled. No deletion was sent.');
    onStage('Requesting deletion');
    await waitForReskin(() => button.click());
    const response = content()?.innerText || '';
    onStage('Verifying deletion');
    const remaining = await searchProfiles('EQUAL_TO', item.name);
    if (!remaining.length) { item.after = 'Deleted'; return 'deleted'; }
    item.after = 'Present';
    item.error = /(?:cannot|can't|in use|assigned|error|failed)/i.test(response) ?
      'CommPilot refused deletion; the profile is still present.' :
      'CommPilot did not remove this profile.';
    return 'refused';
  }

  function openDialog() {
    if (dialog) return;
    stopRequested = false;
    const overlay = document.createElement('div');
    overlay.className = 'cp-bulk-overlay';
    overlay.innerHTML = `<div class="cp-bulk-dialog cp-profile-bulk-dialog" role="dialog" aria-modal="true"
      aria-labelledby="cp-profile-bulk-title"><h2 id="cp-profile-bulk-title">Clean up unused identity/device profiles</h2>
      <p>Enter extensions in the workbook. Profile names are searched with <b>Contains</b>. Each matching
      profile is shown below. Profiles with assigned lines or Users rows are kept.</p>
      <div class="cp-bulk-actions"><button type="button" data-action="template">Download blank Excel template</button>
      <label class="cp-bulk-file">Choose filled Excel file<input type="file" accept=".xlsx"></label></div>
      <p class="cp-bulk-status" role="status">Download the template, fill it, then choose the file.</p>
      <div class="cp-bulk-progress" hidden><div class="cp-bulk-progress-head">
      <span data-progress-phase></span><strong data-progress-count></strong></div>
      <progress max="100" value="0"></progress><div data-progress-detail></div></div>
      <div class="cp-bulk-preview"></div>
      <div class="cp-bulk-footer"><button type="button" data-action="apply" disabled>Delete unused profiles</button>
      <button type="button" data-action="close">Close</button></div></div>`;
    document.body.appendChild(overlay);
    const releaseFocus = window.cpFocusBulkDialog(overlay);
    dialog = overlay;
    let preview = [];
    let working = false;
    let previewPage = 0;
    const status = overlay.querySelector('.cp-bulk-status');
    const table = overlay.querySelector('.cp-bulk-preview');
    const apply = overlay.querySelector('[data-action="apply"]');
    const close = overlay.querySelector('[data-action="close"]');
    const progress = overlay.querySelector('.cp-bulk-progress');
    const progressBar = progress.querySelector('progress');
    const setStatus = message => { status.textContent = message; };
    const setProgress = (phase, done, total, detail) => {
      progress.hidden = false;
      progress.querySelector('[data-progress-phase]').textContent = phase;
      progress.querySelector('[data-progress-count]').textContent = total ?
        `${done} / ${total} (${Math.round(done * 100 / total)}%)` : '—';
      progressBar.max = total || 1;
      progressBar.value = done;
      progress.querySelector('[data-progress-detail]').textContent = detail || '';
    };
    const render = () => {
      table.replaceChildren();
      if (!preview.length) { apply.disabled = true; return; }
      const counts = Object.fromEntries(['ready', 'in-use', 'missing', 'deleted',
        'already-gone', 'refused', 'error', 'unverified'].map(key =>
        [key, preview.filter(item => item.status === key).length]));
      const summary = document.createElement('p');
      summary.textContent = `${counts.ready} ready to delete · ${counts['in-use']} in use · ` +
        `${counts.missing} extensions with no match · ${counts.deleted} deleted · ` +
        `${counts.refused} refused · ${counts.error} errors · ${counts.unverified} unverified`;
      table.appendChild(summary);
      const ordered = [...preview].sort((a, b) =>
        Number(['error', 'refused', 'unverified'].includes(b.status)) -
        Number(['error', 'refused', 'unverified'].includes(a.status)));
      const pageSize = 100;
      const pages = Math.ceil(ordered.length / pageSize);
      previewPage = Math.min(previewPage, Math.max(0, pages - 1));
      const first = previewPage * pageSize;
      const grid = document.createElement('table');
      const head = document.createElement('thead');
      const heading = document.createElement('tr');
      ['Row', 'Extension', 'Profile name', 'Type', 'Assigned lines', 'Users',
        'Before', 'After', 'Result'].forEach(label => {
        const th = document.createElement('th'); th.textContent = label; heading.appendChild(th);
      });
      head.appendChild(heading); grid.appendChild(head);
      const body = document.createElement('tbody');
      ordered.slice(first, first + pageSize).forEach(item => {
        const tr = document.createElement('tr');
        [item.line, item.extension, item.name || '—', item.type || '—',
          item.assigned == null ? '—' : item.assigned, item.users == null ? '—' : item.users,
          item.before, item.after || '—', item.error || ({ ready: 'Ready to delete',
            'in-use': 'In use — kept', missing: 'No matches', deleted: 'Deleted and verified',
            'already-gone': 'Already absent', refused: 'Delete refused',
            unverified: 'Result could not be verified' }[item.status] || item.status)]
          .forEach(value => { const td = document.createElement('td'); td.textContent = value;
            tr.appendChild(td); });
        if (['error', 'refused', 'unverified'].includes(item.status)) tr.className = 'cp-bulk-error';
        else if (item.status === 'deleted') tr.className = 'cp-bulk-verified';
        body.appendChild(tr);
      });
      grid.appendChild(body); table.appendChild(grid);
      if (pages > 1) {
        const pager = document.createElement('div'); pager.className = 'cp-bulk-pages';
        const previous = document.createElement('button'); previous.type = 'button';
        previous.textContent = 'Previous'; previous.disabled = previewPage === 0;
        previous.addEventListener('click', () => { previewPage--; render(); });
        const label = document.createElement('span');
        label.textContent = `Profiles ${first + 1}–${Math.min(first + pageSize, ordered.length)} ` +
          `of ${ordered.length} · page ${previewPage + 1} of ${pages}`;
        const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next';
        next.disabled = previewPage >= pages - 1;
        next.addEventListener('click', () => { previewPage++; render(); });
        pager.append(previous, label, next); table.appendChild(pager);
      }
      apply.disabled = working || !counts.ready || !!counts.error || !!counts.unverified;
      apply.textContent = `Delete ${counts.ready} unused profile${counts.ready === 1 ? '' : 's'}`;
    };
    overlay.querySelector('[data-action="template"]').addEventListener('click', () => {
      try { downloadTemplate(); } catch (error) { setStatus(error.message); }
    });
    overlay.querySelector('input[type="file"]').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file || working) return;
      working = true;
      close.disabled = true; apply.disabled = true;
      preview = []; previewPage = 0; render();
      try {
        setStatus('Reading the workbook…');
        setProgress('Reading workbook', 0, 0, file.name);
        const rows = await readExtensions(file);
        preview = await preflight(rows, setStatus, setProgress);
        const ready = preview.filter(item => item.status === 'ready').length;
        const errors = preview.filter(item => item.status === 'error').length;
        setProgress('Preview complete', rows.length, rows.length,
          `${ready} profiles ready · ${errors} errors`);
        setStatus(errors ? 'Resolve the error rows, then upload the workbook again.' :
          ready ? 'Review every matching profile below before deleting.' :
            'No unused matching profiles were found.');
      } catch (error) { setStatus(error.message); setProgress('Preview stopped', 0, 0, error.message); }
      finally { event.target.value = ''; working = false; close.disabled = false; render(); }
    });
    apply.addEventListener('click', async () => {
      if (working || preview.some(item => item.status === 'error')) return;
      const targets = preview.filter(item => item.status === 'ready');
      if (!targets.length) return;
      if (!window.confirm(`Delete ${targets.length} unused identity/device profile${targets.length === 1 ? '' : 's'}? ` +
        'Review the matching profile names in the preview. Deletion cannot be undone.')) return;
      working = true; stopRequested = false; render();
      close.textContent = 'Stop after current profile';
      let processed = 0;
      try {
        for (const item of targets) {
          if (stopRequested) break;
          setStatus(`Checking ${processed + 1} of ${targets.length}: ${item.name}…`);
          setProgress('Deleting profiles', processed, targets.length, item.name);
          try {
            item.status = await deleteOne(item, stage => setProgress('Deleting profiles',
              processed, targets.length, `${item.name}: ${stage}`));
          } catch (error) {
            item.status = 'unverified';
            item.error = error.message;
            try {
              const found = await searchProfiles('EQUAL_TO', item.name);
              item.after = found.length ? 'Present' : 'Absent';
              item.status = found.length ? 'error' : 'deleted';
              if (!found.length) item.error = '';
            } catch (readbackError) { /* Keep the result unverified. */ }
          }
          processed++;
          setProgress('Deleting profiles', processed, targets.length,
            `${item.name}: ${item.status}`);
          render();
        }
        const deleted = preview.filter(item => item.status === 'deleted').length;
        const refused = preview.filter(item => item.status === 'refused').length;
        const errors = preview.filter(item => ['error', 'unverified'].includes(item.status)).length;
        setStatus(`${deleted} deleted and verified · ${refused} refused by CommPilot · ` +
          `${errors} errors or unverified · ${preview.filter(item => item.status === 'in-use').length} in use and kept.` +
          (stopRequested ? ' Stopped after the current profile.' : ' Review the results below.'));
        setProgress(stopRequested || refused || errors ? 'Stopped with results' : 'Complete',
          processed, targets.length, 'Before and After results are shown below.');
      } finally {
        const resultStatus = status.textContent;
        try { if (location.pathname !== LIST) await navigate(LIST, {}, LIST); }
        catch (error) { /* Keep the result visible. */ }
        working = false; close.textContent = 'Close'; setStatus(resultStatus);
        render();
      }
    });
    close.addEventListener('click', () => {
      if (working) { stopRequested = true; setStatus('Stopping after the current profile…'); return; }
      overlay.remove(); releaseFocus(); dialog = null; mountButton();
    });
  }

  document.addEventListener('cp:reskin', () => setTimeout(mountButton, 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();
})();
