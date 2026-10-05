// Some browsers expose coalesced/raw pointer events but report zero deltas in
// them while the enclosing event (or compatibility mouse event) has movement.
export function movementSamples(event) {
  const useful = e => Number.isFinite(e.movementX) && Number.isFinite(e.movementY) && (e.movementX !== 0 || e.movementY !== 0);
  const coalesced = event.getCoalescedEvents?.() || [];
  const samples = coalesced.filter(useful);
  return samples.length ? samples : useful(event) ? [event] : [];
}
