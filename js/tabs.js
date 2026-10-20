/** Shared manual-activation tab keyboard behavior (arrows move, Enter selects). */
export function initTabKeyboard(tablist) {
  if (!tablist || tablist.dataset.keyboardReady) return;
  tablist.dataset.keyboardReady = 'true';
  const tabs = () => [...tablist.querySelectorAll('[role="tab"]')];
  tablist.addEventListener('keydown', event => {
    const items = tabs(), index = items.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      items.forEach((item, i) => { item.tabIndex = i === next ? 0 : -1; });
      items[next].focus();
    }
  });
}

export function initSettingsTabs() {
  const bar = document.getElementById('settings-tabs');
  if (!bar) return;
  const tabs = [...bar.querySelectorAll('[role="tab"]')];
  const select = (id, focus = false) => {
    if (!tabs.some(tab => tab.getAttribute('aria-controls') === id)) return;
    for (const tab of tabs) {
      const active = tab.getAttribute('aria-controls') === id;
      tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle('active', active);
      const panel = document.getElementById(tab.getAttribute('aria-controls'));
      panel.hidden = !active; panel.classList.toggle('hidden', !active);
      if (active && focus) tab.focus();
    }
  };
  for (const tab of tabs) tab.addEventListener('click', () => select(tab.getAttribute('aria-controls')));
  initTabKeyboard(bar);
  document.addEventListener('app:settings-tab', event => select(event.detail.id));
  select('settings-general');
}

/** One tab convention for optional Progress and Import tools. */
export function initSectionTabs() {
  for (const bar of document.querySelectorAll('[data-panel-tabs]')) {
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    const select = id => {
      if (!tabs.some(tab => tab.getAttribute('aria-controls') === id)) return;
      for (const tab of tabs) {
        const active = tab.getAttribute('aria-controls') === id;
        tab.tabIndex = active ? 0 : -1;
        tab.setAttribute('aria-selected', String(active)); tab.classList.toggle('active', active);
        const panel = document.getElementById(tab.getAttribute('aria-controls'));
        panel.hidden = !active; panel.inert = !active;
        panel.classList.toggle('hidden', !active); panel.classList.toggle('active', active);
      }
      if (bar.id === 'import-tabs') {
        const body = document.querySelector('#view-import .import-container');
        body.hidden = id === 'import-starter-panel'; body.classList.toggle('hidden', body.hidden);
      }
      document.dispatchEvent(new CustomEvent('app:section-tab', { detail: { barId: bar.id, panelId: id } }));
    };
    for (const tab of tabs) tab.addEventListener('click', () => select(tab.getAttribute('aria-controls')));
    document.addEventListener('app:select-section', event => { if (event.detail.barId === bar.id) select(event.detail.panelId); });
    initTabKeyboard(bar);
    select(tabs[0].getAttribute('aria-controls'));
  }
}
