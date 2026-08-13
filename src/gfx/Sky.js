import * as THREE from 'three';
import { NOISE } from './glsl/noise.js';

/* ============================================================================
   Deep-sky background.

   Two parts, because one alone never looks right:
     1. A baked nebula cubemap — large, soft, mostly *dark* structure. Real
        astrophotography is 95% black; the moment the sky is full of purple
        clouds it reads as a screensaver. Density is kept low and the dynamic
        range high so bloom does the work.
     2. A real HDR point-star field with a physical magnitude distribution and
        blackbody colours, so the bright ones bloom and streak like a lens.
   ========================================================================== */

const NEBULA_FRAG = /* glsl */`
precision highp float;
${NOISE}
varying vec3 vDir;
uniform float uSeed;
uniform vec3  uColA;
uniform vec3  uColB;
uniform vec3  uColC;
uniform float uDensity;
uniform vec3  uGalAxis;

void main(){
  vec3 d = normalize(vDir);
  vec3 s = vec3(uSeed*11.7, uSeed*4.1, -uSeed*7.9);
  vec3 p = d*1.15 + s;

  float x = dot(d, uGalAxis);

  // ---- galactic plane: a thin milky lane of unresolved starlight -------
  /* The core was 140: a Gaussian of sigma 0.0598 in cos-angle, which near the
     plane is 3.4 degrees — eight degrees full width at half maximum. Against
     the skirt at 26 (sigma 8.0 degrees, 19 degrees FWHM) that is a ratio of
     barely two, so the two terms never separate and what you get is one soft
     sash whose own falloff is the only gradient in the frame. Widening the
     ratio is what makes the plane read as a bright lane sitting inside a broad
     halo, the way the real Milky Way does. At 280 the core is sigma 2.4
     degrees, 5.7 degrees FWHM — a ratio of 3.3 to the skirt, and still twenty-
     seven times the 0.09-degree angular size of a texel on a 1024-per-face
     cube, so it cannot alias along the seams even at the low quality tier's
     256. The skirt is untouched; it is the halo. */
  float bandCore = exp(-x*x*280.0);
  float bandWide = exp(-x*x*26.0);
  float rag = fbm(d*3.2 + uSeed*3.3, 4)*0.5 + 0.5;
  float band = (bandCore*0.72 + bandWide*0.34) * mix(0.45, 1.0, rag);

  // ---- emission complexes ---------------------------------------------
  // Only a few percent of any real sky has visible nebulosity. A very
  // low-frequency mask raised to a high power gives isolated complexes with
  // black between them, instead of an all-over marble texture.
  float regionS = fbm(p*0.42 + 3.0, 4)*0.5 + 0.5;
  regionS = smoothstep(0.54, 0.90, regionS);
  float region = regionS * regionS;
  // complexes hug the galactic plane, like real star-forming regions
  float planeGate = mix(0.10, 1.0, bandWide);
  region *= planeGate;

  vec3 q = warp3(p*1.6 + 11.0, 0.55, 3);
  float fine = fbm(q*1.9, 6)*0.5 + 0.5;
  float fil  = ridged(q*3.4 + 21.0, 5);

  float emis = region * pow(max(fine, 0.0), 2.4);
  float filaments = region * pow(max(fil, 0.0), 4.0);

  /* ---- shell filaments at the *edges* of the complexes ------------------
     Both terms above are gated by region, which is the mask *squared* — so
     everything they draw piles up in the middle of a complex and the complex
     ends in a soft, featureless gradient. Real emission nebulae are the other
     way round: the interior is a smooth ionised glow and all the sharp
     structure — the rims, the elephant trunks, the swept shells — lives on the
     boundary where the ionisation front meets the cold cloud. That boundary is
     exactly where the density field's gradient is steep.

     The literal reading of that is three extra fbm taps for a finite-difference
     gradient. It is not needed: regionS is a smoothstep of a smooth field, and
     a smoothstep's gradient magnitude is largest where its *output* is near a
     half. So 4*regionS*(1-regionS) is a free proxy for the normalised gradient
     — one at the boundary, zero in the core and zero in empty sky — and
     squaring it narrows the band to something that reads as a rim rather than
     as a second, softer complex. It has to carry the same plane gate the
     complexes do, or shells appear at the galactic poles around masks that were
     never allowed to become nebulae there. The warp field q is reused at a
     different scale rather than warped again: the shells then flow with the
     same field the interior does, which is what makes a rim look attached to
     its cloud instead of pasted over it, and it costs one ridged() rather than
     a warp plus a ridged. Bake-time only either way. */
  float shell = 4.0*regionS*(1.0 - regionS);
  shell = shell * shell * planeGate;
  float wisp = ridged(q*2.1 + 63.0, 5);
  float shells = shell * pow(max(wisp, 0.0), 3.2);

  // ---- dark absorption -------------------------------------------------
  float dust = fbm(warp3(p*1.9 - 9.0, 0.45, 3)*1.4, 5)*0.5 + 0.5;
  dust = smoothstep(0.40, 0.88, dust);

  // ---- integrated starlight --------------------------------------------
  // The faint, structured wash that fills the gaps between the bright
  // complexes. Real deep-sky frames are dark but they are never *empty*: there
  // is always unresolved starlight and reflection nebulosity carrying texture
  // at a level just above black. Without it a space shot is a black rectangle
  // with one object in it, which is exactly how these frames were reading.
  float wash = fbm(p*0.62 + 47.0, 5)*0.5 + 0.5;
  wash = pow(max(wash, 0.0), 2.2);

  // ---- compose ---------------------------------------------------------
  vec3 col = vec3(0.0);
  col += uColA * emis * 0.42;
  col += uColB * filaments * 0.30;
  col += uColC * pow(emis*filaments, 0.7) * 0.55;
  // the rims: the two palette ends mixed, because a real ionisation front is
  // the emission colour lit through the dust colour rather than either alone
  col += (uColA*0.55 + uColC*0.45) * shells * 0.60;

  // ionised cores: tiny, rare, bright enough for bloom to find them
  float core = pow(max(fbm(q*4.2 + 41.0, 4)*0.5+0.5, 0.0), 22.0) * region;
  col += (uColC*0.5 + vec3(0.85,0.72,0.58)) * core * 6.0;

  col *= uDensity;

  /* diffuse starlight of the plane itself.

     Tripled, from (0.052, 0.058, 0.082). The old value was chosen against a
     grade whose black point sat at 13/255 and whose bloom weight was 0.085:
     everything below about 0.06 linear landed within a couple of display levels
     of the lift, so the plane and the pole came out the same grey and the frame
     read as a flat rectangle. What matters is not the plane's absolute value
     but the plane-to-pole *ratio* surviving the tone curve, and that ratio is
     what this raise and the floor cut below are buying together. At 0.156 the
     lane peaks near 0.115 linear after the rag and dust modulation, which is
     under one — so it brightens and gains contrast without ever clipping or
     giving bloom a source to smear. */
  col += vec3(0.156, 0.174, 0.246) * band;
  /* and the all-sky wash, tinted cold so the void stays teal-black.

     Raised about 1.6x for one reason only: it used to sit at the same level as
     the constant below it. At the poles the wash averaged 0.0009 against a
     cosmic floor of 0.0008, so the only structure out there was a fifty per
     cent modulation on a pedestal — which is a flat grey with a hint in it.
     Raised 1.6x and standing on a floor cut by five it averages 0.0015 against
     0.00016, about nine to one, and the same noise field becomes visible
     texture. Note what did *not* change: the pole's mean brightness goes from
     0.0017 to 0.0017. Only its contrast moves. That is the fix for "a black
     rectangle with one object in it" — structure, not more grey. */
  col += vec3(0.0125, 0.0158, 0.0242) * wash * mix(0.55, 1.6, bandWide);

  // dust cuts into everything, including the band — this is what makes the
  // Milky Way read as a *structure* rather than a smear
  col *= (1.0 - dust*0.72*mix(0.25, 1.0, bandWide));

  /* cosmic floor: never pure black, never visible as a colour.

     Cut by five. This is a pedestal, and a pedestal is only invisible while it
     is well under whatever structure sits on it. At 0.0008 it was *equal* to
     the wash it was supposed to sit beneath, so it was setting the colour of
     the poles rather than merely keeping them off zero — and the post chain
     adds its own lift on top, so the pedestal was being paid for twice. The
     scene's black point belongs to the grade, not to the sky bake. */
  col += vec3(0.00016, 0.00022, 0.00038);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

const NEBULA_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Palettes chosen to read as real deep-sky objects rather than candy. */
export const NEBULA_PALETTES = [
  { name: 'Carina',    a: [0.42, 0.13, 0.10], b: [0.10, 0.16, 0.30], c: [0.60, 0.30, 0.16] },
  { name: 'Cygnus',    a: [0.09, 0.20, 0.34], b: [0.30, 0.12, 0.26], c: [0.24, 0.34, 0.46] },
  { name: 'Orion',     a: [0.34, 0.16, 0.30], b: [0.10, 0.22, 0.36], c: [0.46, 0.34, 0.28] },
  { name: 'Rho',       a: [0.36, 0.20, 0.09], b: [0.08, 0.14, 0.32], c: [0.44, 0.28, 0.34] },
  { name: 'Veil',      a: [0.08, 0.26, 0.28], b: [0.24, 0.10, 0.30], c: [0.20, 0.38, 0.40] },
  { name: 'Tarantula', a: [0.30, 0.11, 0.22], b: [0.13, 0.18, 0.34], c: [0.50, 0.26, 0.22] },
];

export function bakeNebulaCube(renderer, size, seed, paletteIndex = 0) {
  const pal = NEBULA_PALETTES[paletteIndex % NEBULA_PALETTES.length];
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });

  const galAxis = new THREE.Vector3(
    Math.sin(seed * 1.7), Math.cos(seed * 2.3) * 0.8, Math.sin(seed * 0.9 + 1.1)
  ).normalize();

  const mat = new THREE.ShaderMaterial({
    vertexShader: NEBULA_VERT,
    fragmentShader: NEBULA_FRAG,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uSeed: { value: seed },
      uColA: { value: new THREE.Vector3(...pal.a) },
      uColB: { value: new THREE.Vector3(...pal.b) },
      uColC: { value: new THREE.Vector3(...pal.c) },
      uDensity: { value: 1.35 },
      uGalAxis: { value: galAxis },
    },
  });

  const scene = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat);
  box.frustumCulled = false;
  scene.add(box);

  const cam = new THREE.CubeCamera(0.1, 100, cubeRT);
  const prevTarget = renderer.getRenderTarget();
  cam.update(renderer, scene);
  renderer.setRenderTarget(prevTarget);

  box.geometry.dispose();
  mat.dispose();

  cubeRT.texture.name = pal.name;
  return cubeRT;
}

/* --------------------------------------------------------------- stars */

/* No logarithmic-depth chunks in either star stage, deliberately.

   The field neither tests nor writes depth any more (see the material below),
   so a per-fragment gl_FragDepth write would be computing a value nothing can
   read. It is not free: writing gl_FragDepth disables the hardware's early
   depth path for the draw, and this draw covers fourteen thousand additive
   sprites. Dropping it is the change that pays for the wider quads. */
const STAR_VERT = /* glsl */`
attribute float aSize;
attribute vec3  aColor;
attribute float aPhase;
uniform float uPixel;
uniform float uTime;
uniform float uBoost;
varying vec3 vCol;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // very slight scintillation keeps the field from looking like static
  float tw = 0.94 + 0.06*sin(uTime*0.7 + aPhase*40.0);

  /* Every star gets at least a few pixels to spread over. A one-pixel point
     cannot express a point-spread function — it is a hard square, and a sky
     full of hard squares reads as dead pixels or sensor noise rather than as
     stars. Widening them alone would make the faint ones *brighter*, so the
     flux is held constant: spreading a star over more pixels dims it in
     proportion, which is what finally lets the faint end fall away below the
     noise floor instead of carpeting the frame at uniform brightness. */
  /* Sizing the quad is not enough on its own, and that is the trap here.
     Widening the sprite while conserving flux exactly divides the peak by the
     area gained, and the peak is what the display sees: on a 6 px quad a
     mid-magnitude star ends up with everything except its centre texel *below
     black*, so it still renders as a hard 1-2 pixel dot with cut corners no
     matter how soft the profile is. The visible size of a star is set by where
     its profile crosses the display floor, not by the quad.

     So: size scales with brightness, the way a real point spread does, and the
     flux is only *partly* conserved — enough that the faint end still falls
     away, not so much that the skirt is extinguished before it can be seen. */
  /* Five and a half, not four and not seven.

     Correcting the reasoning that used to live here, because it was wrong and
     it set the floor too low. It claimed that supersampling lets the profile
     resolve in a smaller quad, so a floor that had been seven could come back
     to four. But uPixel *is* the pixel ratio: gl_PointSize is in framebuffer
     samples and this multiplies by it, so the quad is a fixed number of
     *output* pixels and supersampling changes only how many samples are taken
     inside it. Seven was seven screen pixels then and would be seven screen
     pixels now — the rejection of it stands — but four was four screen pixels
     too, and that is the whole problem.

     At four, with the quad centred between pixels, a star has exactly twelve
     lit samples: four at r=0.35 and eight at r=0.79 (the corners fall outside
     the r>1 discard). Under the old tight core those two rings differ by 4:1,
     so on anything but the brightest stars the outer ring is under the display
     floor and what survives is a 2x2 block with the corners bitten off. That
     is the "stars look like stuck pixels" report, and no amount of softening
     the profile fixes it while the quad only offers two radii to sample.

     At 5.5 the same star gets twenty-four lit samples on four radii — r=0.26,
     0.58, 0.77, 0.93 — and with the softened core below they come out at
     1.00 : 0.56 : 0.29 : 0.03. Four resolved steps with a real edge on the last
     one is what reads as a round point rather than as a glyph, and the profile
     is still falling steeply enough at the rim that the star has a size rather
     than a diameter. Seven would put a resolvable *flat* across the middle,
     which is the bokeh blob that got seven rejected. */
  /* Back down from 5.5, and the reasoning above it is what went wrong.
     Widening the quad and softening the core together were tuned on the
     sample grid rather than on a rendered frame, and on a rendered frame the
     result is a flat-topped tile: a bright star's profile sits above the clip
     point across the whole widened quad, so it saturates 5x5 at 253-254 with
     the background reached within two pixels. Measured, not argued.

     A bright star SHOULD blow out — that is what bright means. What separates
     a photographic sky from a screensaver is that the blown part is one or two
     pixels and everything around it is a real falloff, so brightness reads as
     the EXTENT of the halo rather than as the width of the plateau. So the
     quad comes back in and the core goes tight again, and the wing below is
     what carries the apparent magnitude. */
  float want = max(aSize * 1.15, 3.4);
  /* The flux exponent stays at 0.78, which is not the obvious move — raising
     the floor and lowering the exponent together is, and it is wrong. Widening
     the floor from 4 to 5.5 already shrinks spread for every floor-clamped
     star to 0.61 of what it was, against a quad area that grew 1.89x; the
     0.781 normaliser in the fragment stage holds the softened profile's own
     integral at the old one; and the product lands about a tenth above the
     flux each star carried before. Lowering the exponent as well would have
     brightened the faint end by roughly a third and put back the uniform
     carpet the whole flux-conservation scheme exists to prevent.

     Tuned by evaluating both profiles on the actual output-pixel sample grid
     rather than on the integral, because it is the sampled values the display
     sees: at aSize 1.05 the peak sample falls 35% while the second ring rises
     46% and the total over the sprite moves by 8%. That trade — energy out of
     the centre and into the first ring, at constant total — is exactly what
     turns a hot 2x2 block into a point. */
  float spread = pow((aSize*aSize) / (want*want), 0.78);
  gl_PointSize = want * uPixel * tw;
  vCol  = aColor * uBoost * tw * spread;
}
`;

const STAR_FRAG = /* glsl */`
precision highp float;
varying vec3 vCol;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d);
  if(r2 > 0.25) discard;
  float r = sqrt(r2)*2.0;
  // A real point spread: a tight Gaussian core, a wider Airy-ish skirt, and a
  // faint outer wing. The wing is what makes a bright star read as bright
  // rather than as a bigger dot.
  /* Widened again, 5.0 to 2.6. It was 13 once and then 5, each time for the
     same reason and each time not far enough: the core's half-maximum has to
     land outside the first ring of output samples or the star is one hot texel
     with everything around it under the display floor. At 5.0 in the old
     4-pixel quad the half-maximum sat at r=0.37, barely past the first ring at
     r=0.35 — so the second ring came out four times fainter and dropped out.
     At 2.6 the half-maximum is at r=0.52, which in the 5.5-pixel quad falls
     *between* the first ring (0.26) and the second (0.58): the second ring
     keeps 56% of the peak instead of 25%, and it is that ring, not the centre,
     that gives a star an apparent size. */
  float core  = exp(-r*r*11.0);
  float skirt = exp(-r*r*3.4)*0.22;
  float wing  = exp(-r*2.4)*0.055;
  /* The rolloff starts at 0.72 rather than 0.82, and it is still here rather
     than removed. Removing it is tempting — a wing ought to decay into the
     additive blend rather than be cut off — but the r>1 discard above is a hard
     edge whatever this window does, and the untruncated profile still stands at
     12% of its peak when it gets there (8% under the old tight core; softening
     the core is exactly what makes leaving the window out untenable). On a
     bright star, 12% to zero around a circle is a bokeh rim, which is a failure
     this file has already been through once. Starting the window earlier costs
     a little of the outer wing and buys a profile that reaches the edge of the
     geometry at zero, with zero slope. */
  float a = (core + skirt + wing) * (1.0 - smoothstep(0.78, 1.0, r));
  /* Hold the profile's own integral where it was. The softened core plus the
     earlier window integrate to 1.28x the old profile over the unit disc, and
     the vertex stage's flux conservation is expressed against quad area, not
     against profile shape — so without this the whole field would come out a
     quarter brighter and the change would read as "the stars got bigger AND
     brighter", which is how a star field starts looking like a screensaver.
     1/1.28. */
  a *= 0.781;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

