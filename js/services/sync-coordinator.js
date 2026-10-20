/** One coordinator for manual, debounced and visibility-triggered synchronization. */
export function createSyncCoordinator({ getCards, syncCards, applyCards, acknowledge, refresh, backup = async () => {}, isCurrent = async () => true, onState = () => {}, getScope = () => '', now = Date.now, backgroundMinIntervalMs = 30000 }) {
  let active = null;
  let timer = null;
  let changeVersion = 0;
  let lastSuccess = null;
  const execute = async () => {
    onState('syncing');
    try {
      const snapshot = await getCards();
      const result = await syncCards(snapshot);
      if (result.status === 'unconfigured') { onState('unconfigured'); return result; }
      if (!await isCurrent(result)) throw new Error('Sync settings changed. Please sync again.');
      if (result.changed) {
        await backup();
        if (!await isCurrent(result)) throw new Error('Sync settings changed. Please sync again.');
        await applyCards(snapshot, result.cards, result);
      }
      // A failed local commit never advances the remote checkpoint.
      await acknowledge(result);
      if (result.changed) await refresh();
      onState('synced');
      return result;
    } catch (error) {
      onState('failed', error);
      throw error;
    }
  };
  const schedule = delay => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; run().catch(() => {}); }, delay);
  };
  const run = ({ background = false } = {}) => {
    // Repeated visibility/manual requests share the active sync. Local edits
    // carry a revision so only actual new work schedules a follow-up.
    if (active) return active;
    const scope = getScope();
    const age = lastSuccess ? now() - lastSuccess.time : Infinity;
    if (background && lastSuccess && lastSuccess.scope === scope && lastSuccess.version === changeVersion && age >= 0 && age < backgroundMinIntervalMs) {
      onState('synced');
      return Promise.resolve({ status: 'no_change', changed: false, cached: true });
    }
    clearTimeout(timer); timer = null;
    let startedVersion;
    const work = async () => {
      startedVersion = changeVersion;
      const startedScope = getScope();
      const result = await execute();
      if (result.status !== 'unconfigured') lastSuccess = { time: now(), version: startedVersion, scope: startedScope };
      return result;
    };
    active = (typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('anamnesis-sync', work) : work())
      .catch(error => { lastSuccess = null; throw error; })
      .finally(() => {
        active = null;
        if (startedVersion !== undefined && startedVersion !== changeVersion && timer === null) schedule(0);
      });
    return active;
  };
  const request = (delay = 1200) => {
    changeVersion++;
    schedule(delay);
  };
  return { run, request, invalidate() { changeVersion++; }, get busy() { return active !== null; } };
}
