import { readFileSync, writeFileSync } from "node:fs";
import { makeEmptyCopy, buildFreeDocx } from "../src/report/freeTemplate";
import { weekDates } from "../src/report/types";
const rd = (f: string) => { const b = readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const dates = weekDates(2026, 42);
const days = dates.slice(0, 5).map((date, i) => ({ date, presence: "anwesend" as const, place: i === 2 ? "Schule" : "Betrieb",
  entries: i === 3 ? [] : [{ text: "Beispiel-Tätigkeit " + (i + 1) + ": Buchblock geheftet", quals: i === 0 ? ["Herstellen buchbinderischer Erzeugnisse"] : [] }, ...(i === 1 ? [{ text: "Zweiter Eintrag am Dienstag", quals: [] }] : [])] }));
const draft = { year: 2026, week: 42, days };
const meta = { name: "Neu, Nina", beruf: "Buchbinder/in", betrieb: "Werkstatt Nord", ausbilder: "Kraft, Karl", kammer: "HWK Düsseldorf" };
(async () => {
  for (const f of ["fremd_gefuellt", "fremd_text"]) {
    const empty = await makeEmptyCopy(rd(`/tmp/free/${f}.docx`));
    writeFileSync(`/tmp/free/${f}_leer.docx`, Buffer.from(empty));
    const out = await buildFreeDocx(empty, draft, meta, { quals: true, kammer: "HWK" });
    writeFileSync(`/tmp/free/${f}_neu.docx`, out);
    console.log("ok", f);
  }
})();