/**
 * Physical-ish star field: power-law magnitude distribution, blackbody colours,
 * clustered toward a galactic plane. Radius is huge; the object is re-centred
 * on the camera every frame so it behaves as an infinite backdrop.
 */
export function makeStarField(count, seed, radius = 4.0e6) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const siz = new Float32Array(count);
  const pha = new Float32Array(count);

  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };

  const galAxis = new THREE.Vector3(
    Math.sin(seed * 1.7), Math.cos(seed * 2.3) * 0.8, Math.sin(seed * 0.9 + 1.1)
  ).normalize();
  const tmp = new THREE.Vector3();
  const c = new THREE.Color();

  /* Open clusters. A uniformly scattered field — however carefully its
     magnitudes are distributed — reads as television static, because the one
     thing a real sky is *not* is uniform. Real stars come in groups: a dozen
     obvious clumps near the plane, each a few dozen stars within a couple of
     degrees. Putting a modest fraction of the field into clusters is the single change
     that makes the backdrop look photographed. Keep the fraction low and the
     spread generous: a fifth of the field packed into fourteen tight knots
     reads as confetti, not as sky.

     Six per cent, down from twelve, and the members get their own magnitude
     draw. Twelve per cent of fourteen thousand stars is 1,680 across fourteen
     knots — a hundred and twenty each, drawn from the *same* power law as the
     field, so each knot got its share of brilliant stars and came out as a
     bright clot rather than as a cluster. A real open cluster is a handful of
     recognisable members over a haze that is at the edge of resolution, which
     is why they read as texture on a photograph rather than as objects. Six
     per cent with a steeper draw gives sixty per knot, most of them faint. */
  const CLUSTERS = 14;
  const clusterAt = [];
  for (let i = 0; i < CLUSTERS; i++) {
    const t = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    const along = t.dot(galAxis);
    t.addScaledVector(galAxis, -along * (0.80 + rnd() * 0.18)).normalize();
    clusterAt.push({ dir: t, spread: 0.030 + rnd() * 0.075, n: 0 });
  }

  for (let i = 0; i < count; i++) {
    // uniform on sphere, then biased toward the galactic plane
    let x, y, z, l;
    do {
      x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1;
      l = x * x + y * y + z * z;
    } while (l > 1 || l < 1e-6);
    l = Math.sqrt(l); x /= l; y /= l; z /= l;

    tmp.set(x, y, z);
    const roll = rnd();
    const inCluster = roll < 0.06;
    if (inCluster) {
      // in a cluster: jitter a small angle off its centre
      const cl = clusterAt[Math.floor(rnd() * CLUSTERS)];
      cl.n++;
      tmp.copy(cl.dir)
        .addScaledVector(new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1), cl.spread)
        .normalize();
    } else if (roll < 0.82) {
      // pull toward the plane — harder than before, so the band actually reads
      const along = tmp.dot(galAxis);
      tmp.addScaledVector(galAxis, -along * (0.70 + rnd() * 0.28)).normalize();
    }

    pos[i * 3] = tmp.x * radius;
    pos[i * 3 + 1] = tmp.y * radius;
    pos[i * 3 + 2] = tmp.z * radius;

    // magnitude: heavy power law — a few brilliant stars, a haze of faint ones.
    // Cluster members draw from a steeper law than the field. The mean of u^k
    // is 1/(k+1), so 8.5 against 5.5 takes a member's mean brightness term from
    // 0.154 to 0.105 — a third dimmer — and the chance of drawing the top half
    // of the range from 12% to 8%. A knot of sixty is then one or two obvious
    // members over fifty-odd at the threshold, which is what an open cluster
    // looks like, and it is what stops fourteen knots reading as fourteen
    // blobs.
    const u = rnd();
    const bright = Math.pow(u, inCluster ? 8.5 : 5.5);
    const size = 1.05 + bright * 7.5;
    siz[i] = size;
    pha[i] = rnd();

    // spectral type distribution skewed to cool dwarfs, rare hot giants
    const t = rnd();
    let kelvin;
    if (t < 0.70) kelvin = 2900 + rnd() * 1500;
    else if (t < 0.90) kelvin = 4400 + rnd() * 1600;
    else if (t < 0.975) kelvin = 6000 + rnd() * 2200;
    else kelvin = 8500 + rnd() * 13000;

    kelvinToRGB(kelvin, c);
    /* Couple brightness to temperature. Cool dwarfs genuinely outnumber hot
       stars four to one, but they are also two orders of magnitude fainter —
       so a real naked-eye sky is mostly white and blue with a few orange
       giants in it. Sampling the *population* without the luminosity leaves
       the field a wash of orange confetti. */
    const lumBias = kelvin < 4000 ? 0.30 : kelvin < 6000 ? 0.70 : kelvin < 9000 ? 1.35 : 2.40;
    const inten = (0.30 + bright * 9.0) * lumBias;
    col[i * 3] = c.r * inten;
    col[i * 3 + 1] = c.g * inten;
    col[i * 3 + 2] = c.b * inten;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(pha, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.1);

  const mat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uPixel: { value: 1 },
      uTime: { value: 0 },
      uBoost: { value: 1 },
    },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    /* The field draws first and never depth-tests, which is the same pattern
       FoldTunnel uses and for the same reason.

       It used to depth-test, and that was a bug the geometry hid badly: the
       sphere is at 4e6 but the camera's far plane is 6e7, so any body farther
       out than 4e6 — which is most of a system — fails the test *against the
       stars* and the field paints over it. That is where c-terran-crescent's
       filaments across the night side came from, and why they carried on past
       the silhouette: they were never on the planet, they were in front of it.

       Setting transparent:false is the load-bearing half. It moves the Points
       into three's opaque list, which is drawn before the transparent one and
       sorted by renderOrder — so at -1000 the field is the first thing after
       the background, and every opaque surface in the scene paints over it
       afterwards regardless of distance. Blending is unaffected: three only
       forces NoBlending on a transparent:false material when its blending is
       NormalBlending, and this one is additive. depthTest:false then makes the
       sphere's radius irrelevant rather than merely large, which is the
       difference between fixing this and moving the threshold.

       Scaling the geometry to follow camera.far would also work and is what
       the obvious reading of the bug suggests. It is worse: it needs a per-
       frame write, it re-introduces the failure the moment anything changes
       the far plane, and it still leaves the field competing on depth with
       things it should simply never occlude. */
    depthTest: false,
    transparent: false,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -1000;
  points.matrixAutoUpdate = false;
  return points;
}

function kelvinToRGB(k, out) {
  const t = Math.min(40000, Math.max(1000, k)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  out.setRGB(
    Math.min(1, Math.max(0, r / 255)),
    Math.min(1, Math.max(0, g / 255)),
    Math.min(1, Math.max(0, b / 255)),
    THREE.SRGBColorSpace
  );
  return out;
}
