/* ============================================================================
   Two languages, one interface.

   This UI was designed around a monospace face at 9–11px with a quarter-em of
   letter-spacing and everything in capitals, which is a look that works for
   Latin and is actively hostile to Thai:

     · Thai has no capitals, so `text-transform: uppercase` does nothing except
       occasionally break combining marks;
     · Thai stacks vowels and tone marks above and below the base consonant, so
       a line-height tuned for Latin clips them;
     · and letter-spacing is the real damage — Thai is written without spaces
       between words, and the reader finds word boundaries by shape. Spacing
       the glyphs apart destroys exactly the cue the language relies on. A
       Thai string at 0.24em tracking is not "styled", it is unreadable.

   So the switch is not only a string table. `html[lang=th]` re-tunes the type
   rules in style.css, and the fallback stack picks up whatever Thai face the
   platform has — Thonburi on macOS, Leelawadee UI on Windows, Noto Sans Thai
   most other places — because this project ships no downloaded assets and is
   not about to start with a webfont.

   Scope, stated honestly: the *interface* is translated — every label, verb,
   column head, banner and control hint a player reads on repeat. The long-form
   fiction (the Tones, station logs, alien dialogue, the revelations) is still
   English. Translating prose that carries the story is a different job from
   translating a button, and doing it badly would be worse than not doing it.
   ========================================================================== */

const KEY = 'star-universe.lang';

export const LANGS = { en: 'EN', th: 'TH' };

