/** Frontend-local adapter shape, NOT a ratified FastAPI / WebSocket protocol.
 * UI uses only projections returned by snapshot(), and command results from send().
 * Future server adapter must enforce identity, deadline, view version and command guards.
 */
export const REQUIRED_SEMANTICS = 1;
export function assertCompatible(view) {
  if (!view || view.semanticVersion !== REQUIRED_SEMANTICS) throw new Error('视图语义版本不兼容，请刷新或升级客户端');
  return view;
}
export function remaining(deadline, now = Date.now()) {
  return deadline == null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function formatRemaining(deadline, now = Date.now()) {
  const seconds = remaining(deadline, now);
  return seconds == null ? '—' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
/** Non-secret public events are hints. Gaps and unknown versions force a snapshot. */
export function evaluateEvent(event, lastSequence) {
  if (!event || event.semanticVersion !== REQUIRED_SEMANTICS) return 'resync';
  if (event.sequence <= lastSequence) return 'ignore';
  return event.sequence === lastSequence + 1 ? 'resync' : 'resync';
}
