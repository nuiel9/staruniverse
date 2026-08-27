import * as THREE from 'three';
import { clockNow } from '../core/clock.js';

/* ============================================================================
   A light over every site you have not worked yet.

   `Sites` places things up to 4.5 km from where the ship parks and gives them
   an arrival radius of 45 to 70 m — and until now placed *nothing in the
   world* to mark them. A site was a row on a chart and a circle in a data
   structure; the ground where it stood looked exactly like the ground beside
   it. So the drive out was instrument flying: hold the bearing the chart
   quotes, watch the range fall, and hope, with the one instrument that could
   tell you any of it sitting in a corner panel that starts closed and opens on
   a key nobody is told about.

   That is the complaint "I drive but it seems not reach", and it is not the
   same complaint as "too far", which has been measured and fixed four times.
   Every site now fits a round trip. What was missing is that you cannot steer
   at a thing you cannot see.

   The beam is the whole fix: a column of light rooted at the site, tall enough
   to clear the ridge in front of it, bright enough to punch through AgX, and
   visible from the far side of the pack's range. It turns the drive from
   "hold 121 degrees" into "go to the light", which is the one navigation
   instruction that needs no instrument at all.

   Three decisions worth writing down.

   **Only what is unworked.** A beam over a spent seam is scenery, and scenery
   that looks exactly like a live objective is worse than none — it sends you
   across four kilometres to arrive at something already done. Liveness is
   re-read every frame from the same two sources the chart reads, so working a
   site puts its light out while you stand under it.

   **The width is angular, not metric.** A seven-metre column at 4.5 km
   subtends about 1.6 mrad, which at a 60-degree vertical field over 900 px is
   a beam one and a third pixels wide — a faint dotted line that bloom eats.
   Anything whose job is to be seen from the far end of its own range has to
   hold a floor in *pixels*, so the width grows with distance and the column
   holds roughly a constant angular size past the first few hundred metres.

   **Terrain still occludes it.** Depth test on, depth write off. A beam behind
   a ridge is hidden by the ridge, which is the honest picture and also the
   good one: cresting a rise and finding the light already there is the moment
   the whole feature exists for. The height is what decides how often that
   happens, and it is set so the faint upper half clears ordinary relief while
   the bright base stays a column rather than a wall when you park beside it.
   ========================================================================== */

/* The chart's palette, exactly — `GroundMap`'s STYLE, kind for kind. The point
   of the beam is that you can look from the light to the chart and back and
   know you are being told about the same thing, and a colour that agrees
   everywhere is the cheapest way to say so.

   One note for whoever revisits the art direction: `marker` is a Hush site,
   and the world's rule is that Hush light is CHOIR_HUE, the pale gold-green in
   greeble.js. The chart has called markers violet since it was written, and
   matching the chart is what makes the beam legible, so the chart wins here.
   If the rule should win instead, this table is the only place to change. */
const KIND_COLOR = {
  seam: 0x7fd7a8,
  wreck: 0xe8a44c,
  marker: 0xc98bff,
  survivor: 0xff6b6b,
};

/* Metres. Tall enough that the faint top half shows over the sort of relief
   that sits between you and a site at this range, short enough that standing
   at the base is not standing inside a wall of light. The brightness gradient
   below does most of the work of making those two compatible. */
const HEIGHT = 460;

/* The angular floor, in radians of width — about 3.4 mrad, which is three
   pixels at a 60-degree field over 900 px, and the width below which a bloomed
   line stops reading as a column and starts reading as noise. */
const ANG_W = 0.0034;
const W_MIN = 7;      // metres, close up: a column you can walk around
const W_MAX = 30;     // metres, and no wider, or the far ones read as walls

/* A navigation light pulses, because a steady point in a landscape full of
   steady points is not distinguishable from a rock catching the sun. Slow
   enough to be a beacon rather than an alarm. */
const PULSE_HZ = 0.42;

const VERT = /* glsl */`
precision highp float;
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/* No `discard` anywhere in here, deliberately. The ground shader this beam is
   drawn against writes gl_FragDepth, and Surface.js records that discard
   beside gl_FragDepth mis-compiles under ANGLE — which is why the canopy is
   solid triangles rather than alpha cards. An additive beam does not need it:
   where the gradient reaches zero the contribution is zero. */
const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec3  uColor;
uniform float uGain;
uniform float uAlpha;
void main(){
  /* Across: soft-edged, squared so the falloff is a column of light and not a
     flat ribbon with two hard sides. */
  float ex = abs(vUv.x - 0.5) * 2.0;
  float edge = 1.0 - ex;
  edge *= edge;

  /* Up: bright at the root and a long faint taper. The base is what says
     "the thing is HERE, at this spot"; the taper is what clears the ridge and
     is seen from four kilometres. One gradient does both jobs. */
  float core = exp(-vUv.y * 2.7) + 0.16;
  float top  = 1.0 - smoothstep(0.62, 1.0, vUv.y);

  float a = edge * core * top * uAlpha;
  gl_FragColor = vec4(uColor * uGain * a, a);
}
`;

export class SiteBeacons {
  constructor(game) {
    this.game = game;
    this.beams = [];
    this.body = null;
    /* One unit quad for every beam. Anchored so y runs 0..1 upward from the
       base, because the base is the thing being placed and a centred quad
       would need the height folded into every position. */
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.translate(0, 0.5, 0);
    this._v = new THREE.Vector3();
  }

