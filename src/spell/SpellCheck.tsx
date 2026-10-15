import { useState } from "react";
import { addOwnWord, applyFix, checkText, lastEngine, ltError, type Issue } from "./spell";

/** Kleiner Knopf „Prüfen“ unter einem Textfeld, zeigt Fehler mit Vorschlägen zum Anklicken */
export function SpellCheck({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState("");
  const run = async (text = value) => {
    setBusy(true);
    try { setIssues(await checkText(text)); setEngine(lastEngine + (lastEngine === "Hunspell" && ltError ? " (LanguageTool: " + ltError + ")" : "")); } finally { setBusy(false); }
  };
  const fix = (i: Issue, s: string) => { const t = applyFix(value, i, s); onChange(t); run(t); };
  return (
    <div className={"spell" + (compact ? " compact" : "")}>
      <button type="button" className="mini spellbtn" onClick={() => run()} disabled={busy || !value.trim()}>
        {busy ? "prüfe …" : issues === null ? "Text prüfen" : "Nochmal prüfen"}
      </button>
      {issues !== null && engine && <small className="spelleng">geprüft mit {engine}</small>}
      {issues !== null && (
        issues.length === 0 ? <span className="spellok">Keine Fehler gefunden ✓</span> : (
          <ul className="spelllist">
            {issues.map((i, k) => (
              <li key={k} className={"sp-" + i.kind}>
                <b>{i.text.trim() || "␣"}</b><small>{i.msg}</small>
                <span className="spellsug">
                  {i.suggestions.map((s) => <button type="button" key={s} className="chip clickable" onClick={() => fix(i, s)}>{s.trim() ? s : "␣"}</button>)}
                  {i.kind === "spell" && <button type="button" className="chip clickable own" title="Wort ins eigene Wörterbuch aufnehmen" onClick={async () => { await addOwnWord(i.text); run(); }}>+ Wörterbuch</button>}
                </span>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
