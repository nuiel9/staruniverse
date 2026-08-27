/* Does the bottom band of the HUD overlap itself?
 *
 * Three elements share the bottom of the frame — the drive warning, the
 * interaction prompt, the subtitle — and the history of that band is a history
 * of guessed offsets colliding. The prompt was pinned at 16%, then 11.5%, and
 * measured a 21px overlap at 945px tall before it was made a child of
 * #narrStack. The drive warning was pinned above the key row and landed under
 * the subtitle. The key row itself then stayed at bottom:14px against a stack
 * anchored at 4%, and a fold line arriving while a prompt was up drew the
 * sentence straight through the key pills.
 *
 * Each of those was found by someone looking at a screenshot. This measures it,
 * which is what makes moving anything in that band safe: the point is not that
 * the current layout passes, it is that the next one has to.
 *
 * Rectangles, not pixels — no game boot and no rendering, so it runs in seconds
 * on a machine too slow to screenshot. It populates the band the way the game
 * does: a two-line subtitle with a speaker, a prompt, and the full key row.
 *
 *   npm run dev        in one terminal
 *   npm run hudcheck   in another
 */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:5173/';

/* Four shapes, chosen for what each one stresses: a laptop, a large desktop, a
   short window where the band has least room, and a narrow portrait one where
   the key row wraps or drops out entirely. */
const SIZES = [[1000, 600], [1512, 945], [820, 500], [600, 900]];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
/* attached, not visible: #hud carries .hidden until the game starts, and this
   check deliberately never starts it. */
await page.waitForSelector('#hints', { state: 'attached', timeout: 30000 });

const POPULATE = `
  const hud = document.getElementById('hud');
  hud.classList.remove('hidden'); hud.classList.add('on');
  const nt = document.getElementById('narrText');
  nt.classList.add('on');
  nt.innerHTML = '<span class="who">REGISTRY RELAY</span>'
    + 'Fold complete. You are inside the stillness, Long Margin.';
  const p = document.getElementById('prompt');
  p.classList.remove('hidden');
  document.getElementById('promptLabel').textContent = 'STELLAR CARTOGRAPHY';
  document.getElementById('promptHint').textContent = 'Plot a fold';
  document.getElementById('hints').innerHTML =
    ['WASD move','MOUSE look','E use','SHIFT run','V outside view']
      .map(s => '<span><kbd>' + s.split(' ')[0] + '</kbd>'
        + s.split(' ').slice(1).join(' ') + '</span>').join('');
`;

const measure = async (label, restoreOld) => {
  const rows = [];
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    rows.push({ vp: `${w}x${h}`, ...await page.evaluate(`(()=>{
      ${POPULATE}
      if (${restoreOld ? 'true' : 'false'}) {
        const hints = document.getElementById('hints');
        hints.style.position = 'absolute'; hints.style.left = '50%';
        hints.style.bottom = 'calc(14px + var(--safe-b))';
        hints.style.transform = 'translateX(-50%)';
      }
      const rect = (id) => { const b = document.getElementById(id).getBoundingClientRect();
        return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; };
      const a = rect('narrText'), b = rect('hints'), c = rect('prompt');
      const ov = (x, y) => Math.max(0, Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top));
      return { narrText:a, hints:b,
               narrHints: ov(a,b), promptHints: ov(c,b), promptNarr: ov(c,a) };
    })()`) });
  }
  console.log(`--- ${label}`);
  for (const r of rows) {
    console.log(`  ${r.vp.padEnd(9)} subtitle ${r.narrText.top}..${r.narrText.bottom}`
      + `  keys ${r.hints.top}..${r.hints.bottom}`
      + `  | overlap subtitle/keys ${r.narrHints}  prompt/keys ${r.promptHints}`
      + `  prompt/subtitle ${r.promptNarr}`);
  }
  return Math.max(...rows.map((r) => r.narrHints + r.promptHints + r.promptNarr));
};

const now = await measure('as it stands', false);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hints', { state: 'attached', timeout: 30000 });
/* The control. A layout check that cannot fail on the layout it was written for
   proves nothing about the one that replaced it, so the old anchoring goes back
   on by hand and the overlap has to reappear. */
const old = await measure('control: the old bottom:14px anchoring, re-applied', true);

console.log(`\nworst overlap   now ${now}px   old anchoring ${old}px`);
await browser.close();
if (now > 0) { console.log('FAIL  the bottom band overlaps itself'); process.exit(1); }
if (old === 0) { console.log('FAIL  the control did not reproduce the old overlap — this check is blind'); process.exit(1); }
console.log('ok    the bottom band is clear, and the check can still see an overlap');
