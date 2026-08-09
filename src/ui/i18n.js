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

   Scope, stated honestly. Translated: the *interface* — every label, verb,
   column head, banner and control hint a player reads on repeat — and the
   catalogue copy sitting beside it, meaning the commodity shelf-notes, the
   five outfits with their fifteen tiers, and the crew roles with what each
   one actually does to the ship. Those are not story; they are the text a
   player compares two purchases with, and a shopping decision made in a
   second language is a worse decision.

   Not translated: the long-form fiction — the Tones, the station logs, the
   alien dialogue, the revelations. Translating prose that carries the story
   is a different job from translating a button, and doing it badly would be
   worse than not doing it at all.
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

  'gm.title': ['SURFACE CHART', 'แผนที่ภาคพื้น'],
  'gm.pack': ['PACK', 'พลังงานสำรอง'],
  'gm.stowed': ['rover stowed · deploy with R', 'ยานสำรวจเก็บอยู่ · กด R เพื่อนำออก'],
  'gm.beyond': ['no return', 'ไปแล้วกลับไม่ได้'],
  'gm.empty': ['Nothing surveyed here.', 'ยังไม่มีอะไรถูกสำรวจที่นี่'],
  'gm.note': ['inner ring is there and back · outer is one way',
    'วงในคือไปกลับได้ · วงนอกคือไปได้อย่างเดียว'],

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
  'k.drive': ['drive', 'ขับ'],
  'k.workSite': ['work the site', 'สำรวจจุดนี้'],
  'k.stow': ['stow rover', 'เก็บยานสำรวจ'],
  'k.rover': ['rover', 'ยานสำรวจภาคพื้น'],
  'k.chart': ['surface chart', 'แผนที่ภาคพื้น'],
  'k.archive': ['archive', 'คลังข้อมูล'],
  'k.close': ['close', 'ปิด'],
  'k.selectSystem': ['select system', 'เลือกระบบดาว'],
  'k.foldTo': ['fold to target', 'พับไปยังเป้าหมาย'],
  'k.chase': ['chase cam', 'กล้องตามยาน'],
  'k.cockpit': ['cockpit', 'ห้องนักบิน'],



  /* --------------------------------------------------- the archive, in full
     Everything the Archive prints, not only its furniture. The nav headings
     were translated first and the entries were not, which is the worst of
     both: a Thai menu opening onto an English page. */
  'cx.expedition': ['Expedition', 'ภารกิจสำรวจ'],
  'cx.sealed': ['— sealed —', '— ยังไม่เปิดผนึก —'],
  'cx.noRecord': ['no record', 'ไม่มีบันทึก'],
  'cx.commission': ['DEEP SURVEY VESSEL LONG MARGIN · COMMISSION 1101',
    'ยานสำรวจห้วงอวกาศลึก ลองมาร์จิน · ภารกิจที่ 1101'],
  'cx.s.charted': ['SYSTEMS CHARTED', 'ระบบดาวที่สำรวจแล้ว'],
  'cx.s.lanes': ['LANES SURVEYED', 'เส้นทางที่สำรวจแล้ว'],
  'cx.s.ledger': ['LEDGER', 'บัญชี'],
  'cx.s.bodies': ['BODIES CATALOGUED', 'วัตถุที่บันทึกไว้'],
  'cx.s.resonance': ['RESONANCE', 'การกำธร'],
  'cx.s.system': ['CURRENT SYSTEM', 'ระบบดาวปัจจุบัน'],
  'cx.s.star': ['STAR', 'ดาวฤกษ์'],
  'cx.s.hull': ['HULL', 'ตัวยาน'],
  'cx.s.understood': ['UNDERSTOOD', 'ที่เข้าใจแล้ว'],
  'cx.s.tines': ['TINES', 'เครื่องกำธร'],
  'cx.s.burned': ['LUCENT BURNED', 'ลูเซนต์ที่เผาไป'],
  'cx.s.accounts': ['ACCOUNTS HEARD', 'คำบอกเล่าที่ได้ยิน'],
  'cx.s.temp': ['EFFECTIVE TEMP', 'อุณหภูมิยังผล'],
  'cx.s.radius': ['RADIUS', 'รัศมี'],
  'cx.s.lum': ['LUMINOSITY', 'ความส่องสว่าง'],
  'cx.s.range': ['RANGE', 'ระยะห่าง'],
  'cx.s.class': ['CLASS', 'ประเภท'],
  'cx.s.classif': ['CLASSIFICATION', 'การจำแนก'],
  'cx.s.inSystem': ['SYSTEM', 'ระบบดาว'],
  'cx.s.gravity': ['SURFACE GRAVITY', 'แรงโน้มถ่วงพื้นผิว'],
  'cx.s.orbit': ['ORBITAL RADIUS', 'รัศมีวงโคจร'],
  'cx.s.tilt': ['AXIAL TILT', 'ความเอียงแกน'],
  'cx.s.rot': ['ROTATION', 'คาบหมุนรอบตัว'],
  'cx.s.atmo': ['ATMOSPHERE', 'ชั้นบรรยากาศ'],
  'cx.s.hydro': ['HYDROSPHERE', 'อุทกภาค'],
  'cx.s.rings': ['RING SYSTEM', 'ระบบวงแหวน'],
  'cx.v.present': ['PRESENT', 'มี'],
  'cx.v.negligible': ['NEGLIGIBLE', 'เบาบางมาก'],
  'cx.v.none': ['NONE', 'ไม่มี'],
  'cx.v.yes': ['YES', 'มี'],
  'cx.v.no': ['NO', 'ไม่มี'],
  'cx.satellite': ['SATELLITE', 'ดาวบริวาร'],
  'cx.nonNatural': ['NON-NATURAL ORIGIN', 'ไม่ได้เกิดขึ้นเองตามธรรมชาติ'],
  'cx.overview1': ['Forty thousand years ago, nine hundred inhabited worlds fell silent inside a volume of space eighty light-years across. No debris. No radiation signature. No sign of violence at any scale we can measure.',
    'สี่หมื่นปีก่อน โลกที่มีผู้อยู่อาศัยเก้าร้อยดวงเงียบลงพร้อมกันภายในห้วงอวกาศกว้างแปดสิบปีแสง ไม่มีเศษซาก ไม่มีร่องรอยรังสี ไม่มีสัญญาณของความรุนแรงในระดับใดที่เราวัดได้'],
  'cx.overview2': ['The Hush left their cities lit and their orbits tidy, and they left seven instruments — the Tines — standing in seven systems.',
    'ชาวฮัชทิ้งเมืองที่ยังเปิดไฟไว้ ทิ้งวงโคจรที่ยังเป็นระเบียบ และทิ้งเครื่องมือไว้เจ็ดชิ้น — เครื่องกำธร — ตั้งอยู่ในระบบดาวเจ็ดแห่ง'],
  'cx.overviewQ': ['Chart what you can. Scan what you find. Attune what will let you.',
    'สำรวจเท่าที่ทำได้ สแกนทุกอย่างที่พบ และกำธรกับสิ่งที่ยอมให้คุณกำธร'],
  'cx.q.title': ['THE QUESTION', 'คำถาม'],
  'cx.q.sub': ['WHY IS THERE A NEBULA HERE?', 'ทำไมถึงมีเนบิวลาอยู่ตรงนี้'],
  'cx.q.said': ['WHAT THEY SAY HAPPENED', 'สิ่งที่พวกเขาบอกว่าเกิดขึ้น'],
  'cx.q.worked': ['WHAT YOU HAVE WORKED OUT', 'สิ่งที่คุณปะติดปะต่อได้แล้ว'],
  'cx.q.intro': ['Four cultures, four answers, every one delivered with complete confidence and no two alike. Nobody here corroborates anybody: the disagreement <em>is</em> the evidence. What they cannot explain between them is what the ship\'s own instruments keep finding.',
    'สี่วัฒนธรรม สี่คำตอบ ทุกคำตอบพูดออกมาอย่างมั่นใจเต็มที่ และไม่มีคู่ไหนตรงกันเลย ไม่มีใครยืนยันคำของใคร — <em>ความขัดแย้ง</em>นั่นแหละคือหลักฐาน สิ่งที่พวกเขาอธิบายร่วมกันไม่ได้ คือสิ่งที่เครื่องมือบนยานของคุณตรวจพบซ้ำแล้วซ้ำเล่า'],
  'cx.q.contested': ['CONTESTED', 'ยังขัดแย้งกัน'],
  'cx.q.unchallenged': ['unchallenged so far', 'ยังไม่มีใครโต้แย้ง'],
  'cx.q.locked': ['— not yet understood —', '— ยังไม่เข้าใจ —'],
  'cx.q.nobody': ['Nobody has told you anything about the Hush yet. Hail somebody and ask for news.',
    'ยังไม่มีใครเล่าเรื่องชาวฮัชให้คุณฟังเลย ลองติดต่อใครสักคนแล้วขอข่าวคราวดู'],
  'cx.r.title': ['RUMOR LEDGER', 'สมุดข่าวลือ'],
  'cx.r.sub': ['HEARSAY, FILED · BELIEVE IT AT YOUR OWN MARGIN',
    'คำบอกเล่าที่บันทึกไว้ · จะเชื่อหรือไม่ ก็เป็นกำไรขาดทุนของคุณเอง'],
  'cx.r.intro': ['Everything anyone has told you, exactly as they told it. Two mouths agreeing is worth something; one mouth is worth what you paid it.',
    'ทุกอย่างที่มีคนเล่าให้ฟัง บันทึกไว้ตามที่เขาเล่า สองปากที่ตรงกันมีค่าอยู่บ้าง ส่วนปากเดียวมีค่าเท่าที่คุณจ่ายไป'],
  'cx.r.cor': ['CORROBORATED', 'มีคนยืนยันตรงกัน'],
  'cx.r.uncor': ['uncorroborated', 'ยังไม่มีใครยืนยัน'],
  'cx.night': ['Photometry of the night hemisphere shows structured emission along the coastlines. Someone lived here. The lights are still on.',
    'การวัดแสงด้านซีกกลางคืนพบการเปล่งแสงเป็นรูปแบบตามแนวชายฝั่ง เคยมีคนอาศัยอยู่ที่นี่ และไฟยังไม่ดับ'],
  'cx.sites': ['SURFACE SURVEY', 'ผลสำรวจภาคพื้น'],
  'cx.sitesNote': ['Land, take the rover out with <kbd>R</kbd>, and drive to them.',
    'ลงจอด กด <kbd>R</kbd> เพื่อนำยานสำรวจออก แล้วขับไปยังจุดเหล่านี้'],
  'cx.site.seam': ['SEAM', 'สายแร่'],
  'cx.site.wreck': ['WRECK', 'ซากยาน'],
  'cx.site.marker': ['HUSH MARKER', 'เครื่องหมายของชาวฮัช'],
  'cx.site.survivor': ['SIGNAL, REPEATING', 'สัญญาณที่วนซ้ำ'],
  'cx.site.done': ['worked', 'สำรวจแล้ว'],
  'cx.mineHintFull': ['Set down and hold <kbd>F</kbd> to work a seam.',
    'ลงจอดแล้วกด <kbd>F</kbd> ค้างไว้เพื่อขุดสายแร่'],

  /* ------------------------------------------------------ what they claim */
  'my.claim.institute': ['Registry position: the Stillness was an event, not an act. Something passed through and the Hush were in its way. Nine hundred worlds is what a weapon looks like when nobody survives to name it.',
    'จุดยืนของเดอะเรจิสทรี: ความนิ่งงันเป็นเหตุการณ์ ไม่ใช่การกระทำ มีบางอย่างผ่านมาและชาวฮัชบังเอิญขวางทางอยู่ เก้าร้อยโลกคือหน้าตาของอาวุธ เมื่อไม่มีใครรอดมาเรียกชื่อมัน'],
  'my.claim.vess': ['The Combine holds that the Hush simply left — packed nine hundred worlds into whatever they built the Tines to open, and went. The dust is what they did not take. There is no mystery, only freight.',
    'สมาพันธ์เวสส์ยืนยันว่าชาวฮัชแค่ไปเฉย ๆ — ขนเก้าร้อยโลกเข้าไปในสิ่งที่พวกเขาสร้างเครื่องกำธรขึ้นมาเปิด แล้วก็ไป ฝุ่นคือของที่ไม่ได้ขนไป ไม่มีปริศนาอะไร มีแต่สินค้า'],
  'my.claim.korrim': ['The lodges say a sickness took them, and the dust is a quarantine they laid over their own graves. They will tell you not to breathe it, and they mean it as advice rather than as history.',
    'สำนักคอร์ริมว่าโรคระบาดพรากพวกเขาไป และฝุ่นคือด่านกักโรคที่พวกเขาคลุมหลุมศพตัวเองไว้ พวกเขาจะเตือนไม่ให้คุณสูดมันเข้าไป และนั่นคือคำแนะนำ ไม่ใช่ประวัติศาสตร์'],
  'my.claim.szethi': ['The Drift says the Hush are not gone and were never buried. They went thin on purpose, to hear something that only arrives once, and the nebula is the shape they took to hear it. The Drift does not expect to be believed.',
    'ชาวเซธิดริฟต์ว่าชาวฮัชไม่ได้หายไป และไม่เคยถูกฝัง พวกเขาจงใจทำตัวให้บางลง เพื่อจะได้ยินบางสิ่งที่มาถึงเพียงครั้งเดียว และเนบิวลาคือรูปร่างที่พวกเขาแปลงไปเพื่อจะได้ยินมัน ชาวดริฟต์ไม่ได้คาดหวังให้ใครเชื่อ'],

  /* ------------------------------------------------- what you work out */
  'my.instrument.title': ['One instrument, in seven pieces', 'เครื่องมือชิ้นเดียว ที่แยกเป็นเจ็ดส่วน'],
  'my.instrument.need': ['Attune two Tines', 'กำธรกับเครื่องกำธรสองชิ้น'],
  'my.notdead.title': ['Nobody died here', 'ไม่มีใครตายที่นี่'],
  'my.notdead.need': ['Hear two different accounts of the Stillness',
    'ฟังคำบอกเล่าเรื่องความนิ่งงันจากสองแหล่งที่ต่างกัน'],
  'my.census.title': ['The dust is not dust', 'ฝุ่นนั้นไม่ใช่ฝุ่น'],
  'my.census.need': ['Chart six lanes and scan four worlds',
    'สำรวจเส้นทางหกเส้น และสแกนดาวสี่ดวง'],
  'my.lucent.title': ['What you have been burning', 'สิ่งที่คุณเผาไปตลอดทาง'],
  'my.lucent.need': ['Burn twelve tonnes of lucent', 'เผาลูเซนต์ให้ครบสิบสองตัน'],
  'my.aperture.title': ['The Aperture was never a door', 'ช่องรับนั้นไม่เคยเป็นประตู'],
  'my.aperture.need': ['Attune all seven Tines', 'กำธรกับเครื่องกำธรครบทั้งเจ็ดชิ้น'],

  'my.instrument.text': ['', 'เครื่องกำธรไม่ใช่อุปกรณ์เจ็ดชิ้น คลื่นฮาร์มอนิกของมันคือชุดเดียวกัน เพียงเลื่อนเฟสไปเท่ากับเวลาที่แสงใช้เดินทางระหว่างกันพอดี — มันคือเครื่องมือชิ้นเดียว ที่ขึงยาวข้ามแปดสิบปีแสง เพราะนั่นคือขนาดช่องรับที่คลื่นยาวขนาดนั้นต้องการ ไม่ว่าชาวฮัชสร้างมันขึ้นมาเพื่อฟังอะไร สิ่งนั้นไม่ได้อยู่ใกล้ และไม่ได้มาเร็ว'],
  'my.notdead.text': ['', 'ทุกคำบอกเล่าขัดแย้งกันไปหมด แต่ทุกคำมีช่องโหว่เดียวกัน: ไม่มีร่าง ไม่มีศพ ไม่มีหลุมฝัง ไม่มียานที่จอดค้างอยู่ในวงโคจรโดยยังมีใครอยู่ข้างใน เก้าร้อยโลกว่างเปล่าลงภายในสี่วัน โดยไม่เหลืออะไรที่เคยมีชีวิตไว้เลยแม้แต่ชิ้นเดียว นั่นไม่ใช่วิธีที่สิ่งมีชีวิตตาย แต่เป็นวิธีที่บางอย่าง*เปลี่ยนรูป*'],
  'my.census.text': ['', 'เอาสนามความหนาแน่นของฝุ่นไปเทียบกับสำมะโนประชากรของชาวฮัช แล้วความสัมพันธ์ก็ไม่ได้แนบเนียนเลย: เนบิวลาหนาที่สุดตรงจุดที่เคยมีประชากรอยู่พอดี ไม่ใช่ใกล้ ๆ ไม่ใช่รอบ ๆ แต่*ตรงนั้น* ดวงต่อดวง ตรงกันถึงทศนิยม คุณบินผ่านพวกเขามาหลายชั่วโมงแล้ว'],
  'my.lucent.text': ['', 'ลูเซนต์เกิดตรงที่ฝุ่นหนาที่สุด ซึ่งก็คือตรงที่เมืองเคยตั้งอยู่ มันไม่ใช่แร่ และมันไม่ได้ก่อตัวขึ้นเอง มันคือสิ่งตกค้าง และโครงผลึกของมันมีรูปแบบเป็นคาบในแบบที่ไม่มีอะไรทางธรณีวิทยาเป็นได้ ทุกครั้งที่คุณพับอวกาศ คุณใช้ใครบางคนเป็นพลังงาน เดอะเรจิสทรีตีราคามันไว้ตันละสิบสี่เครดิต และอู่ก็ยินดีขายถังใบใหญ่กว่าเดิมให้คุณ'],
  'my.aperture.text': ['', 'เสียงที่เจ็ดทำให้เฟสสมบูรณ์ และในที่สุดเครื่องมือก็แยกแยะสิ่งที่มันถูกสร้างมาเพื่อฟังออก — และมันไม่ใช่สัญญาณ มันคือเสียงของชาวฮัช ที่ยังฟังอยู่ แผ่บางข้ามแปดสิบปีแสง รอสิ่งที่ยังมาไม่ถึง ช่องรับไม่ได้เปิดออก เพราะมันคือหู คุณยืนอยู่ข้างในมัน และมันเปิดอยู่มาตลอด'],

  /* ---------------------------------------------------------- the outfits */
  'o.hold.name': ['Cargo Hold', 'ระวางสินค้า'],
  'o.hold.blurb': ['Pods clamped along the spine. Every tonne is a tonne you can sell.',
    'ฝักบรรทุกยึดตามแนวสันยาน ทุกตันคือของที่ขายได้'],
  'o.hold.0': ['Standard bay', 'ระวางมาตรฐาน'],
  'o.hold.1': ['Extended pods', 'ฝักบรรทุกเสริม'],
  'o.hold.2': ['Freighter frame', 'โครงยานขนส่ง'],
  'o.tank.name': ['Lucent Tank', 'ถังลูเซนต์'],
  'o.tank.blurb': ['How far you can go before the nebula decides where you live.',
    'ไปได้ไกลแค่ไหน ก่อนที่เนบิวลาจะเป็นคนเลือกที่อยู่ให้คุณ'],
  'o.tank.0': ['Survey tank', 'ถังสำรวจ'],
  'o.tank.1': ['Long-range tank', 'ถังพิสัยไกล'],
  'o.tank.2': ['Deep-field tank', 'ถังห้วงลึก'],
  'o.scanner.name': ['Survey Scanner', 'เครื่องสแกนสำรวจ'],
  'o.scanner.blurb': ['Faster scans, and the sensitivity to see what a world is holding.',
    'สแกนเร็วขึ้น และไวพอจะเห็นว่าดาวดวงนั้นมีอะไรอยู่ใต้พื้นผิว'],
  'o.scanner.0': ['Registry array', 'ชุดรับสัญญาณมาตรฐาน'],
  'o.scanner.1': ['Phased array', 'ชุดรับแบบเฟสอาเรย์'],
  'o.scanner.2': ['Deep array', 'ชุดรับห้วงลึก'],
  'o.drive.name': ['Fold Drive', 'เครื่องพับอวกาศ'],
  'o.drive.blurb': ['Recharges faster between jumps, and pushes harder in the dust.',
    'ชาร์จเร็วขึ้นระหว่างการกระโดด และฝ่าฝุ่นได้แรงขึ้น'],
  'o.drive.0': ['Standard coil', 'ขดลวดมาตรฐาน'],
  'o.drive.1': ['Tuned coil', 'ขดลวดปรับจูน'],
  'o.drive.2': ['Hush-pattern coil', 'ขดลวดแบบฮัช'],
  'o.engine.name': ['Main Drive', 'เครื่องยนต์หลัก'],
  'o.engine.blurb': ['Cruise speed in-system. Time is the resource nobody prices.',
    'ความเร็วเดินทางในระบบดาว เวลาคือทรัพยากรที่ไม่มีใครตีราคา'],
  'o.engine.0': ['Standard torch', 'เครื่องยนต์มาตรฐาน'],
  'o.engine.1': ['Uprated torch', 'เครื่องยนต์เสริมกำลัง'],
  'o.engine.2': ['Racing torch', 'เครื่องยนต์ความเร็วสูง'],

  /* ------------------------------------------------------------ the crew */
  'r.surveyor.title': ['Surveyor', 'นักสำรวจ'],
  'r.surveyor.blurb': ['Reads a world faster than the array was built to.',
    'อ่านค่าดาวได้เร็วกว่าที่ตัวเครื่องถูกออกแบบมา'],
  'r.surveyor.effect': ['Scans complete 35% sooner', 'สแกนเสร็จเร็วขึ้น 35%'],
  'r.prospector.title': ['Prospector', 'นักหาแร่'],
  'r.prospector.blurb': ['Knows where to put the drill without being told.',
    'รู้ว่าจะลงสว่านตรงไหนโดยไม่ต้องมีใครบอก'],
  'r.prospector.effect': ['The drone works 40% faster', 'โดรนขุดเร็วขึ้น 40%'],
  'r.navigator.title': ['Navigator', 'ต้นหน'],
  'r.navigator.blurb': ['Finds the thin part of a dust bank by instinct.',
    'หาช่องบางของแนวฝุ่นได้ด้วยสัญชาตญาณ'],
  'r.navigator.effect': ['Folds burn 25% less lucent', 'การพับอวกาศใช้ลูเซนต์น้อยลง 25%'],
  'r.quartermaster.title': ['Quartermaster', 'พันจ่าพัสดุ'],
  'r.quartermaster.blurb': ['Has haggled with worse than the Vess, and won.',
    'เคยต่อรองกับคนที่ร้ายกว่าเวสส์ และชนะมาแล้ว'],
  'r.quartermaster.effect': ['Better opening prices in every negotiation',
    'ได้ราคาเปิดที่ดีกว่าในทุกการเจรจา'],
  'r.engineer.title': ['Engineer', 'ช่างเครื่อง'],
  'r.engineer.blurb': ['Keeps the coil inside its tolerances, mostly.',
    'คุมขดลวดให้อยู่ในพิกัด — ส่วนใหญ่นะ'],
  'r.engineer.effect': ['Fold charge recovers 40% faster', 'ประจุพับอวกาศฟื้นเร็วขึ้น 40%'],

  /* ------------------------------------------------ commodity shelf-notes */
  'cd.volatiles': ['Water ice, ammonia and frozen gases, scooped and bagged.',
    'น้ำแข็ง แอมโมเนีย และแก๊สแช่แข็ง ตักใส่ถุงมาแล้ว'],
  'cd.ore': ['Unrefined metals straight off the belt crushers.',
    'โลหะดิบจากเครื่องบดในแถบดาวเคราะห์น้อย'],
  'cd.alloys': ['Refined structural stock. Every yard is hungry for it.',
    'โลหะผสมสำหรับงานโครงสร้าง ทุกอู่ต่อยานต้องการ'],
  'cd.fuel': ['Sealed reaction mass. Stations burn it; so do you.',
    'มวลปฏิกิริยาบรรจุผนึก สถานีเผามันและคุณก็เผา'],
  'cd.food': ['Grown under lamps, vacuum-packed, nearly edible.',
    'ปลูกใต้แสงไฟ อัดสุญญากาศ พอกินได้'],
  'cd.medicine': ['Cold-chain pharmaceuticals. Light, dear, always wanted.',
    'เวชภัณฑ์ควบคุมความเย็น เบา แพง และเป็นที่ต้องการเสมอ'],
  'cd.machinery': ['Pumps, printers, drive parts. Civilisation in crates.',
    'ปั๊ม เครื่องพิมพ์ ชิ้นส่วนเครื่องยนต์ อารยธรรมบรรจุลัง'],
  'cd.luxuries': ['Whatever is rare where you are going.',
    'อะไรก็ตามที่หายากในที่ที่คุณกำลังจะไป'],

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
  let s = row ? (pick(row) ?? key) : key;
  if (vars) for (const k in vars) s = s.replaceAll(k, vars[k]);
  return s;
}

