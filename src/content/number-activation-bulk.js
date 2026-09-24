/* Group Activate Numbers: scan every list page, preview, activate, and verify. */
(function () {
  if (window !== window.top || window.__cpActivationBulkLoaded) return;
  window.__cpActivationBulkLoaded = true;

  const LIST = '/commpilot/Group/DnActivation/';
  const MODIFY = '/commpilot/Group/DnActivation/Modify/index.jsp';
  const PAGE = '/commpilot/Common/page.jsp';
  const FIND = '/commpilot/Common/find.jsp';
  const TABLE = 'grpDnActTable';
  let dialog = null;
  let stopRequested = false;
  const path = () => document.documentElement.getAttribute('data-cp-path') || location.pathname;
  const content = () => document.querySelector('td[width="82%"]');

  function mountButton() {
    if (path() !== LIST || dialog) return;
    const cell = content();
    if (!cell || cell.querySelector('#cp-bulk-activation-launch')) return;
    const beside = cell.querySelector('input[name="ok"]');
    if (!beside) return;
    const button = document.createElement('button');
    button.id = 'cp-bulk-activation-launch';
    button.type = 'button';
    button.textContent = 'Activate all deactivated numbers';
    button.addEventListener('click', openDialog);
    beside.insertAdjacentElement('afterend', button);
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
      const timer = setTimeout(() => finish(Error('CommPilot did not return a page. Check the current number before retrying.')),
        timeout);
      document.addEventListener('cp:reskin', onReskin);
      try { action(); } catch (error) { finish(error); }
    });
  }

  async function navigate(url, params, expected) {
    await waitForReskin(() => window.redirectPost(url, params || {}));
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(path()))
      throw Error(`CommPilot opened ${path()} instead of ${allowed.join(' or ')}.`);
  }

  function pageState() {
    const text = content()?.innerText || '';
    const match = /\[\s*Page\s+(\d+)\s+of\s+(\d+)\s*\]/i.exec(text);
    if (!match) throw Error('CommPilot did not show the Activate Numbers page count.');
    const current = Number(match[1]), total = Number(match[2]);
    if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) ||
        current < 1 || total < 1 || current > total)
      throw Error('CommPilot returned an invalid Activate Numbers page count.');
    return { current, total };
  }

  async function currentRows() {
    if (typeof window.cpListSearch !== 'function') throw Error('CommPilot list reader is unavailable.');
    const found = await window.cpListSearch([], {});
    if (found.tooMany) throw Error('CommPilot could not read all rows on this page.');
    if (found.rows.some(row => row.drill?.url !== MODIFY))
      throw Error('CommPilot returned a number row without an Edit target. Scan again.');
    return found.rows;
  }

  function rowStatus(row) {
    const raw = row.drill?.params?.activated ?? row.drill?.params?.P_activated;
    const checkmark = row.cells?.[1] === '✓';
    if (raw === 'true' && checkmark) return 'active';
    if (raw === 'false' && !checkmark) return 'inactive';
    if (raw === 'true' || raw === 'false')
      throw Error(`CommPilot's activation checkmark disagrees with ${row.cells?.[0] || 'a row'}. Scan again.`);
    throw Error(`CommPilot did not identify the activation state for ${row.cells?.[0] || 'a row'}.`);
  }

  function members() {
    const form = document.forms.mainForm;
    const deactivated = form?.elements.namedItem('deactivatedList');
    const activated = form?.elements.namedItem('activatedList');
    if (!deactivated || !activated || !form.elements.namedItem('toAdd') ||
        !form.elements.namedItem('action') || !form.elements.namedItem('ok'))
      throw Error('CommPilot did not show the Activate Numbers edit controls.');
    const values = select => [...select.options].map(option => option.value.trim()).filter(Boolean);
    return { deactivated: values(deactivated), activated: values(activated) };
  }

  function countNumbers(values) {
    return values.reduce((total, value) => {
      const range = /^(\+?[\d-]+)\s+-\s+(\+?[\d-]+)$/.exec(value);
      if (!range) return total + 1;
      const first = range[1].replace(/\D/g, '');
      const last = range[2].replace(/\D/g, '');
      if (!first || first.length !== last.length || BigInt(last) < BigInt(first))
        throw Error(`CommPilot returned an invalid number range: ${value}.`);
      const size = BigInt(last) - BigInt(first) + 1n;
      if (size > BigInt(Number.MAX_SAFE_INTEGER - total))
        throw Error('CommPilot returned a range too large to count safely.');
      return total + Number(size);
    }, 0);
  }

  async function scan(setStatus, setProgress) {
    await navigate(LIST, {}, LIST); // Clears any search filter before counting pages.
    const first = pageState();
    const rows = [];
    const seen = new Set();
    let activeRows = 0;
    for (let page = 1; page <= first.total; page++) {
      if (stopRequested) throw Error('Scan stopped. No activation was started.');
      if (page > 1) await navigate(PAGE,
        { returnPage: '/Group/DnActivation/', tableName: TABLE, value: String(page - 1) }, [PAGE, LIST]);
      const state = pageState();
      if (state.current !== page || state.total !== first.total)
        throw Error(`CommPilot changed the list while scanning page ${page}. Scan again.`);
      const visible = await currentRows();
      if (!visible.length && first.total > 1)
        throw Error(`CommPilot returned no rows on page ${page}. Scan again.`);
      for (const row of visible) {
        const label = row.cells?.[0]?.trim();
        if (!label || seen.has(label)) throw Error(`Duplicate or blank number row on page ${page}. Scan again.`);
        seen.add(label);
        if (rowStatus(row) === 'active') { activeRows++; continue; }
        rows.push({ label, drill: row.drill, page, numbers: [], count: countNumbers([label]), before: 'Deactivated',
          after: '—', status: 'ready', error: '' });
      }
      setProgress('Scanning all pages', page, first.total,
        `${rows.length} deactivated rows found · ${activeRows} active rows skipped`);
      setStatus(`Scanned page ${page} of ${first.total}.`);
    }
    await navigate(LIST, {}, LIST);
    return { rows, pages: first.total, activeRows };
  }

  async function findExact(label) {
    if (path() !== LIST) await navigate(LIST, {}, LIST);
    for (const [op, value] of [['4', label], ['2', label.split(' - ')[0]]]) {
      await navigate(FIND, { returnPage: '/Group/DnActivation/', tableName: TABLE,
        key: '0', op, value }, FIND);
      const found = (await currentRows()).filter(row => row.cells?.[0]?.trim() === label);
      if (found.length) return found;
      await navigate(LIST, {}, LIST);
    }
    return [];
  }

  async function activateOne(item, onStage) {
    onStage('Checking current activation state');
    const found = await findExact(item.label);
    if (found.length !== 1) throw Error(`Could not uniquely find ${item.label} before activation.`);
    if (rowStatus(found[0]) === 'active') {
      item.after = 'Activated';
      return 'already-active';
    }
    await navigate(found[0].drill.url, found[0].drill.params, MODIFY);
    const before = members();
    if (!before.deactivated.length ||
        before.deactivated.some(value => before.activated.includes(value)) ||
        countNumbers(before.deactivated) !== item.count)
      throw Error('The numbers in this row do not match the preview. Scan again.');
    item.numbers = before.deactivated;
    const form = document.forms.mainForm;
    for (const option of form.elements.deactivatedList.options)
      option.selected = item.numbers.includes(option.value.trim());
    const button = document.getElementById('PICKLIST_addNumbers');
    if (!button) throw Error('CommPilot Add button is missing.');
    onStage(`Moving ${item.count} number${item.count === 1 ? '' : 's'} to Activated`);
    await waitForReskin(() => button.click());
    if (path() !== MODIFY) throw Error('CommPilot did not return to Activate Numbers Modify after Add.');
    const staged = members();
    if (staged.deactivated.some(value => item.numbers.includes(value)) ||
        !item.numbers.every(value => staged.activated.includes(value)))
      throw Error('CommPilot did not move all numbers to Activated.');
    onStage('Saving activation');
    await waitForReskin(() => document.forms.mainForm.querySelector('input[name="ok"]').click());
    onStage('Reading back saved activation');
    const saved = await findExact(item.label);
    if (saved.length !== 1 || rowStatus(saved[0]) !== 'active')
      throw Error('Activation was not confirmed by the CommPilot list.');
    await navigate(saved[0].drill.url, saved[0].drill.params, MODIFY);
    const after = members();
    if (!item.numbers.every(value => after.activated.includes(value)))
      throw Error('The saved edit page did not show every number as activated.');
    item.after = 'Activated';
    return 'verified';
  }

  function openDialog() {
    if (dialog) return;
    stopRequested = false;
    const overlay = document.createElement('div');
    overlay.className = 'cp-bulk-overlay';
    overlay.innerHTML = `<div class="cp-bulk-dialog cp-activation-bulk-dialog" role="dialog" aria-modal="true"
      aria-labelledby="cp-activation-bulk-title"><h2 id="cp-activation-bulk-title">Activate all deactivated numbers</h2>
      <p>Read the activation checkmarks on each list page. Range counts come from the displayed numbers. Review the preview before saving.</p>
      <div class="cp-bulk-actions"><button type="button" data-action="scan">Scan group</button></div>
      <p class="cp-bulk-status" role="status">Scan the group to find deactivated numbers.</p>
      <div class="cp-bulk-progress" hidden><div class="cp-bulk-progress-head">
      <span data-progress-phase></span><strong data-progress-count></strong></div>
      <progress max="100" value="0"></progress><div data-progress-detail></div></div>
      <div class="cp-bulk-preview"></div>
      <div class="cp-bulk-footer"><button type="button" data-action="apply" disabled>Activate numbers</button>
      <button type="button" data-action="close">Close</button></div></div>`;
    document.body.appendChild(overlay);
    dialog = overlay;
    let preview = [];
    let scanned = false;
    let working = false;
    let page = 0;
    const status = overlay.querySelector('.cp-bulk-status');
    const table = overlay.querySelector('.cp-bulk-preview');
    const scanButton = overlay.querySelector('[data-action="scan"]');
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
      const counts = Object.fromEntries(['ready', 'verified', 'already-active', 'error', 'unverified']
        .map(key => [key, preview.filter(item => item.status === key).length]));
      const numberCount = preview.filter(item => item.status === 'ready')
        .reduce((sum, item) => sum + item.count, 0);
      if (scanned || preview.length) {
        const summary = document.createElement('p');
        summary.textContent = `${numberCount} numbers ready in ${counts.ready} rows · ` +
          `${counts.verified} rows verified · ${counts['already-active']} already active · ` +
          `${counts.error} errors · ${counts.unverified} unverified`;
        table.appendChild(summary);
      }
      const size = 100;
      const pages = Math.ceil(preview.length / size);
      page = Math.min(page, Math.max(0, pages - 1));
      const grid = document.createElement('table');
      const head = document.createElement('tr');
      ['Group row', 'Numbers', 'Before', 'After', 'Result'].forEach(label => {
        const th = document.createElement('th'); th.textContent = label; head.appendChild(th);
      });
      const thead = document.createElement('thead'); thead.appendChild(head); grid.appendChild(thead);
      const body = document.createElement('tbody');
      preview.slice(page * size, (page + 1) * size).forEach(item => {
        const tr = document.createElement('tr');
        [item.label, item.count === 1 ? item.label :
          `${item.count} numbers: ${item.label}`,
        item.before, item.after, item.error || ({ ready: 'Ready to activate',
          verified: 'Saved and verified', 'already-active': 'Already activated',
          unverified: 'Result could not be verified' }[item.status] || item.status)]
          .forEach(value => { const td = document.createElement('td'); td.textContent = value;
            tr.appendChild(td); });
        if (['error', 'unverified'].includes(item.status)) tr.className = 'cp-bulk-error';
        else if (item.status === 'verified') tr.className = 'cp-bulk-verified';
        body.appendChild(tr);
      });
      grid.appendChild(body); if (preview.length) table.appendChild(grid);
      if (pages > 1) {
        const pager = document.createElement('div'); pager.className = 'cp-bulk-pages';
        const previous = document.createElement('button'); previous.type = 'button';
        previous.textContent = 'Previous'; previous.disabled = page === 0;
        previous.addEventListener('click', () => { page--; render(); });
        const label = document.createElement('span');
        label.textContent = `Rows ${page * size + 1}–${Math.min((page + 1) * size, preview.length)} ` +
          `of ${preview.length} · page ${page + 1} of ${pages}`;
        const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Next';
        next.disabled = page >= pages - 1;
        next.addEventListener('click', () => { page++; render(); });
        pager.append(previous, label, next); table.appendChild(pager);
      }
      apply.disabled = working || !scanned || !counts.ready || !!counts.error || !!counts.unverified;
      apply.textContent = `Activate ${numberCount} number${numberCount === 1 ? '' : 's'}`;
      scanButton.disabled = working;
    };
    scanButton.addEventListener('click', async () => {
      if (working) return;
      working = true; stopRequested = false; scanned = false; preview = []; page = 0;
      render(); close.textContent = 'Stop after current request';
      try {
        setStatus('Scanning every Activate Numbers page…');
        const result = await scan(setStatus, setProgress);
        preview = result.rows; scanned = true;
        const count = preview.reduce((sum, item) => sum + item.count, 0);
        setStatus(count ? `Found ${count} deactivated numbers in ${preview.length} rows across ` +
          `${result.pages} pages. Review them below.` :
          `All rows on ${result.pages} pages are already activated.`);
        setProgress('Preview complete', result.pages, result.pages,
          `${result.activeRows} active rows skipped · ${count} deactivated numbers`);
      } catch (error) {
        preview = []; setStatus(error.message);
        setProgress('Scan stopped', 0, 0, error.message);
      } finally {
        working = false; close.textContent = 'Close';
        try { if (path() !== LIST) await navigate(LIST, {}, LIST); } catch (_) { /* Result remains visible. */ }
        render();
      }
    });
    apply.addEventListener('click', async () => {
      if (working || !scanned) return;
      const targets = preview.filter(item => item.status === 'ready');
      if (!targets.length) return;
      const count = targets.reduce((sum, item) => sum + item.count, 0);
      if (!window.confirm(`Activate ${count} deactivated number${count === 1 ? '' : 's'} ` +
        `across ${targets.length} group row${targets.length === 1 ? '' : 's'}?`)) return;
      working = true; stopRequested = false; render();
      close.textContent = 'Stop after current row';
      let done = 0;
      try {
        for (const item of targets) {
          if (stopRequested) break;
          setStatus(`Activating row ${done + 1} of ${targets.length}: ${item.label}…`);
          setProgress('Activating numbers', done, targets.length, item.label);
          try {
            item.status = await activateOne(item, stage =>
              setProgress('Activating numbers', done, targets.length, `${item.label}: ${stage}`));
          } catch (error) {
            item.status = 'unverified'; item.error = error.message;
            // Never mark a failed save as success without a fresh server readback.
            try {
              const found = await findExact(item.label);
              if (item.numbers.length && found.length === 1 && rowStatus(found[0]) === 'active') {
                await navigate(found[0].drill.url, found[0].drill.params, MODIFY);
                if (item.numbers.every(value => members().activated.includes(value))) {
                  item.status = 'verified'; item.after = 'Activated'; item.error = '';
                }
              } else if (found.length === 1) { item.status = 'error'; item.after = 'Deactivated'; }
            } catch (_) { /* Keep unverified. */ }
          }
          done++; render();
          setProgress('Activating numbers', done, targets.length, `${item.label}: ${item.status}`);
          if (['error', 'unverified'].includes(item.status)) break;
        }
        const verified = preview.filter(item => item.status === 'verified').length;
        const errors = preview.filter(item => ['error', 'unverified'].includes(item.status)).length;
        setStatus(`${verified} rows saved and verified · ${errors} errors or unverified.` +
          (stopRequested ? ' Stopped after the current row.' :
            errors ? ' Stopped on the first error. Review the result before scanning again.' :
              ' Review the before and after results below.'));
        setProgress(stopRequested || errors ? 'Stopped with results' : 'Complete',
          done, targets.length, 'Before and After results are shown below.');
      } finally {
        working = false; close.textContent = 'Close';
        try { if (path() !== LIST) await navigate(LIST, {}, LIST); } catch (_) { /* Result remains visible. */ }
        render();
      }
    });
    close.addEventListener('click', () => {
      if (working) { stopRequested = true; setStatus('Stopping after the current request…'); return; }
      overlay.remove(); dialog = null; mountButton();
    });
  }

  document.addEventListener('cp:reskin', () => setTimeout(mountButton, 0));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();
})();
