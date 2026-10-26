// Vorlage wählen: Standard-Vorlage deines Berufs (mit Vorschau), eigene Datei hochladen, oder alte Berichtshefte (kommen im Import).
// Nichts wird abgelehnt: ein fremdes Word-Layout wird als Rahmen benutzt oder zur leeren Kopie gemacht.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { baseName, fsapi } from "../fsapi";
import { analyzeTemplate, adoptTemplate, useBundledTemplate, BUILTINS, type BuiltinId, type TemplateKind } from "./templates";
import { previewOf } from "./previews";
import type { BerufProfile } from "../profiles/berufe";

export type TplChoice =
  | { mode: "standard" }   // = IHK-Tageskarten
  | { mode: "vorlage"; id: BuiltinId }
  | { mode: "datei"; name: string; bytes: ArrayBuffer; kind: TemplateKind; quals: string[]; free: "leer" | "standard" };

export async function applyTplChoice(c: TplChoice): Promise<void> {
  if (c.mode === "vorlage") { await useBundledTemplate(c.id); return; }
  if (c.mode === "standard" || (c.kind === "frei" && c.free === "standard")) { await useBundledTemplate("ihk"); return; }
  await adoptTemplate(c.bytes, c.kind === "frei" && c.free === "leer", c.name);
}

export function TemplateChooser({ prof, value, onChange }: { prof: BerufProfile | null; value: TplChoice; onChange: (c: TplChoice) => void }) {
  const [big, setBig] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [pdf, setPdf] = useState("");
  const imgOf = (id: BuiltinId) => previewOf(id === "ihk" ? prof?.id : id);
  const chosen: BuiltinId | null = value.mode === "standard" ? "ihk" : value.mode === "vorlage" ? value.id : null;
  // Esc schließt die Großansicht (und nur sie)
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); setBig(null); } };
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
      {BUILTINS.map((b) => (
        <div key={b.id} className={"tplcard" + (chosen === b.id ? " on" : "")} role="button" tabIndex={0}
          onClick={() => onChange(b.id === "ihk" ? { mode: "standard" } : { mode: "vorlage", id: b.id })}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onChange(b.id === "ihk" ? { mode: "standard" } : { mode: "vorlage", id: b.id }); } }}>
          <img className="tplthumb" src={imgOf(b.id)} alt={`Vorschau: ${b.label}`} draggable={false} onClick={(e) => { e.stopPropagation(); setBig(imgOf(b.id)); }} />
          <div className="tplbody">
            <b>{b.id === "ihk" && prof ? `${b.label} für ${prof.beruf}` : b.label}</b>
            <p>{b.id === "ihk" && prof ? prof.hinweis + " " : ""}{b.hinweis}{b.ext === "pdf" ? " Export als PDF." : " Export als Word."}</p>
            <button type="button" className="mini" onClick={(e) => { e.stopPropagation(); setBig(imgOf(b.id)); }}>Vorlage ansehen</button>
          </div>
        </div>
      ))}

      <div className={"tplcard" + (value.mode === "datei" ? " on" : "")}>
        <div className="tplbody">
          <b>Eigene Vorlage hochladen</b>
          <p>Deine Word-Datei (.docx) von der Kammer oder vom Betrieb. Sie muss nicht wie die der IHK aussehen, ich nehme jedes Layout. Ein PDF-Formular als eigene Vorlage geht nicht, dafür gibt es oben die eingebaute PDF-Vorlage.</p>
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
        <div className="tplbig" onClick={() => setBig(null)} role="dialog" aria-label="Vorlage ansehen">
          <img src={big} alt="Vorlage" draggable={false} />
          <button className="btn" onClick={() => setBig(null)}><span>Schließen (Esc)</span></button>
        </div>, document.body)}
    </div>
  );
}