const STRINGS = {
  /* ---------------------------------------------------------------- boot */
  'boot.sub': ['DEEP SURVEY VESSEL', 'ยานสำรวจห้วงอวกาศลึก'],
  'boot.wake': ['WAKE', 'ตื่น'],
  'boot.legal': ['requires WebGL2 · headphones recommended',
    'ต้องใช้ WebGL2 · แนะนำให้ใส่หูฟัง'],

  /* ----------------------------------------------------------- the dock */
  'dock.berth': ['BERTH GRANTED · MARKET LINK OPEN', 'ได้รับท่าจอด · เชื่อมต่อตลาดแล้ว'],
  'dock.depart': ['DEPART ▸', 'ออกจากท่า ▸'],
  'dock.hold': ['HOLD', 'ระวาง'],
  'dock.lucent': ['LUCENT', 'ลูเซนต์'],
  'dock.commodity': ['COMMODITY', 'สินค้า'],
  'dock.price': ['PRICE', 'ราคา'],
  'dock.stock': ['STOCK', 'คงคลัง'],
  'dock.held': ['HELD', 'ถืออยู่'],
  'dock.buy': ['BUY', 'ซื้อ'],
  'dock.sell': ['SELL', 'ขาย'],
  'dock.produces': ['PRODUCES', 'ผลิตเอง'],
  'dock.wanted': ['WANTED', 'ต้องการ'],
  'dock.note': ['click trades one unit · SHIFT-click trades five · ESC departs',
    'คลิกเพื่อซื้อขาย 1 หน่วย · SHIFT+คลิก 5 หน่วย · ESC ออกจากท่า'],
  'dock.charts': ['SELL CHARTS', 'ขายแผนที่'],
  'dock.chartsHeld': ['lane survey(s) aboard', 'ผลสำรวจเส้นทางบนยาน'],
  'dock.yard': ['THE YARD', 'อู่ซ่อมบำรุง'],
  'dock.fuelLine': ['Lucent, %P cr the tonne — tank at %A of %B',
    'ลูเซนต์ ตันละ %P เครดิต — ถังบรรจุ %A จาก %B'],
  'dock.refuel': ['REFUEL', 'เติมเชื้อเพลิง'],
  'dock.board': ['THE BOARD', 'กระดานงาน'],
  'dock.inHand': ['IN HAND', 'รับไว้แล้ว'],
  'dock.consignment': ['CONSIGNMENT', 'งานขนส่ง'],
  'dock.fee': ['FEE', 'ค่าจ้าง'],
  'dock.take': ['TAKE', 'รับงาน'],
  'dock.accepted': ['ACCEPTED', 'รับแล้ว'],
  'dock.deliver': ['DELIVER', 'ส่งมอบ'],
  'dock.ready': ['Consignment ready', 'สินค้าพร้อมส่งมอบ'],
  'dock.due': ['due in', 'ครบกำหนดใน'],
  'dock.min': ['min', 'นาที'],
  'dock.holding': ['holding', 'มีอยู่'],
  'dock.hazard': ['HAZARD PAY', 'ค่าเสี่ยงภัย'],
  'dock.bar': ['THE BAR', 'บาร์ประจำสถานี'],
  'dock.aboard': ['ABOARD', 'บนยาน'],
  'dock.signOn': ['SIGN ON', 'ว่าจ้าง'],
  'dock.berthFilled': ['BERTH FILLED', 'ตำแหน่งเต็มแล้ว'],
  'dock.system': ['SYSTEM', 'ระบบ'],
  'dock.fitted': ['FITTED', 'ที่ติดตั้ง'],
  'dock.fullyFitted': ['FULLY FITTED', 'ติดตั้งสูงสุดแล้ว'],
  'dock.logChartsSold': ['CHARTS SOLD', 'ขายแผนที่แล้ว'],
  'dock.logFitted': ['FITTED', 'ติดตั้งแล้ว'],
  'dock.logTaken': ['CONTRACT TAKEN', 'รับงานแล้ว'],
  'dock.logDelivered': ['DELIVERED', 'ส่งมอบแล้ว'],
  'dock.logSigned': ['SIGNED ON', 'ว่าจ้างแล้ว'],
  'dock.reports': ['TRAFFIC REPORTS', 'รายงานจากสถานีอื่น'],
  'dock.reportsNote': ['quotes ride the freighters — the farther the board, the older the news',
    'ราคาเดินทางมากับเรือขนส่ง — ยิ่งไกล ข่าวยิ่งเก่า'],
  'dock.byLane': ['by lane', 'ตามเส้นทาง'],
  'dock.report': ['report', 'ข้อมูลเมื่อ'],
  'dock.live': ['live', 'สดใหม่'],
  'dock.old': ['old', 'ที่แล้ว'],

  /* ---------------------------------------------------------- the chart */
  'map.title': ['STELLAR CARTOGRAPHY', 'แผนที่ดาว'],
  'map.uncharted': ['UNCHARTED', 'ยังไม่สำรวจ'],
  'map.class': ['CLASS', 'ประเภท'],
  'map.territory': ['TERRITORY', 'เขตอิทธิพล'],
  'map.distance': ['DISTANCE', 'ระยะทาง'],
  'map.lane': ['LANE', 'เส้นทาง'],
  'map.nebula': ['NEBULA', 'เนบิวลา'],
  'map.foldCost': ['FOLD COST', 'ค่าพับอวกาศ'],
  'map.charge': ['CHARGE', 'ประจุ'],
  'map.lucent': ['LUCENT', 'ลูเซนต์'],
  'map.signal': ['SIGNAL', 'สัญญาณ'],
  'map.resonator': ['TINE', 'เครื่องกำธร'],
  'map.charted': ['CHARTED', 'สำรวจแล้ว'],
  'map.unsurveyed': ['UNSURVEYED', 'ยังไม่สำรวจ'],
  'map.none': ['NONE', 'ไม่มี'],
  'map.beyondDrive': ['BEYOND DRIVE', 'เกินกำลังเครื่อง'],
  'map.current': ['CURRENT SYSTEM', 'ระบบปัจจุบัน'],
  'map.pressJ': ['PRESS  J  TO FOLD', 'กด  J  เพื่อพับอวกาศ'],
  'map.tooDense': ['NEBULA TOO DENSE · CHART A NEARER LANE',
    'เนบิวลาหนาเกินไป · สำรวจเส้นทางที่ใกล้กว่าก่อน'],
  'map.noCharge': ['INSUFFICIENT CHARGE', 'ประจุไม่เพียงพอ'],
  'map.noFuel': ['NOT ENOUGH LUCENT · REFUEL OR MINE FOR IT',
    'ลูเซนต์ไม่พอ · เติมเชื้อเพลิงหรือไปขุดเพิ่ม'],

  /* ----------------------------------------------------------- the comms */
  'comms.open': ['CHANNEL OPEN', 'เปิดช่องสัญญาณ'],
  'comms.hailing': ['Hailing %N. They are listening. Choose how you open.',
    'กำลังติดต่อ %N — อีกฝ่ายกำลังฟังอยู่ เลือกท่าทีที่จะเปิดบทสนทนา'],
  'comms.friendly': ['FRIENDLY', 'เป็นมิตร'],
  'comms.businesslike': ['BUSINESSLIKE', 'ตรงไปตรงมา'],
  'comms.obsequious': ['OBSEQUIOUS', 'ประจบประแจง'],
  'comms.hostile': ['HOSTILE', 'ก้าวร้าว'],
  'comms.ask': ['ASK FOR NEWS', 'ขอข่าวคราว'],
  'comms.theySell': ['THEY SELL', 'พวกเขาขาย'],
  'comms.theyBuy': ['THEY BUY', 'พวกเขารับซื้อ'],
  'comms.end': ['BREAK CONTACT', 'ตัดการติดต่อ'],
  'comms.accept': ['ACCEPT', 'ตกลง'],
  'comms.counter': ['COUNTER', 'ต่อรอง'],
  'comms.walk': ['WALK AWAY', 'ปฏิเสธ'],
  'comms.close': ['CLOSE CHANNEL', 'ปิดช่องสัญญาณ'],
  'comms.filed': ['Filed to the rumor ledger.', 'บันทึกลงสมุดข่าวลือแล้ว'],
  'comms.cannotPay': ['You cannot cover the fee.', 'เครดิตไม่พอจ่าย'],

  /* ---------------------------------------------------------- the archive */
  'cx.archive': ['ARCHIVE', 'คลังข้อมูล'],
  'cx.survey': ['SURVEY', 'บันทึกสำรวจ'],
  'cx.cantos': ['THE CANTOS', 'บทกำธร'],
  'cx.records': ['RECORDS', 'เอกสารเก่า'],
  'cx.question': ['THE QUESTION', 'คำถาม'],
  'cx.questionLabel': ['Why is there a nebula here?', 'ทำไมถึงมีเนบิวลาอยู่ตรงนี้'],
  'cx.rumors': ['RUMOR LEDGER', 'สมุดข่าวลือ'],
  'cx.rumorsLabel': ['What the nebula says', 'สิ่งที่ได้ยินมาจากทั่วเนบิวลา'],
  'cx.deposits': ['SUBSURFACE SURVEY', 'ผลสำรวจใต้พื้นผิว'],
  'cx.nothingWorth': ['Nothing worth the fuel.', 'ไม่มีอะไรคุ้มค่าเชื้อเพลิง'],
  'cx.workedOut': ['worked out', 'ขุดหมดแล้ว'],
  'cx.bearing': ['bearing', 'ทิศ'],
  'cx.mineHint': ['Set down and hold F to work a seam.',
    'ลงจอดแล้วกด F ค้างไว้เพื่อขุด'],

  /* ------------------------------------------------------ control hints */
  'k.move': ['move', 'เดิน'],
  'k.look': ['look', 'มองรอบ'],
  'k.use': ['use', 'ใช้งาน'],
  'k.run': ['run', 'วิ่ง'],
  'k.outside': ['outside view', 'มุมมองภายนอก'],
  'k.fly': ['fly', 'บังคับยาน'],
  'k.throttle': ['throttle', 'เร่ง/ลด'],
  'k.scan': ['scan', 'สแกน'],
  'k.autopilot': ['autopilot', 'ระบบอัตโนมัติ'],
  'k.fold': ['fold', 'พับอวกาศ'],
  'k.stand': ['stand', 'ลุกจากที่นั่ง'],
  'k.land': ['land', 'ลงจอด'],
  'k.dock': ['dock', 'เทียบท่า'],
  'k.hail': ['hail', 'ติดต่อ'],
  'k.mine': ['mine', 'ขุด'],
  'k.liftOff': ['lift off', 'ทะยานขึ้น'],
  'k.board': ['board', 'ขึ้นยาน'],
  'k.stepOut': ['step out', 'ลงจากยาน'],
  'k.archive': ['archive', 'คลังข้อมูล'],
  'k.close': ['close', 'ปิด'],
  'k.selectSystem': ['select system', 'เลือกระบบดาว'],
  'k.foldTo': ['fold to target', 'พับไปยังเป้าหมาย'],
  'k.chase': ['chase cam', 'กล้องตามยาน'],
  'k.cockpit': ['cockpit', 'ห้องนักบิน'],

  /* ------------------------------------------------------- commodities */
  'c.volatiles': ['Volatiles', 'สารระเหย'],
  'c.ore': ['Raw Ore', 'แร่ดิบ'],
  'c.alloys': ['Alloys', 'โลหะผสม'],
  'c.fuel': ['Fuel Cells', 'เซลล์เชื้อเพลิง'],
  'c.food': ['Provisions', 'เสบียง'],
  'c.medicine': ['Medicine', 'เวชภัณฑ์'],
  'c.machinery': ['Machinery', 'เครื่องจักร'],
  'c.luxuries': ['Luxuries', 'ของฟุ่มเฟือย'],
  'c.lucent': ['Lucent', 'ลูเซนต์'],
};

