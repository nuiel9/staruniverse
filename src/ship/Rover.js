import * as THREE from 'three';

/* ============================================================================
   The rover.

   Starflight had a terrain vehicle and it was the whole reason the ground
   existed. This one is here for the same reason: `Sites` puts things a
   kilometre or six from where you park, and a player who walks at 1.75 m/s
   cannot reach any of them. Six kilometres on foot is fifty-seven minutes.
   By rover it is four, and the four minutes are the interesting part.

   It is built in metres, because the ground scene is: one unit is one metre
   there, unlike everywhere else in the game where one unit is a kilometre.
   The ship gets around this with a rig scaled by a thousand; the rover does
   not need to, since it was never authored at hull scale.

   Three things make it a vehicle rather than a fast walk:

   **It follows the ground.** Four contact points sample the same height field
   the shader draws — `Surface.heightAt` is CPU-side and always was — and the
   chassis takes its pitch and roll from the differences between them. Driving
   across a ridge line pitches the nose properly, because the nose is actually
   measuring the ridge.

   **Slope beats throttle.** Past about thirty degrees uphill the drive gives
   up, gradually rather than with a wall, which turns a mountain into
   something you go *around*. The route is the gameplay; a vehicle that
   ignores terrain would make the terrain scenery again, which is the thing
   this whole milestone exists to fix.

   **Charge is finite and symmetric.** The pack is metres, not minutes, so
   idling costs nothing and the only question is distance. Half the pack is
   the point of no return, and the readout says so — because the interesting
   version of "how far dare I go" is one where the answer is knowable and you
   can still get it wrong.
   ========================================================================== */

/** Metres of driving in a full pack. The farthest site sits at 6.2 km, so a
 *  full charge is one round trip to the edge of the map with a little spare —
 *  tight enough to be a decision, loose enough not to be a punishment. */
export const PACK_RANGE = 14000;

const MAX_FWD = 22;            // m/s, about 80 km/h
const MAX_REV = 7;
const ACCEL = 11;
const BRAKE = 18;
const DRAG = 0.7;
const YAW_RATE = 1.5;          // rad/s at speed, scaled down when crawling

/* Grades. Below GRADE_FREE the drive does not care; by GRADE_STALL it has
   nothing left. Measured as rise over run along the direction of travel. */
const GRADE_FREE = 0.18;       // ~10°
const GRADE_STALL = 0.62;      // ~32°
/* Coarse enough to skip the fine detail band. See the note in `update`. */
const GRADE_LOD = 14;

/* And the LOD the *wheels* read.

   This was 1.0 — full detail — on the reasoning that a boulder under one
   corner ought to tilt the vehicle. That reasoning was right and the number
   was wrong: at full detail `heightAt` carries a grit band with metre-scale
   variation, and across a two-metre track a one-metre difference is fourteen
   degrees of roll. The result was a rover permanently cocked over, resting on
   a single wheel with the other three in the air — which is what a player
   sees and reports as floating.

   Raising it did not work. `heightAt` returns a coarse band plus a `fine`
   one, and the fine band is added whatever the LOD — so at 1, 3 and 8 the
   field still varied five metres across a 2.9 m wheelbase, which is not
   landform, it is rocks. The smoothing that does work is spatial: each
   contact is the mean of a small footprint, which is what a wheel physically
   is. LOD still helps a little and costs nothing, so it stays. */
const WHEEL_LOD = 8.0;

/** The fraction of drive that survives the steepest ground. Never zero. */
const CRAWL_FLOOR = 0.10;

const WHEELBASE = 2.9;
const TRACK = 2.0;

/* The rover as an obstacle-sized thing: the segment between the axle midpoints,
   swept by the half-track. 1.12 is TRACK*0.56, the same figure CONTACTS uses
   for where the wheels touch — the outer edge of the tyres, which is what a
   trunk actually meets. (`_settle` builds its sampling corners at TRACK*0.5;
   that is a different measurement and neither is a typo for the other.) */
const HULL_R = TRACK * 0.56;

/* How far ahead trees are asked for. Well inside the range over which a tiled
   instance is guaranteed to stay in the same copy — see Surface.treesNear —
   and comfortably more than a frame of travel at full speed. */
