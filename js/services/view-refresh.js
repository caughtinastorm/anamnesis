/** Coalesce invalidations and refresh expensive features only while visible. */
export function createViewRefresh({ isVisible, render, onError = console.error }) {
  let dirty = true;
  let active = null;
  const flush = () => {
    if (active) return active;
    if (!dirty || !isVisible()) return Promise.resolve();
    dirty = false;
    let failed = false;
    active = Promise.resolve().then(render).catch(error => { failed = true; dirty = true; onError(error); })
      .finally(() => { active = null; });
    return active.then(() => { if (!failed && dirty && isVisible()) return flush(); });
  };
  return { invalidate() { dirty = true; return flush(); }, flush };
}
