/* Rounded navigation and account icons shared by all four palettes. */
(() => {
  const shapes = {
    profile: '<circle cx="12" cy="8" r="3.25"/><path d="M5.25 20v-1.5A5.25 5.25 0 0 1 10.5 13.25h3A5.25 5.25 0 0 1 18.75 18.5V20"/>',
    resources: '<rect x="3.25" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="13.25" y="3.5" width="7.5" height="7.5" rx="2"/><rect x="3.25" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.25" y="13.5" width="7.5" height="7.5" rx="2"/>',
    services: '<path d="m12 2.75 8.25 4.75L12 12.25 3.75 7.5 12 2.75Z"/><path d="m3.75 11.5 8.25 4.75 8.25-4.75M3.75 15.5 12 20.25l8.25-4.75"/>',
    callcenter: '<path d="M4.5 13V11a7.5 7.5 0 0 1 15 0v2"/><rect x="3.25" y="11.5" width="4" height="6.25" rx="1.75"/><rect x="16.75" y="11.5" width="4" height="6.25" rx="1.75"/><path d="M18.75 17.75c0 2-2.1 3.5-5.75 3.5h-1.25"/>',
    meetme: '<circle cx="9" cy="8.25" r="2.5"/><circle cx="16.5" cy="9.25" r="2"/><path d="M3.5 19.75v-1.5A5.25 5.25 0 0 1 8.75 13h.5a5.25 5.25 0 0 1 5.25 5.25v1.5M15.25 14.25c2.75 0 5 2.1 5 4.75v.75"/>',
    utilities: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2.25" fill="var(--icon-bg)"/><circle cx="15.5" cy="12" r="2.25" fill="var(--icon-bg)"/><circle cx="8" cy="18" r="2.25" fill="var(--icon-bg)"/>',
    'incoming-calls': '<path d="M19.5 5.5h-8v8M11.5 5.5l8 8"/><path d="M4.5 7.5v9a3 3 0 0 0 3 3h9"/>',
    'outgoing-calls': '<path d="M12.5 4.5h7v7M19.5 4.5l-8 8"/><path d="M16.5 19.5h-9a3 3 0 0 1-3-3v-9"/>',
    'call-control': '<path d="M4.5 6.5h15v11h-15z"/><path d="M8 10h8M8 14h5"/>',
    'calling-plan': '<path d="M5 5h5v5H5zM14 14h5v5h-5zM14 5h5v5h-5zM5 14h5v5H5z"/>',
    messaging: '<path d="M4.25 5.25h15.5v11.5H9l-4.75 3v-14.5Z"/><path d="M7.75 9.25h8.5M7.75 12.5h5.75"/>',
    'client-apps': '<rect x="3.5" y="4" width="17" height="15" rx="2.5"/><path d="M3.5 9h17M9 19v2M15 19v2"/>',
    'comm-barring': '<circle cx="12" cy="12" r="8.5"/><path d="M6 18 18 6"/>',
    unknown: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9.5 9.25a2.75 2.75 0 0 1 5.25 1.1c0 1.65-2.75 2.1-2.75 3.65M12 17h.01"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.25a2.75 2.75 0 0 1 5.25 1.1c0 1.65-2.75 2.1-2.75 3.65M12 17h.01"/>',
    home: '<path d="m3.75 10 8.25-6.5L20.25 10v9.25H3.75V10Z"/><path d="M9.25 19.25v-6.5h5.5v6.5"/>',
    logout: '<path d="M10 4.25H6.25a2 2 0 0 0-2 2v11.5a2 2 0 0 0 2 2H10M14 8l4 4-4 4M8.75 12H18"/>',
  };
  function icon(name, tone = 'light') {
    const file = `assets/icons/palette${tone === 'dark' ? '-dark' : ''}-${shapes[name] ? name : 'unknown'}.svg`;
    return `url("${chrome.runtime.getURL(file)}")`;
  }
  function decorate() {
    if (document.body?.id !== 'initBody.menuTemplate') return;
    const active = Boolean(document.documentElement.dataset.cpDirection);
    for (const link of document.querySelectorAll('td.headerBar a.headerLink')) {
      if (link.dataset.cpOriginalLabel && !active) {
        link.textContent = link.dataset.cpOriginalLabel;
        delete link.dataset.cpOriginalLabel;
      }
    }
    if (!active) return;
    for (const link of document.querySelectorAll('a[data-cp-nav-icon]')) {
      link.style.setProperty('--cp-palette-icon', icon(link.dataset.cpNavIcon));
    }
    for (const link of document.querySelectorAll('td.headerBar a.headerLink')) {
      const label = (link.dataset.cpOriginalLabel || link.textContent).trim().replaceAll(/[\[\]]/g, '').toLowerCase();
      if (shapes[label]) {
        link.style.setProperty('--cp-palette-icon-dark', icon(label, 'dark'));
        link.style.setProperty('--cp-palette-icon-light', icon(label));
        if (label === 'logout' && !link.dataset.cpOriginalLabel) {
          link.dataset.cpOriginalLabel = link.textContent;
          link.textContent = 'Sign out';
        }
      }
    }
    for (const welcome of document.querySelectorAll('.headerBarWelcome')) {
      welcome.style.setProperty('--cp-palette-user-icon-dark', icon('profile', 'dark'));
      welcome.style.setProperty('--cp-palette-user-icon-light', icon('profile'));
    }
    // Sorted list columns carry CommPilot's black-boxed GIF arrow. Keep the GIF (the bulk tools read its src to
    // learn the sort direction) but hide it in CSS, and draw a chevron in the header's own color beside it.
    for (const link of document.querySelectorAll('a.listSortHeader')) {
      const arrow = link.querySelector('img[src*="uparrow.gif"], img[src*="downarrow.gif"]');
      let mark = link.querySelector('.cp-sort-ico');
      if (!arrow) { mark?.remove(); continue; }
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'cp-sort-ico';
        mark.setAttribute('aria-hidden', 'true');
        link.appendChild(mark);
      }
      const direction = /uparrow\.gif/i.test(arrow.getAttribute('src') || '') ? 'asc' : 'desc';
      mark.style.setProperty('--cp-sort-icon', `url("${chrome.runtime.getURL(`assets/icons/sort-${direction}.svg`)}")`);
    }
  }

  // A single navigation emits several of these events. Refresh once for the final DOM in that frame.
  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; decorate(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorate, { once: true });
  } else decorate();
  document.addEventListener('cp:theme-change', schedule);
  document.addEventListener('cp:navigation-decorated', schedule);
  document.addEventListener('cp:morphed', schedule);
  document.addEventListener('cp:reskin', schedule);
})();