const TREE_RANGE = 25;

/* Where the four corner wheels touch, in model space. The wheels sit at
   y = 0.55 with a 0.55 radius, so the contact patch is the model's own y = 0
   plane, and the model is authored nose-toward +Z. */
const CONTACTS = [
  new THREE.Vector3(TRACK * 0.56, 0, WHEELBASE * 0.5),
  new THREE.Vector3(-TRACK * 0.56, 0, WHEELBASE * 0.5),
  new THREE.Vector3(TRACK * 0.56, 0, -WHEELBASE * 0.5),
  new THREE.Vector3(-TRACK * 0.56, 0, -WHEELBASE * 0.5),
];
const _c = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _m = new THREE.Matrix4();


export class Rover {
  constructor(game) {
    this.game = game;
    this.object = buildRover();
    this.object.visible = false;

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.charge = 1;             // 0..1 of PACK_RANGE
    this.deployed = false;
    this.hold = {};              // what the drone dug, until you get back
    this.holdCap = 6;

    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._grade = 0;
  }

  holdUsed() { return Object.values(this.hold).reduce((a, b) => a + b, 0); }

  /** Metres of driving left in the pack. */
  metresLeft() { return this.charge * PACK_RANGE; }

  /** True while there is still enough charge to get home from here. The
   *  margin is deliberate: arriving on empty is a story, arriving on empty
   *  because the readout lied is a bug report. */
  canReturn() {
    const home = Math.hypot(this.pos.x, this.pos.z);
    return this.metresLeft() >= home * 1.06;
  }

  /* --------------------------------------------------------------- deploy */

  /** Off the ramp, beside the ship, pointing away from it. */
  deploy(scene, startX, startZ) {
    if (this.deployed) return;
    this.deployed = true;
    this.pos.set(startX, 0, startZ);
    // Nose away from the hull, so the first thing you see is where you can go.
    this.yaw = Math.atan2(-startX, -startZ);
    this.speed = 0;
    this.object.visible = true;
    if (scene && this.object.parent !== scene) scene.add(this.object);
    this._settle();
  }

  /** Back on the ship. Whatever the drone dug goes into the hold, and the
   *  pack comes back full — the ship is the only place either happens. */
  stow() {
    if (!this.deployed) return null;
    this.deployed = false;
    this.object.visible = false;
    this.speed = 0;
    const eco = this.game.economy;
    let moved = 0, spilled = 0;
    for (const id in this.hold) {
      const room = eco.cargoCap - eco.cargoUsed();
      const n = Math.min(this.hold[id], Math.max(0, room));
      if (n > 0) { eco.cargo[id] = (eco.cargo[id] || 0) + n; moved += n; }
      spilled += this.hold[id] - n;
    }
    if (moved) eco.save();
    this.hold = {};
    this.charge = 1;
    this.pos.set(0, 0, 0);
    return { moved, spilled };
  }

  /** One tonne into the rover's own bin. Returns false when it will not fit,
   *  which is what makes the bin a reason to drive back rather than a number. */
  stash(id) {
    if (this.holdUsed() >= this.holdCap) return false;
    this.hold[id] = (this.hold[id] || 0) + 1;
    return true;
  }

  /* --------------------------------------------------------------- drive */

