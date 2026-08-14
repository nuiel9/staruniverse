/* The detail tier, and who gets to choose it.
 *
 * The three tiers have existed for a long time and reach a long way — Engine's
 * supersample and pixel-ratio ceiling, PostFX's streak pass, the terrain's step
 * counts, planet LOD thresholds, asteroid and mote counts, fleet budget, sky
 * cube resolution, star count, cabin dust. What did not exist was any way for
 * the player to say which one they wanted. The tier was guessed from
 * navigator.deviceMemory and hardwareConcurrency, which is a reasonable guess
 * and is still the default, but a guess is all it is: the same core count means
 * something different with a discrete GPU behind it than without one, and a
 * player who would rather have sixty frames than a sharper horizon had no way
 * to say so.
 *
 * Precedence is URL, then the player's choice, then the guess. The URL wins
 * because that is what the capture tooling passes (`?q=low`), and a stored
 * preference silently re-tiering a review capture would be its own small
 * disaster — a judge would be comparing two different renderers and told they
 * were the same one.
 *
 * Changing it reloads. Almost everything a tier touches is decided at
 * construction — the terrain's defines are compiled into the shader, the
 * asteroid field's instance buffers are sized once, planet LOD meshes are built
 * up front — so there is no honest way to move between tiers in place. A reload
 * lands back on the title card, which is where the control is, so the loop
 * closes where the player already is.
 */

const KEY = 'su.detail';
export const TIERS = ['low', 'medium', 'high'];

/** The player's stored choice, or null if they have never made one. */
export function storedDetail() {
  try {
    const v = localStorage.getItem(KEY);
    return TIERS.includes(v) ? v : null;
  } catch { return null; }         // private browsing, storage disabled
}

/** Remember a choice. Returns false if it could not be stored. */
export function setStoredDetail(tier) {
  if (!TIERS.includes(tier)) return false;
  try { localStorage.setItem(KEY, tier); return true; } catch { return false; }
}

/**
 * Mount the tier control, in the shape of the language toggle beside it.
 * `onPick` is handed the chosen tier; the caller decides what that means.
 */
export function mountDetailToggle(el, current, onPick, label = (t) => t.toUpperCase()) {
  if (!el) return null;
  let shown = current;
  const paint = (sel) => {
    shown = sel;
    el.innerHTML = TIERS.map((id) =>
      `<button data-detail="${id}" class="${id === sel ? 'on' : ''}">${label(id)}</button>`).join('');
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-detail]');
    // Against what is on screen now, not against what was current at mount:
    // the caller repaints this control when the language changes, and a stale
    // capture here would make picking the already-selected tier reload.
    if (!b || b.dataset.detail === shown) return;
    paint(b.dataset.detail);
    onPick(b.dataset.detail);
  });
  paint(current);
  return paint;
}
