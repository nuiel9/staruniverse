/* Is this PNG actually a picture of anything?
 *
 * A capture can fail by producing a frame rather than by producing an error.
 * A full-set build came back with y-landed as a sheet of solid magenta — the
 * compositor handing over an uninitialised surface under sustained load — and
 * every layer downstream reported success: probe printed "shot y-landed.png
 * fps=60 calls=70", identical to the good one, and levels.mjs dutifully
 * measured it as mean 105.0, p1 105, p50 105, p99 105. The one statistic that
 * said "this is not an image" was sitting in the output and nobody reads a
 * table looking for p1 == p99. reprocheck then called it an 84% difference,
 * which is true and useless: it sent a search for a determinism bug that was
 * not there.
 *
 * This project has shipped that shape of mistake repeatedly — a screenshot of
 * the title card with a plausible frame rate printed beside it, a frame of a
 * different star system presented for judging. The lesson each time is the
 * same: a capture that cannot have worked must say so at the moment it
 * happens, not leave a number in a table for someone to notice later.
 *
 * One ffmpeg pass, the same dependency imgdiff already needs.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * The frame's luminance range, or null if it cannot be read.
 * @returns {{min:number, max:number, flat:boolean}|null}
 */
export function frameRange(png) {
  if (!fs.existsSync(png)) return null;
  const tmp = `/tmp/_flat-${process.pid}.gray`;
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png,
      '-vf', 'scale=160:100,format=gray', '-f', 'rawvideo', tmp]);
  } catch { return null; }
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  if (!buf.length) return null;
  let min = 255, max = 0;
  for (const v of buf) { if (v < min) min = v; if (v > max) max = v; }
  /* Not zero. A legitimately near-empty frame exists — a starfield at low
     exposure is mostly black — but it still has stars in it, so it still has
     range. A frame with under two levels across the whole image is a surface
     that was never drawn into. */
  return { min, max, flat: max - min < 2 };
}

/**
 * Shout if a capture produced something that cannot be a render.
 * Returns true when the frame is fine.
 */
export function assertRendered(png, label = png) {
  const r = frameRange(png);
  if (!r) { console.log(`[capture] ${label}: could not be read back`); return false; }
  if (r.flat) {
    console.log(`[capture] ${label}: FLAT FRAME — every pixel within one level `
      + `(${r.min}..${r.max}). The render did not reach the screenshot; this is a `
      + `failed capture, not a picture of the game.`);
    return false;
  }
  return true;
}