  update(dt, input, uiOpen) {
    if (!this.deployed) return;
    const gh = this._height.bind(this);

    /* The same actions the walk controller reads, so nothing new has to be
       bound and the touch stick works unchanged: W/S are thrUp/thrDn and A/D
       are yawL/yawR everywhere else on the ground. */
    let throttle = 0, steer = 0;
    if (!uiOpen && input) {
      throttle = (input.held('thrUp') ? 1 : 0) - (input.held('thrDn') ? 1 : 0)
        + (input.touch ? -input.touchL.y : 0);
      steer = (input.held('yawL') ? 1 : 0) - (input.held('yawR') ? 1 : 0)
        - (input.touch ? input.touchL.x : 0);
      throttle = THREE.MathUtils.clamp(throttle, -1, 1);
      steer = THREE.MathUtils.clamp(steer, -1, 1);
    }

    /* Grade, read as *landform* rather than as grit.

       This first sampled four metres ahead at full detail, and the rover
       promptly crawled: `heightAt` carries a fine band on top of the terrain —
       rubble, scree, metre-scale roughness — and over a four-metre baseline
       that noise routinely exceeds a thirty-degree slope on ground that looks
       flat and is flat. The acceptance suite caught it as 261 m of a 3.5 km
       run in 133 seconds, which is walking pace in a vehicle.

       So the grade is measured over a chassis-and-then-some baseline at a
       coarse LOD, which is the band the *hill* lives in. The wheels still
       sample full detail in `_settle`, because a boulder under one corner
       should absolutely tilt the vehicle — it just should not stop it. */
    const ahead = 26;
    const [fx, fz] = this.forward();
    const hHere = gh(this.pos.x, this.pos.z, GRADE_LOD);
    const hAhead = gh(this.pos.x + fx * ahead, this.pos.z + fz * ahead, GRADE_LOD);
    this._grade = (hAhead - hHere) / ahead;

    /* Only *climbing* costs you. A descent is free, which is both true and
       the thing that makes reading the landscape worth doing. */
    const climb = Math.max(0, this._grade * Math.sign(throttle || 1));
    const bite = 1 - THREE.MathUtils.smoothstep(climb, GRADE_FREE, GRADE_STALL);
    // For the readout: 0 is clear going, 1 is as steep as the drive can take.
    this.gradeLoad = 1 - bite;

    /* There is always *some* authority left.

       `bite` gated acceleration straight to zero past about thirty degrees,
       so on a steep face the rover simply would not move and nothing on
       screen said why — which is indistinguishable from a broken control, and
       was reported as one. A floor of a tenth means the worst slope in the
       game can still be crawled, slowly and at a punishing charge cost. The
       route around remains the better answer without "go around" and "you are
       stuck" being the same experience. */
    const authority = Math.max(CRAWL_FLOOR, bite);
    const wantAccel = throttle > 0 ? ACCEL * authority
      : throttle < 0 ? -ACCEL * 0.6 * authority : 0;
    if (wantAccel === 0) {
      // coast down, and stop cleanly rather than creeping forever
      const d = Math.sign(this.speed) * DRAG * dt * 6;
      this.speed = Math.abs(this.speed) <= Math.abs(d) ? 0 : this.speed - d;
    } else {
      this.speed += wantAccel * dt;
    }
    // Braking rather than reversing, when the stick opposes the roll.
    if (throttle < 0 && this.speed > 0) this.speed -= BRAKE * dt;
    if (throttle > 0 && this.speed < 0) this.speed += BRAKE * dt;

    const capF = MAX_FWD * Math.max(CRAWL_FLOOR, bite);
    this.speed = THREE.MathUtils.clamp(this.speed, -MAX_REV, capF);

    // ---- steering. A stationary rover does not pivot on the spot, and
    // reversing steers the way a reversing vehicle does.
    const grip = THREE.MathUtils.clamp(Math.abs(this.speed) / 6, 0, 1);
    this.yaw += steer * YAW_RATE * grip * dt * Math.sign(this.speed || 1);

    // ---- travel, and the pack
    const step = this.speed * dt;
    if (step) {
      this.pos.x += fx * step;
      this.pos.z += fz * step;
      /* Metres, not seconds: sitting still is free. Climbing costs more,
         because it does — and it gives the route-finding a second reason to
         exist beyond not stalling. */
      const cost = Math.abs(step) * (1 + Math.max(0, this._grade) * 1.6);
      this.charge = Math.max(0, this.charge - cost / PACK_RANGE);
      if (this.charge <= 0) this.speed = 0;
    }

    /* Trees, after the step and before the body is seated: a push-out changes
       where the wheels are, so the attitude has to be worked out from the
       corrected position rather than from the one the drive asked for. */
    this._collide();

    this._settle();
  }

