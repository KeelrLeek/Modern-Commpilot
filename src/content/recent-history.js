/* Breadcrumb history presentation and duplicate cleanup after PJAX records a read-only visit. */
(() => {
  if (window !== window.top) return;
  const clean = value => String(value || '').replace(/^\s*:\s*/, '').replace(/\s+/g, ' ').trim();
  const validNav = nav => nav && typeof nav === 'object' && !Array.isArray(nav) && typeof nav.url === 'string' && nav.url.length > 0;
  const path = value => String(value || '').replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0].replace(/index\.jsp$/, '').replace(/\/+$/, '') + '/';
  const entryType = value => /\/Group\/Members\/Modify\//.test(value) ? 'User' :
    /\/(?:ServiceProvider\/Members|Reseller\/Groups)\/Modify\//.test(value) ? 'Group' :
    /\/ServiceProviders\/Modify\//.test(value) ? 'Service provider' : '';
  const owner = row => {
    let value = row.nav?.url || '';
    if (/\/Common\/(?:find|findAll|page|sort)\.jsp$/.test(value) && row.nav?.params?.returnPage)
      value = String(row.nav.params.returnPage).replace(/^(?!\/commpilot\/)/, '/commpilot/').replace('/commpilot//','/commpilot/');
    return path(value);
  };
  function place(row) {
    // Current history.state is read directly by the menu, outside stored-row cleanup.
    // Discard damaged ancestry as a whole and use the visible context for its label.
    const url = owner(row), nav = row.nav || {}, chain = Array.isArray(row.chain) && row.chain.every(validNav) ? row.chain : [];
    const folder = nav.params?.folder || '';
    let type = entryType(url) || (/\/User\//.test(url) ? 'User' : /\/Group\//.test(url) ? 'Group' : /\/ServiceProvider\//.test(url) ? 'Service provider' :
      /\/Reseller\//.test(url) ? 'Reseller' : /^U/.test(folder) ? 'User' : /^G/.test(folder) ? 'Group' : /^S/.test(folder) ? 'Service provider' : 'Reseller');
    const trail = clean(row.context).split(/\s*›\s*/).filter(value => value && value !== 'Users' && !/^Reseller$/i.test(value));
    const entry = [nav, ...chain.slice().reverse()].find(step => entryType(step.url || '') === type);
    const key = entry?.params?.key || entry?.params?.P_key || '';
    const parts = key ? String(key).split('>%') : type === 'User' ? trail.slice(-3) : type === 'Group' ? trail.slice(-2) : type === 'Service provider' ? trail.slice(0, 1) : [];
    let full = clean(parts.at(-1)) || (type === 'Reseller' ? 'Reseller' : clean(trail.at(-1))) || type;
    let parent = clean(parts.at(-2));
    if (/\/DeviceInventory\/Modify\//.test(url)) {
      type = 'Device profile';
      full = clean(nav.params?.deviceName || nav.params?.name || nav.params?.key || trail.at(-1)) || 'Device profile';
      parent = clean(trail.at(-2));
    } else if (/\/Operator\//.test(url)) { type = 'System'; full = 'System'; parent = ''; }
    const name = type === 'User' ? full.split('@')[0] : full;
    return {key:JSON.stringify([type, parts.length ? parts.join('>%') : full, type === 'Device profile' ? full : '']), type, name, full, parent,
      extension:type === 'User' ? clean(row.extension) : '', userName:type === 'User' ? clean(row.userName) : ''};
  }
  function isMenu(row) {
    if (typeof row.isMenu === 'boolean') return row.isMenu;
    return /\/Common\/folder_contents\.jsp$/.test(row.nav?.url || '') || Boolean(entryType(owner(row)));
  }
  function homeIndex(row) {
    const type = place(row).type;
    const steps = [...(row.chain || []),row.nav];
    for (let index = steps.length - 1; index >= 0; index--) {
      const step = steps[index];
      if (entryType(path(step?.url)) === type || type === 'Reseller' &&
          step?.url === '/commpilot/Common/folder_contents.jsp' && step.params?.folder === 'R0') return index;
    }
    return -1;
  }
  function destination(row) {
    const params = row.nav?.params || {}, url = owner(row), menu = isMenu(row);
    let target = url;
    if (menu) target = 'menu:' + (params.folder && !/0$/.test(params.folder) ? params.folder : 'home');
    const detail = {};
    const query = (row.nav?.url || '').split('?')[1]?.split('#')[0];
    if (query) detail.query = query.split('&').sort().join('&');
    if (!menu && !/\/Common\//.test(row.nav?.url || '')) {
      for (const name of ['criteriaName','scheduleName','eventName','instanceId','serviceInstanceName','deviceName','tabPage']) if (params[name]) detail[name] = String(params[name]);
      const key = params.key || params.P_key || params.name || params.P_name;
      if (key) detail.key = String(key);
    }
    return JSON.stringify([place(row).key, target, detail]);
  }
  function unique(rows) {
    const seen = new Set();
    // One damaged stored row must not break the entire menu. Drop incomplete ancestry as a whole;
    // trimming broken parents could make a saved destination appear safe to restore in the wrong group.
    return (Array.isArray(rows) ? rows : []).filter(row => row && typeof row.id === 'string' && validNav(row.nav) &&
      (row.chain == null || Array.isArray(row.chain) && row.chain.every(validNav))).filter(row => {
      const key = destination(row);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map(row => {
      // Older builds captured the Profile page's hidden info card as part of its title. Repair the
      // saved label from this unambiguous route without changing its ID, ancestry or navigation.
      const label = !isMenu(row) && /\/(?:Reseller|ServiceProvider|Group|User)\/Profile\/$/.test(owner(row)) ? 'Profile' : clean(row.label);
      return label === row.label ? row : {...row,label};
    });
  }
  function groups(rows, current, includeMenus = false) {
    const result = new Map();
    for (const row of unique(rows)) {
      if (!includeMenus && isMenu(row)) continue;
      const location = place(row);
      let group = result.get(location.key);
      if (!group) { group = {...location, rows:[]}; result.set(location.key, group); }
      if (!group.extension && location.extension) group.extension = location.extension;
      if (!group.userName && location.userName) group.userName = location.userName;
      group.rows.push(row);
    }
    const list = [...result.values()];
    const index = list.findIndex(group => group.key === current);
    if (index > 0) list.unshift(...list.splice(index, 1));
    return list;
  }
  const shapes = {
    user:'<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/>',
    group:'<circle cx="9" cy="8" r="2.7"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2"/>',
    provider:'<path d="M4 21V5h10v16M14 10h6v11M2 21h20M7 8h4M7 12h4M7 16h4M17 13v2m0 2v2"/>',
    profile:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="10" r="2"/><path d="M5 16c0-3 6-3 6 0m3-7h4m-4 4h4"/>',
    password:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    schedule:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/>',
    services:'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>',
    menu:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    device:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    phone:'<path d="M4 3h4l2 5-3 2a14 14 0 0 0 7 7l2-3 5 2v4a2 2 0 0 1-2 2A19 19 0 0 1 2 5a2 2 0 0 1 2-2Z"/>',
    page:'<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6"/>'
  };
  function icon(name) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (shapes[name] || shapes.page) + '</svg>'; }
  function pageIcon(row) {
    const label = clean(row.label);
    return isMenu(row) ? 'menu' : /password|authentication/i.test(label) ? 'password' : /schedule|holiday/i.test(label) ? 'schedule' :
      /assign|services/i.test(label) ? 'services' : /users|groups|administrator/i.test(label) ? 'group' : /profile/i.test(label) ? 'profile' :
      /device/i.test(label) ? 'device' : /call|number|address/i.test(label) ? 'phone' : 'page';
  }
  globalThis.cpRecentHistory = {place, isMenu, homeIndex, destination, unique, groups, icon, pageIcon};
  // Keep this script in the isolated world with crumbs.js. Chromium skips a repeated script URL when
  // the same file appears in both MAIN and ISOLATED content-script lists. DOM events bridge the worlds
  // without exposing helper functions or changing the saved navigation/context restore data.
  function compact() {
    try {
      const saved = sessionStorage.getItem('cp-recent-locations');
      if (!saved) return;
      const rows = JSON.parse(saved);
      if (!Array.isArray(rows)) return;
      let result = unique(rows).slice(0,30);
      const cell = [...document.querySelectorAll('td.headerBar')].find(el=>el.querySelector('span.headerAuthLevel'));
      const id = cell?.querySelector('span.headerAuthLevel');
      if (id?.getAttribute('data-cp-name-state') === 'done') {
        const context = [...cell.querySelectorAll('a.headerAuthLevelLink, span.headerAuthLevel')].map(el=>clean(el.textContent)).join(' › ');
        const current = place({nav:history.state?.cpNav,chain:history.state?.cpRecentChain,
          context});
        // The header can change just before PJAX commits its new history state. Never attach the next
        // user's name to the old state's user, including same IDs in different groups.
        const native = place({nav:{url:'/commpilot/User/Profile/'},context});
        if (current.type === 'User' && current.key === native.key) result = result.map(row=>place(row).key === current.key ? {...row,userName:clean(id.getAttribute('data-cp-user-name'))} : row);
      }
      const next = JSON.stringify(result);
      if (next !== saved) sessionStorage.setItem('cp-recent-locations',next);
    } catch {}
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('cp:recent-change',compact);
    document.addEventListener('cp:user-name',compact);
    compact();
  }
})();
