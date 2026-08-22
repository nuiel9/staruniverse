/* How ground resists a drive.
 *
 * This was four constants and a curve private to Rover, which was right while
 * the rover was the only thing that cared. Site placement cares now: it scores
 * the approach to a candidate position by asking how long the drive would take,
 * and a score that approximated this curve rather than using it would drift the
 * first time the curve was tuned — placing sites for a vehicle that no longer
 * exists.
 *
 * So it lives here, owned by neither. Sites reaching into the rover for
 * constants would be the wrong direction: where a place can go is a property of
 * the world and the vehicles that cross it, not of one vehicle.
 */

/* Grades. Below GRADE_FREE the drive does not care; by GRADE_STALL it has
   given up. Past about thirty degrees uphill a mountain becomes something you
   go around, which is the point — the route is the gameplay. */
export const GRADE_FREE = 0.18;       // ~10°
export const GRADE_STALL = 0.62;      // ~32°

/** The fraction of drive that survives the steepest ground. Never zero.
 *  "Go around is faster" and "you are stuck with no explanation" must not be
 *  the same experience, so the worst slope in the game can still be crawled. */
export const CRAWL_FLOOR = 0.10;

export const MAX_FWD = 22;            // m/s, about 80 km/h

/** smoothstep, in three's argument order, so this module needs no three. */
function smoothstep(x, a, b) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The unfloored curve underneath driveBiteAt — 1 on the flat, falling to 0 by
 * GRADE_STALL rather than resting at CRAWL_FLOOR. Exists for readouts that
 * need to tell "the drive is crawling at the floor" apart from "the drive has
 * given up entirely", which driveBiteAt's floor makes look the same. Everyone
 * who only wants the drivable fraction wants driveBiteAt, not this.
 *
 * Only climbing costs: a descent is free, which is both true and the thing
 * that makes reading the landscape worth doing. `climb` may be signed — a
 * descent, or a route scorer's raw `(h1 - h0) / step` — the negative half is
 * resolved to zero here rather than by the caller.
 *
 * @param {number} climb  rise over run; only positive values cost anything
 * @returns {number} 0..1, unfloored
 */
export function driveBiteRawAt(climb) {
  return 1 - smoothstep(Math.max(0, climb), GRADE_FREE, GRADE_STALL);
}

/**
 * How much of the drive survives a grade: 1 on the flat, falling to
 * CRAWL_FLOOR's floor on the steepest ground. Everything that cares how ground
 * resists a vehicle goes through here — the rover for its acceleration and its
 * speed cap, the site scorer for how long a route would take — so there is one
 * curve rather than two that agree until someone tunes one of them.
 *
 * @param {number} climb  rise over run; only positive values cost anything
 * @returns {number} 0..1, never below CRAWL_FLOOR
 */
export function driveBiteAt(climb) {
  return Math.max(CRAWL_FLOOR, driveBiteRawAt(climb));
}

/**
 * Metres per second the drive can hold on a given grade. A thin wrapper over
 * driveBiteAt — kept as its own export because "how fast" is the question
 * most callers actually have.
 *
 * @param {number} climb  rise over run; only positive values cost anything
 * @returns {number} m/s, never below MAX_FWD * CRAWL_FLOOR
 */
export function driveSpeedAt(climb) {
  return MAX_FWD * driveBiteAt(climb);
}

/* What a climbed metre costs the pack, on top of itself.
 *
 * This lived as a bare 1.6 inside Rover's travel step, which was fine while
 * the rover was the only thing spending charge and nothing else had to predict
 * the spend. It is not fine now: the ground chart has to answer "can I get
 * there and back", and a chart that estimates the drain with its own number
 * would agree with the vehicle only until one of them was tuned.
 *
 * It sits beside the speed curve because it is the same fact seen twice — a
 * hill takes longer *and* costs more, and both are properties of the ground
 * arguing with a drive, not of the vehicle's bookkeeping. */
export const GRADE_DRAIN = 1.6;

/**
 * Pack metres burned per metre driven at a given grade: 1 on the flat, more
 * uphill, and never less than 1 — a descent is free but does not refund.
 *
 * @param {number} climb  rise over run; only positive values cost anything
 * @returns {number} multiplier, >= 1
 */
export function driveDrainAt(climb) {
  return 1 + Math.max(0, climb) * GRADE_DRAIN;
}

/* What real ground costs over a real route, as a single number.
 *
 * Not a fudge factor: it is the measured ratio of route drain to straight-line
 * distance, 1.2 to 1.4 across the runs that set the site placement cap, taken
 * at 1.45 to sit past what was measured. Site placement already derived its
 * ceiling from it and the ground chart's rings are drawn with it, so it lives
 * here rather than as the same arithmetic written out in two files.
 *
 * Anything that can afford to score the actual route should score it — this is
 * for the cases that cannot, which is precisely the ones that have to answer
 * for every direction at once. A ring is a circle; the ground is not. */
export const TYPICAL_TERRAIN_COST = 1.45;