  /** The heading, in the sense the rest of the game uses: forward at yaw 0
   *  is -Z, and yaw increases to the left. Matching `Player` matters, because
   *  A and D have to turn the same way whether you are walking or driving. */
  forward() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }

  /** Compass bearing of travel, for a readout that agrees with the survey. */
  heading() {
    const [fx, fz] = this.forward();
    return (Math.atan2(fx, fz) * 180 / Math.PI + 360) % 360;
  }

  /** Sit the chassis on the ground, pitched and rolled to match it. */
  _settle() {
    const gh = this._height.bind(this);
    const [fx, fz] = this.forward();
    const rx = -fz, rz = fx;                    // right-hand side of travel
    const hb = WHEELBASE * 0.5, ht = TRACK * 0.5;

    // The four wheel contacts, in the ground plane around the current centre.
    const corners = [[hb, -ht], [hb, ht], [-hb, -ht], [-hb, ht]].map(([a, b]) => ({
      a, b, y: this._footprint(this.pos.x + fx * a + rx * b, this.pos.z + fz * a + rz * b),
    }));
    const [fl, fr, bl, br] = corners.map((c) => c.y);

    /* The attitude from the contacts rather than from the height field's own
       gradient: the wheels are what touches the ground, and real ground under
       one corner should tilt the vehicle even though the analytic normal at
       the centre knows nothing about it. */
    const pitch = Math.atan(((bl + br) - (fl + fr)) / (2 * WHEELBASE));
    const roll = Math.atan(((fl + bl) - (fr + br)) / (2 * TRACK));
    this.tilt = Math.max(Math.abs(pitch), Math.abs(roll));

    /* Seat it on the *lowest* wheel, measured rather than predicted.

       Two wrong answers came before this one. Averaging the four ground
       heights is right only on a plane: the moment the body tilts, each
       corner rises or falls by its own lever arm, so a convex rise buries the
       uphill wheels and a concave dip lifts the whole vehicle clear. The
       second case is what a player sees, and what they reported as a floating
       rover. Predicting the corner offsets analytically was the second wrong
       answer — after three successive rotateX/Y/Z calls, `object.rotation` is
       not (pitch, yaw, roll), so the prediction and the mesh disagreed and it
       still hung three metres up.

       So: orient the body, let three.js compose the matrix, ask it where the
       wheels actually ended up, and raise everything by whatever the deepest
       one is short. Exact regardless of rotation order or Euler convention,
       and the suite measures the same contacts it does. */
    /* Orient from a basis, not from three successive Euler turns.

       The model is authored nose-toward +Z, so after the half turn that puts
       its nose along the world's forward, its local +X points *left* — which
       silently inverted both the pitch and the roll applied after it. Building
       the basis directly removes every sign there was to get wrong: local +Z
       becomes the travel direction laid onto the slope, local +Y becomes the
       surface normal, and local +X falls out of the cross product. */
    /* The normal comes from the samples themselves, in world space. Building
       it from the pitch/roll angles instead mixed two frames — those angles
       are about the *body's* axes and were being written into world
       components — and the attitude that came out did not match the ground
       under it, so the uphill wheels hung five metres in the air. Two tangents
       across the wheelbase and the track, crossed, cannot get that wrong. */
    _fwd.set(fx * WHEELBASE, (fl + fr) * 0.5 - (bl + br) * 0.5, fz * WHEELBASE);
    _right.set(rx * TRACK, (fr + br) * 0.5 - (fl + bl) * 0.5, rz * TRACK);
    _up.crossVectors(_right, _fwd).normalize();
    if (_up.y < 0) _up.negate();
    _fwd.addScaledVector(_up, -_fwd.dot(_up)).normalize();
    _right.crossVectors(_up, _fwd).normalize();
    _m.makeBasis(_right, _up, _fwd);
    this.object.quaternion.setFromRotationMatrix(_m);
    this.object.position.set(this.pos.x, 0, this.pos.z);
    this.object.updateMatrixWorld(true);

    let lift = -Infinity;
    for (const p of CONTACTS) {
      _c.copy(p).applyMatrix4(this.object.matrixWorld);
      lift = Math.max(lift, this._footprint(_c.x, _c.z) - _c.y);
    }
    this.pos.y = lift;
    this.object.position.y = lift;
    this.object.updateMatrixWorld(true);

    // wheels spin at road speed
    const wr = 0.55;
    this._spin = (this._spin || 0) + this.speed / wr * 0.016;
    for (const w of this.object.userData.wheels) w.rotation.x = this._spin;
  }

  /** Trunks are solid.
   *
   * The rover is a capsule — the segment between the axle midpoints, swept by
   * the half-track — and each trunk is a circle. Two resolutions rather than
   * one, because pushing out of one trunk can push into its neighbour and a
   * stand is exactly where that happens; two is enough for a pair and the
   * third case is rare enough to leave to the next frame.
   *
   * What is removed is only the *inward* part of the motion. `speed` here is a
   * scalar along the heading, so that is expressed against the contact normal:
   * a square hit has the heading anti-parallel to the normal and stops the
   * vehicle, a glancing one keeps nearly all of it and the push-out slides the
   * rover along the trunk. Zeroing the speed outright would make every brush
   * past a tree feel like hitting a wall, which is the same complaint in a
   * different costume.
   *
   * Canopies are not obstacles. The tree shader draws a real crown you can
   * walk under and that stays true — only the bole is here.
   */
  _collide() {
    const S = this.game && this.game.surface;
    if (!S || typeof S.treesNear !== 'function') return;
    const near = S.treesNear(this.pos.x, this.pos.z, TREE_RANGE);
    if (!near.length) return;

    const [fx, fz] = this.forward();
    const hb = WHEELBASE * 0.5;
    for (let pass = 0; pass < 2; pass++) {
      const ax = this.pos.x + fx * hb, az = this.pos.z + fz * hb;
      const bx = this.pos.x - fx * hb, bz = this.pos.z - fz * hb;
      const abx = bx - ax, abz = bz - az;
      const L2 = abx * abx + abz * abz;

      // the deepest overlap first: resolving the worst one is what makes two
      // passes enough
      let deepest = 0, hx = 0, hz = 0, hL = 0;
      for (let i = 0; i < near.length; i++) {
        const t = near[i];
        let u = L2 > 0 ? ((t.x - ax) * abx + (t.z - az) * abz) / L2 : 0;
        u = u < 0 ? 0 : (u > 1 ? 1 : u);
        const dx = ax + abx * u - t.x, dz = az + abz * u - t.z;
        const L = Math.hypot(dx, dz);
        const pen = (HULL_R + t.r) - L;
        if (pen > deepest) { deepest = pen; hx = dx; hz = dz; hL = L; }
      }
      if (deepest <= 0) return;

      /* Dead centre — the axle line straight through the trunk's own centre —
         has no normal to speak of, so back out the way we came in. */
      let nx, nz;
      if (hL > 1e-4) { nx = hx / hL; nz = hz / hL; } else { nx = -fx; nz = -fz; }

      this.pos.x += nx * deepest;
      this.pos.z += nz * deepest;
      const along = fx * nx + fz * nz;
      this.speed *= 1 - along * along;
      // and stop cleanly rather than creeping into the bark forever
      if (Math.abs(this.speed) < 0.05) this.speed = 0;
    }
  }

  /**
   * How the wheels are sitting, in metres.
   *
   * `low` is the gap under the *lowest* wheel and is the number that says
   * whether the vehicle is planted: zero is resting, positive is the whole
   * body hanging in the air, negative is a wheel through the ground. `spread`
   * is low-to-high, which is just how uneven the terrain is under it — a
   * rigid four-wheeled body on a rock will always have a wheel up, and that
   * is what suspension exists for rather than a defect.
   *
   * The first version of this returned the largest *absolute* gap, which
   * conflated the two and failed the vehicle for being on bumpy ground.
   */
  contacts() {
    this.object.updateMatrixWorld(true);
    let low = Infinity, high = -Infinity;
    for (const p of CONTACTS) {
      _c.copy(p).applyMatrix4(this.object.matrixWorld);
      const d = _c.y - this._footprint(_c.x, _c.z);
      if (d < low) low = d;
      if (d > high) high = d;
    }
    return { low, spread: high - low };
  }

  _height(x, z, lod = 1.0) {
    const s = this.game.surface;
    return s && s.heightAt ? s.heightAt(x, z, lod) : 0;
  }

  /**
   * Ground under a wheel, as the wheel experiences it.
   *
   * A point sample makes a 0.55 m wheel infinitely sharp: it drops into every
   * crack in the fine band and the body pivots off a rock the tyre would
   * simply roll over. Averaging a small footprint is the cheap stand-in for a
   * contact patch, and it is what finally stopped the vehicle standing on one
   * corner with the rest in the air.
   */
  _footprint(x, z) {
    const r = 0.75;
    return (this._height(x, z, WHEEL_LOD)
      + this._height(x + r, z, WHEEL_LOD)
      + this._height(x - r, z, WHEEL_LOD)
      + this._height(x, z + r, WHEEL_LOD)
      + this._height(x, z - r, WHEEL_LOD)) * 0.2;
  }

  /** Where the chase camera wants to be, in ground metres. */
  cameraPose(out, aim) {
    const back = 9.5, up = 4.2;
    const [fx, fz] = this.forward();
    out.set(this.pos.x - fx * back, this.pos.y + up, this.pos.z - fz * back);
    const gy = this._height(out.x, out.z);
    if (out.y < gy + 2.0) out.y = gy + 2.0;      // never inside the hill
    aim.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
  }
}

