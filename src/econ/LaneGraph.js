import { mulberry32 } from '../world/generate.js';

/* ============================================================================
   The lane graph: the nebula as geography.

   The galaxy chart used to be a flat pond — any jump cost distance over
   eighty, and nothing else. Now the space between the stars has *texture*: a
   seeded density field standing in for the dust banks, and a network of lanes
   threading the systems. Three rules make it a game:

   **Density is drag.** Fold cost scales with the dust along the path. A dense
   bank can push a jump past what a full charge can pay, which is the polite
   way of saying: you cannot get there from here. Yet.

   **A charted lane is most of the answer.** Surveying a lane — flying it once
   — cuts its density penalty to a quarter. Depth into the nebula is therefore
   bought hop by hop, and the frontier is wherever your charts run out.

   **Only lanes can be charted.** Off-graph jumps fight the raw field plus a
   pathfinding surcharge, and mostly lose. The network is the map; the map is
   the product; the product is for sale — every station buys each of your
   charts exactly once.

   The graph is the same two-nearest-neighbour weave the holo-map has always
   drawn as decoration, made load-bearing — plus whatever extra links it takes
   to leave no system stranded, because a trade network with an island in it
   is a story with a missing chapter.
   ========================================================================== */

const SAVE_KEY = 'star-universe.lanes.v1';

/** How hard uncharted dust fights the drive, at density 1. */
const UNCHARTED_DRAG = 2.2;
/** The same dust once the lane is surveyed. */
const CHARTED_DRAG = 0.5;
/** Jumping where no lane runs: raw field plus a surcharge for going blind. */
const OFFLANE_BASE = 1.5;
const OFFLANE_DRAG = 3.0;

export const edgeKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/* --------------------------------------------------------------- the field */

/**
 * Seeded 2D value noise, two octaves, smoothstep-interpolated over ~18 ly
 * cells. Cheap, deterministic, and structured enough that the chart divides
 * into legible clear pockets and dense walls rather than static.
 */