  /**
   * Raise a beam over every unworked site on this body.
   *
   * Called once per landing, from `_finishGround`. The surface scene is thrown
   * away on liftoff, so the meshes go with it — but the materials are ours and
   * are disposed explicitly, because `tools/leaks.mjs` counts programs and a
   * per-landing material that nothing releases is exactly what it exists to
   * catch.
   *
   * @param {object} body   the landed body
   * @param {THREE.Scene} scene  the surface scene, metres, +Y up
   */
  build(body, scene) {
    this.clear();
    const g = this.game;
    if (!body || !scene || !g.surface) return;
    this.body = body;
    this.scene = scene;

    for (const s of g.sites.at(body)) {
      if (!this._isLive(s)) continue;      // spent sites get no light — see above
      const col = KIND_COLOR[s.kind];
      if (col === undefined) continue;

      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,                 // ...but depth *test* stays on: ridges occlude
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uColor: { value: new THREE.Color(col) },
          uGain: { value: 1 },
          uAlpha: { value: 0 },            // faded in by the first update
        },
      });
      const mesh = new THREE.Mesh(this.geo, mat);
      /* Rooted two metres under the surface. A beam that starts exactly at the
         sampled height shows a sliver of gap on a slope, because the ground it
         stands on is a mesh and the height is a point sample of the field. */
      mesh.position.set(s.x, g.surface.heightAt(s.x, s.z) - 2, s.z);
      mesh.scale.set(W_MIN, HEIGHT, 1);
      /* Drawn late and never culled: it is a tall thin transparent thing whose
         bounding box is wrong the moment it billboards, and it is additive, so
         it wants to land on top of the opaque pass. */
      mesh.renderOrder = 12;
      mesh.frustumCulled = false;
      scene.add(mesh);

      this.beams.push({
        site: s,
        mesh,
        mat,
        /* Phase per site, so a landscape with three lights on it does not blink
           in unison like one object seen three times. */
        phase: (s.x * 0.7 + s.z * 1.3) % 6.283,
        live: 1,
      });
    }
  }

  /** Whether a site is still worth driving to — the chart's own two tests. */
  _isLive(s) {
    const g = this.game;
    if (s.kind === 'seam') {
      return s.dep ? g.prospect.remaining(this.body || g.landed?.body, s.dep) > 0 : false;
    }
    return !g.sites.isDone(this.body || g.landed?.body, s);
  }

  /**
   * Billboard, size, pulse, and put out the ones that have been worked.
   *
   * Called every frame from `updateSurface`. There are only ever a handful of
   * sites on a body — a few seams, at most two wrecks, at most two markers and
   * at most one survivor — so this loop is allowed to be straightforward.
   *
   * @param {number} dt  seconds
   */
  update(dt) {
    if (!this.beams.length) return;
    const g = this.game;
    const me = g.groundPos();
    const t = clockNow();

    for (const b of this.beams) {
      /* Worked while you watched. Fading rather than vanishing, because a light
         that simply stops existing on the frame you finish a site reads as a
         glitch; one that dies over a second reads as the site being closed. */
      const want = this._isLive(b.site) ? 1 : 0;
      b.live += (want - b.live) * Math.min(1, dt * 1.6);
      if (b.live < 0.004) { b.mesh.visible = false; continue; }
      b.mesh.visible = true;

      const dx = me.x - b.site.x, dz = me.z - b.site.z;
      const dist = Math.hypot(dx, dz);

      /* Face the viewer, about Y only. A full lookAt would tip the column off
         vertical, and a beam that leans is a beam that has stopped being a
         landmark. */
      b.mesh.rotation.y = Math.atan2(dx, dz);

      /* Constant angular width past the first few hundred metres — see the
         header. Clamped at both ends: close up it is a column you can walk
         around, far off it never becomes a wall. */
      const w = Math.min(W_MAX, Math.max(W_MIN, dist * ANG_W));
      b.mesh.scale.set(w, HEIGHT, 1);

      /* Down, but never out, inside the arrival radius. The beam is also the
         only thing marking the spot once you get there — nothing else in the
         world says "this is the site" — so it has to stay readable while you
         stand in it without being a flare in the middle of the frame. */
      const near = THREE.MathUtils.clamp((dist - s_reach(b.site)) / 260, 0, 1);
      const close = 0.34 + 0.66 * near;

      const p = 0.5 + 0.5 * Math.sin(t * PULSE_HZ * 6.283 + b.phase);
      b.mat.uniforms.uAlpha.value = close * b.live;
      /* The gain runs high because AgX needs it to: Structures.js records a
         navigation lamp at gain 6 never clipping, never blooming and lighting
         nothing, and this is the same problem at a larger size. */
      b.mat.uniforms.uGain.value = 26 + p * p * 58;
    }
  }

  /** Drop the lights and the programs behind them. */
  clear() {
    for (const b of this.beams) {
      b.mesh.parent?.remove(b.mesh);
      b.mat.dispose();
    }
    this.beams.length = 0;
    this.body = null;
    this.scene = null;
  }

  /** Liftoff: the scene goes, and so does the shared geometry. */
  dispose() {
    this.clear();
    this.geo.dispose();
  }
}

/* The arrival radius, defaulted. `Sites` puts `reach` on every site it makes;
   the default is only here so a site from an older save that predates the
   field cannot divide the fade by undefined. */
function s_reach(s) { return s.reach || 60; }