/* ------------------------------------------------------------------ model */

/* Built in metres and deliberately plain. It is a working vehicle carried in
   a survey ship's bay: a flat deck, a rocker beam a side, six wheels, a mast
   for the scanner and a bin at the back for whatever the drone brings up. */
function buildRover() {
  const root = new THREE.Group();
  const wheels = [];

  const paint = new THREE.MeshStandardMaterial({
    color: 0x9aa3a8, roughness: 0.62, metalness: 0.35,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x2b3238, roughness: 0.78, metalness: 0.45,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x15181b, roughness: 0.95, metalness: 0.0,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: 0x0a1a20, roughness: 0.3, metalness: 0.1,
    emissive: new THREE.Color(0x3fd8e8), emissiveIntensity: 1.6,
  });

  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // deck and belly
  box(TRACK * 0.92, 0.26, WHEELBASE * 1.18, paint, 0, 1.02, 0);
  box(TRACK * 0.70, 0.30, WHEELBASE * 0.95, dark, 0, 0.78, 0);

  // rocker beams, one a side
  box(0.16, 0.20, WHEELBASE * 1.22, dark, -TRACK * 0.50, 0.80, 0);
  box(0.16, 0.20, WHEELBASE * 1.22, dark, TRACK * 0.50, 0.80, 0);

  // six wheels
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.38, 18);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const zz of [WHEELBASE * 0.5, 0, -WHEELBASE * 0.5]) {
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, rubber);
      w.position.set(s * TRACK * 0.56, 0.55, zz);
      w.castShadow = true;
      // Spin is about the vehicle's X. The geometry is already turned to lie
      // across the hull, so the mesh's own X is the axle.
      const pivot = new THREE.Group();
      pivot.position.copy(w.position);
      w.position.set(0, 0, 0);
      pivot.add(w);
      root.add(pivot);
      wheels.push(w);
    }
  }

  // cargo bin at the back, open-topped
  box(TRACK * 0.66, 0.44, 0.9, dark, 0, 1.37, -WHEELBASE * 0.42);

  // scanner mast and head
  box(0.10, 1.15, 0.10, dark, TRACK * 0.28, 1.72, -WHEELBASE * 0.20);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), paint);
  head.position.set(TRACK * 0.28, 2.34, -WHEELBASE * 0.20);
  root.add(head);

  // forward drone arm, folded
  box(0.12, 0.12, 1.25, paint, -TRACK * 0.22, 1.24, WHEELBASE * 0.52);

  // running lights, so it reads at range in a dark landscape
  box(0.34, 0.07, 0.05, glow, -TRACK * 0.24, 1.20, WHEELBASE * 0.60);
  box(0.34, 0.07, 0.05, glow, TRACK * 0.24, 1.20, WHEELBASE * 0.60);

  root.userData.wheels = wheels;
  return root;
}
