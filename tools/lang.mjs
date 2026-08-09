// Translation coverage. Pure Node — no browser, no build, runs in a second.
//
// Every piece of written content in the game is keyed by an id that lives in
// its content module, and the Thai for it is keyed by the same id in
// story.th.js. That means coverage is checkable by construction rather than by
// somebody opening the Archive in Thai and scrolling: this walks the content
// and asserts a translation exists for every field that reaches a player.
//
// It is a *coverage* check, not a quality one. It cannot tell you the Thai is
// good. It can tell you that adding an eighth Tone without translating it will
// fail the build, which is the failure that actually happens.
//
//   node tools/lang.mjs
import { CANTOS, LOGS, TYPE_INFO, STAR_INFO, ANOMALY_INFO, INTRO_LINES } from '../src/game/lore.js';
import { SPECIES, VOICE } from '../src/game/Species.js';
import { STORY_TH } from '../src/ui/story.th.js';

const missing = [];
const seen = new Set();
const need = (key, what) => {
  seen.add(key);
  if (!STORY_TH[key] || !STORY_TH[key].trim()) missing.push(`${key}   (${what})`);
};

for (const c of CANTOS) {
  need(`lore.${c.id}.title`, 'canto title');
  need(`lore.${c.id}.sub`, 'canto subtitle');
  c.body.forEach((_, i) => need(`lore.${c.id}.b${i}`, 'canto body'));
  need(`lore.${c.id}.q`, 'canto pull-quote');
}

for (const l of LOGS) {
  need(`lore.${l.id}.title`, 'log title');
  need(`lore.${l.id}.sub`, 'log subtitle');
  l.body.forEach((_, i) => need(`lore.${l.id}.b${i}`, 'log body'));
}

for (const k of Object.keys(TYPE_INFO)) {
  need(`lore.type.${k}.label`, 'world class');
  need(`lore.type.${k}.text`, 'world entry');
}
for (const k of Object.keys(STAR_INFO)) need(`lore.star.${k}`, 'star entry');
for (const k of Object.keys(ANOMALY_INFO)) {
  need(`lore.anom.${k}.label`, 'anomaly label');
  need(`lore.anom.${k}.text`, 'anomaly entry');
}
INTRO_LINES.forEach((_, i) => {
  need(`lore.intro.${i}.who`, 'intro speaker');
  need(`lore.intro.${i}.text`, 'intro line');
});

/* The voices. Species differ in which lines they have — the Registry does not
   barter, so it carries no tradeSell — so this walks what each one actually
   defines rather than a fixed list, and cannot go stale when a culture gains
   a line. */
for (const id of Object.keys(SPECIES)) {
  const v = VOICE[id];
  if (!v) continue;
  for (const field of Object.keys(v)) {
    if (field === 'greet') {
      for (const tier of Object.keys(v.greet)) need(`voice.${id}.greet.${tier}`, `${id} greeting`);
    } else {
      need(`voice.${id}.${field}`, `${id} ${field}`);
    }
  }
}

// The other direction: a key nobody reads is dead weight, and usually a typo
// in an id that silently reads as untranslated in game.
const orphans = Object.keys(STORY_TH).filter((k) => !seen.has(k));

for (const m of missing) console.log(`MISSING  ${m}`);
for (const o of orphans) console.log(`ORPHAN   ${o}   (nothing reads this key)`);

const total = seen.size;
console.log(`\n${total - missing.length}/${total} strings translated`
  + `${orphans.length ? ` · ${orphans.length} orphaned` : ''}`);
const ok = !missing.length && !orphans.length;
console.log(ok ? 'LANG PASS' : 'LANG FAIL');
process.exit(ok ? 0 : 1);