export function makeDensityField(seed) {
  const cell = (ix, iy) => {
    let h = (seed ^ (ix * 374761393) ^ (iy * 668265263)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const octave = (x, y, scale) => {
    const gx = x / scale, gy = y / scale;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = cell(ix, iy), b = cell(ix + 1, iy);
    const c = cell(ix, iy + 1), d = cell(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  return (x, y) => {
    const v = octave(x, y, 18) * 0.68 + octave(x + 91.7, y - 33.1, 7.5) * 0.32;
    // Push the midtones apart so "dense" and "clear" are decisions, not shades.
    return Math.min(1, Math.max(0, (v - 0.18) * 1.5));
  };
}

export class LaneGraph {
  constructor(galaxy, seed) {
    this.galaxy = galaxy;
    this.density = makeDensityField(seed);

    /* ---- the weave: two nearest neighbours each, deduped… */
    const edges = new Map();          // key -> {a, b, dist, density}
    const link = (i, j) => {
      const k = edgeKey(i, j);
      if (edges.has(k)) return;
      edges.set(k, this._makeEdge(i, j));
    };
    for (let i = 0; i < galaxy.length; i++) {
      const near = galaxy
        .map((s, j) => ({ j, d: Math.hypot(s.x - galaxy[i].x, s.y - galaxy[i].y) }))
        .filter((x) => x.j !== i).sort((a, b) => a.d - b.d);
      for (const { j } of near.slice(0, 2)) link(i, j);
    }

    /* …then stitch the islands. Union the components and keep adding the
       shortest crossing link until one component remains. */
    const parent = galaxy.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const e of edges.values()) parent[find(e.a)] = find(e.b);
    for (;;) {
      const roots = new Set(galaxy.map((_, i) => find(i)));
      if (roots.size <= 1) break;
      let best = null;
      for (let i = 0; i < galaxy.length; i++) {
        for (let j = i + 1; j < galaxy.length; j++) {
          if (find(i) === find(j)) continue;
          const d = Math.hypot(galaxy[i].x - galaxy[j].x, galaxy[i].y - galaxy[j].y);
          if (!best || d < best.d) best = { i, j, d };
        }
      }
      link(best.i, best.j);
      parent[find(best.i)] = find(best.j);
    }

    this.edges = edges;
    this.adj = galaxy.map(() => []);
    for (const e of this.edges.values()) {
      this.adj[e.a].push(e);
      this.adj[e.b].push(e);
    }

    /* ---- what the player knows. Lanes out of the home system come
       pre-surveyed: the Institute did not launch its ship into a wall. */
    this.charted = new Set();
    this.sold = {};                   // stationKey -> [edgeKey, ...]
    this.load();
    for (const e of this.adj[0]) this.charted.add(e.key);
  }

  _makeEdge(a, b) {
    const A = this.galaxy[a], B = this.galaxy[b];
    const dist = Math.hypot(A.x - B.x, A.y - B.y);
    return { key: edgeKey(a, b), a, b, dist, density: this._pathDensity(A, B) };
  }

  /** Mean field density along a segment, five taps. */
  _pathDensity(A, B) {
    let sum = 0;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      sum += this.density(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t);
    }
    return sum / 5;
  }

  lane(a, b) { return this.edges.get(edgeKey(a, b)) || null; }
  isCharted(key) { return this.charted.has(key); }

  /**
   * Everything the drive and the map need to know about a jump.
   * `cost` is in fold-charge (1 = a full drive); anything over 1 is a wall.
   */
  costBetween(a, b) {
    const A = this.galaxy[a], B = this.galaxy[b];
    const dist = Math.hypot(A.x - B.x, A.y - B.y);
    const base = dist / 80;
    const e = this.lane(a, b);
    if (!e) {
      const density = this._pathDensity(A, B);
      return { cost: base * (OFFLANE_BASE + density * OFFLANE_DRAG), dist, density, lane: false, charted: false };
    }
    const charted = this.isCharted(e.key);
    const drag = charted ? CHARTED_DRAG : UNCHARTED_DRAG;
    return { cost: base * (1 + e.density * drag), dist, density: e.density, lane: true, charted };
  }

  /** Chart by traversal. @returns the edge if it was newly charted. */
  chart(a, b) {
    const e = this.lane(a, b);
    if (!e || this.charted.has(e.key)) return null;
    this.charted.add(e.key);
    this.save();
    return e;
  }

  /** What a station pays for one lane's survey data: length and danger. */
  chartValue(e) {
    return Math.round(40 + e.dist * 6 + e.density * 160);
  }

  /** Charts this station has not bought yet. Home lanes came free with the
   *  ship and were never yours to sell. */
  sellableAt(stationKey) {
    const bought = new Set(this.sold[stationKey] || []);
    const free = new Set(this.adj[0].map((e) => e.key));
    return [...this.charted]
      .filter((k) => !bought.has(k) && !free.has(k))
      .map((k) => this.edges.get(k));
  }

  sellAt(stationKey) {
    const lanes = this.sellableAt(stationKey);
    if (!lanes.length) return 0;
    const total = lanes.reduce((s, e) => s + this.chartValue(e), 0);
    this.sold[stationKey] = [...(this.sold[stationKey] || []), ...lanes.map((e) => e.key)];
    this.save();
    return total;
  }

  /** Shortest lane distance in light-years between systems — how far news
   *  has to ride. Infinity if the graph somehow does not connect them. */
  graphDist(a, b) {
    if (a === b) return 0;
    const dist = this.galaxy.map(() => Infinity);
    dist[a] = 0;
    const open = new Set([a]);
    while (open.size) {
      let u = -1;
      for (const i of open) if (u < 0 || dist[i] < dist[u]) u = i;
      open.delete(u);
      if (u === b) return dist[u];
      for (const e of this.adj[u]) {
        const v = e.a === u ? e.b : e.a;
        if (dist[u] + e.dist < dist[v]) { dist[v] = dist[u] + e.dist; open.add(v); }
      }
    }
    return dist[b];
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        charted: [...this.charted], sold: this.sold,
      }));
    } catch { /* ephemeral run */ }
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return;
      if (Array.isArray(s.charted)) {
        for (const k of s.charted) if (this.edges.has(k)) this.charted.add(k);
      }
      if (s.sold && typeof s.sold === 'object') {
        for (const st in s.sold) {
          if (Array.isArray(s.sold[st])) {
            this.sold[st] = s.sold[st].filter((k) => this.edges.has(k));
          }
        }
      }
    } catch { /* a corrupt save is just a new game */ }
  }
}
