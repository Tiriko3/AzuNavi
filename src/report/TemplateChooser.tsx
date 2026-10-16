// Vorlage wählen: Standard-Vorlage deines Berufs (mit Vorschau), eigene Datei hochladen, oder alte Berichtshefte (kommen im Import).
// Nichts wird abgelehnt: ein fremdes Word-Layout wird als Rahmen benutzt oder zur leeren Kopie gemacht.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { baseName, fsapi } from "../fsapi";
import { analyzeTemplate, adoptTemplate, useBundledTemplate, type TemplateKind } from "./templates";
import { previewOf } from "./previews";
import type { BerufProfile } from "../profiles/berufe";

export type TplChoice =
  | { mode: "standard" }
  | { mode: "datei"; name: string; bytes: ArrayBuffer; kind: TemplateKind; quals: string[]; free: "leer" | "standard" };

export async function applyTplChoice(c: TplChoice): Promise<void> {
  if (c.mode === "standard" || (c.kind === "frei" && c.free === "standard")) { await useBundledTemplate(); return; }
  await adoptTemplate(c.bytes, c.kind === "frei" && c.free === "leer", c.name);
}

export function TemplateChooser({ prof, value, onChange }: { prof: BerufProfile | null; value: TplChoice; onChange: (c: TplChoice) => void }) {
  const [big, setBig] = useState(false);
  const [err, setErr] = useState("");
  const [pdf, setPdf] = useState("");
  const img = previewOf(prof?.id);
  // Esc schließt die Großansicht (und nur sie)
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setBig(false); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [big]);

  const pick = async () => {
    setErr(""); setPdf("");
    const fs = await fsapi();
    const path = await fs.pickFile();
    if (!path) return;
    const name = baseName(path);
    try {
      if (/\.pdf$/i.test(name)) { setPdf(name); return; }
      if (!/\.docx$/i.test(name)) { setErr("Bitte eine Word-Datei (.docx) wählen. Alte Berichtshefte als PDF gehen im Import."); return; }
      const u = await fs.read(path, 30 * 1024 * 1024);
      const bytes = u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
      const info = await analyzeTemplate(bytes);
      onChange({ mode: "datei", name, bytes, kind: info.kind, quals: info.quals, free: "leer" });
    } catch (e) { setErr(String(e).replace(/^Error:\s*/, "")); }
  };

  return (
    <div className="tplc">
      <div className={"tplcard" + (value.mode === "standard" ? " on" : "")} onClick={() => onChange({ mode: "standard" })} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange({ mode: "standard" }); } }}>
        <img className="tplthumb" src={img} alt="Vorschau der Standard-Vorlage" draggable={false} onClick={(e) => { e.stopPropagation(); setBig(true); }} />
        <div className="tplbody">
          <b>Standard-Vorlage{prof ? ` für ${prof.beruf}` : ""}</b>
          <p>{prof ? prof.hinweis : "Sauberes Layout mit Tageskarten."} Ich fülle sie jede Woche für dich aus.</p>
          <button type="button" className="mini" onClick={(e) => { e.stopPropagation(); setBig(true); }}>Vorlage ansehen</button>
        </div>
      </div>

      <div className={"tplcard" + (value.mode === "datei" ? " on" : "")}>
        <div className="tplbody">
          <b>Eigene Vorlage hochladen</b>
          <p>Deine Word-Datei (.docx) von der Kammer oder vom Betrieb. Sie muss nicht wie die der IHK aussehen, ich nehme jedes Layout.</p>
          <button type="button" className="btn" onClick={pick}><span>{value.mode === "datei" ? "Andere Datei wählen" : "Datei wählen"}</span></button>
          {err && <div className="errbox">{err}</div>}
          {pdf && <p className="tutnote">„{pdf}“ ist eine PDF, die kann ich nicht ausfüllen. Ich bleibe bei der Standard-Vorlage. Die Einträge aus der PDF holst du im nächsten Schritt mit dem Import rein.</p>}
          {value.mode === "datei" && (
            <div className="tplinfo">
              <p className="tutnote ok">„{value.name}“:{" "}
                {value.kind === "karten" ? "Tageskarten-Vorlage erkannt. Ich exportiere genau in diesem Format."
                  : value.kind === "platzhalter" ? "Vorlage mit Platzhaltern ({{…}}) erkannt. Die fülle ich beim Export aus."
                  : "Das Layout kenne ich nicht genau, ich nehme es trotzdem als Rahmen und trage Name, Woche und Tätigkeiten ein."}</p>
              {value.kind === "frei" && (
                <div className="tplradio">
                  <label><input type="radio" name="freechoice" checked={value.free === "leer"} onChange={() => onChange({ ...value, free: "leer" })} /> Leere Vorlage daraus machen (ich entferne den Text, Layout bleibt)</label>
                  <label><input type="radio" name="freechoice" checked={value.free === "standard"} onChange={() => onChange({ ...value, free: "standard" })} /> Doch die Standard-Vorlage nehmen</label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="tplcard hint">
        <div className="tplbody">
          <b>Alte Berichtshefte?</b>
          <p>Hast du schon welche geschrieben, holst du sie im nächsten Schritt rein. Danach frage ich, ob ich aus einem davon eine leere Vorlage machen soll.</p>
        </div>
      </div>

      {big && createPortal(
        <div className="tplbig" onClick={() => setBig(false)} role="dialog" aria-label="Vorlage ansehen">
          <img src={img} alt="Standard-Vorlage" draggable={false} />
          <button className="btn" onClick={() => setBig(false)}><span>Schließen (Esc)</span></button>
        </div>, document.body)}
    </div>
  );
}