let lang = 'en';
const listeners = new Set();

/** Translate. Unknown keys return the key itself, which is loud enough to
 *  notice in a screenshot and harmless enough to ship. */
export function t(key, vars) {
  const row = STRINGS[key];
  let s = row ? (row[lang === 'th' ? 1 : 0] ?? row[0]) : key;
  if (vars) for (const k in vars) s = s.replaceAll(k, vars[k]);
  return s;
}

/** Commodity display name. The economy owns the data — ids, base prices and
 *  descriptions stay in Economy.js — and this only decides what a player sees
 *  on a row, falling back to the English name for anything not in the table. */
export function goodName(id, fallback) {
  const row = STRINGS[`c.${id}`];
  return row ? (row[lang === 'th' ? 1 : 0] ?? row[0]) : (fallback || id);
}

export const getLang = () => lang;

export function setLang(next) {
  if (!LANGS[next] || next === lang) return;
  lang = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* ephemeral run */ }
  for (const fn of listeners) fn(next);
}

/** Called by anything that has to redraw when the language changes. */
export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Restore the saved choice, or take the browser's hint the first time. */
export function initLang() {
  let want = null;
  try { want = localStorage.getItem(KEY); } catch { /* ignore */ }
  if (!LANGS[want]) {
    want = (navigator.languages || [navigator.language || 'en'])
      .some((l) => String(l).toLowerCase().startsWith('th')) ? 'th' : 'en';
  }
  lang = want;
  document.documentElement.lang = want;
  return want;
}

/** Wire a two-button EN|TH control. Used by the boot screen and the HUD. */
export function mountToggle(el) {
  if (!el) return;
  const paint = () => {
    el.innerHTML = Object.entries(LANGS).map(([id, label]) =>
      `<button data-lang="${id}" class="${id === lang ? 'on' : ''}">${label}</button>`).join('');
  };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]');
    if (b) setLang(b.dataset.lang);
  });
  onLangChange(paint);
  paint();
}
