/** Shared dialog keyboard behavior without coupling feature controllers. */
export function initAccessibility() {
  const focusable = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const visible = element => !element.closest('.hidden') && getComputedStyle(element).display !== 'none';
  const dialogs = [...document.querySelectorAll('.modal-overlay')];
  const previousFocus = new WeakMap();
  const open = new Set();
  const sync = () => {
    for (const overlay of dialogs) {
      const dialog = overlay.querySelector('.modal-content') || overlay;
      if (visible(overlay)) {
        if (open.has(overlay)) continue;
        open.add(overlay);
        previousFocus.set(overlay, document.activeElement);
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        const title = dialog.querySelector('h2, h3, [id$="title"]');
        if (title) {
          title.id ||= `${overlay.id}-accessible-title`;
          dialog.setAttribute('aria-labelledby', title.id);
        }
        dialog.tabIndex = -1;
        const first = [...dialog.querySelectorAll(focusable)].find(visible);
        (first || dialog).focus();
      } else if (open.delete(overlay)) {
        const previous = previousFocus.get(overlay);
        if (previous?.isConnected && visible(previous)) previous.focus();
      }
    }
  };
  for (const dialog of dialogs) new MutationObserver(sync).observe(dialog, { attributes: true, attributeFilter: ['class', 'style'] });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const overlay = [...open].at(-1);
    if (!overlay) return;
    const content = overlay.querySelector('.modal-content') || overlay;
    const targets = [...content.querySelectorAll(focusable)].filter(visible);
    if (!targets.length) { event.preventDefault(); content.focus(); return; }
    const first = targets[0], last = targets.at(-1);
    if (event.shiftKey && (document.activeElement === first || !content.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !content.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }, true);
  const toasts = document.getElementById('toast-container');
  if (toasts) { toasts.setAttribute('role', 'status'); toasts.setAttribute('aria-live', 'polite'); toasts.setAttribute('aria-atomic', 'false'); }
  sync();
}
