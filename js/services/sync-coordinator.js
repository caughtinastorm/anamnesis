/** One coordinator for manual, debounced and visibility-triggered synchronization. */
export function createSyncCoordinator({ getCards, syncCards, applyCards, acknowledge, refresh, backup = async () => {}, onState = () => {} }) {
  let active = null;
  let timer = null;
  let queued = false;
  const execute = async () => {
    onState('syncing');
    try {
      const snapshot = await getCards();
      const result = await syncCards(snapshot);
      if (result.status === 'unconfigured') { onState('unconfigured'); return result; }
      if (result.changed) { await backup(); await applyCards(snapshot, result.cards); }
      // A failed local commit never advances the remote checkpoint.
      await acknowledge(result);
      await refresh();
      onState('synced');
      return result;
    } catch (error) {
      onState('failed', error);
      throw error;
    }
  };
  const run = () => {
    clearTimeout(timer);
    if (active) { queued = true; return active; }
    const work = () => execute();
    active = (typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('anamnesis-sync', work) : work())
      .finally(() => {
        active = null;
        if (queued) { queued = false; request(0); }
      });
    return active;
  };
  const request = (delay = 1200) => {
    clearTimeout(timer);
    timer = setTimeout(() => { run().catch(() => {}); }, delay);
  };
  return { run, request, get busy() { return active !== null; } };
}