/* The content tables — commodities, outfits, crew roles — stay where they
   are. Economy.js still owns base prices, Outfitting.js still owns tiers and
   costs, Crew.js still owns the multipliers; those modules know nothing about
   language. What crosses over is only the handful of fields a player reads,
   looked up by a key built from the same id the data is stored under, and
   falling back to the English the table already carries. A missing key is a
   row that reads in English, never a row that reads `o.hold.name`. */
export function tx(key, fallback) {
  const row = STRINGS[key];
  if (!row) return fallback ?? key;
  return pick(row) ?? fallback ?? key;
}

/* One row, in the current language, or nothing.
   The empty slot is load-bearing. Some rows exist only to carry a Thai
   translation of prose that already lives in a content module — the
   revelations, say — and writing the English out a second time here would be
   two copies of the same paragraph, drifting apart the first time one is
   edited. Those rows leave the English slot empty and let the caller pass the
   original as the fallback. So an empty string has to read as *absent* rather
   than as a legitimate translation to "", or English renders blank. */
function pick(row) {
  const s = row[lang === 'th' ? 1 : 0];
  if (s === undefined || s === null || s === '') return row[0] || null;
  return s;
}

/** Commodity display name, by id. */
export const goodName = (id, fallback) => tx(`c.${id}`, fallback || id);

/** The one-line shelf note under a commodity on a market row. */
export const goodDesc = (id, fallback) => tx(`cd.${id}`, fallback);

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
