/** Browser preferences are adapters, not scheduler inputs hidden in domain code. */
export function readPreference(key, fallback = null) {
  try { return typeof localStorage === 'undefined' ? fallback : localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}
export function getTargetRetention() {
  const value = Number.parseFloat(readPreference('app-target-retention', '0.90'));
  return Number.isFinite(value) && value >= 0.70 && value <= 0.98 ? value : 0.90;
}
export function setTargetRetention(rate) {
  const value = Math.min(0.98, Math.max(0.70, Number.parseFloat(rate) || 0.90));
  try { localStorage.setItem('app-target-retention', value.toFixed(2)); } catch {}
  return value;
}
