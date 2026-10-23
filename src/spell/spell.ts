// Korrektur (Etappe 9): Rechtschreibung mit Hunspell (wie in LibreOffice) und deutschem Wörterbuch,
// komplett offline. Dazu ein paar einfache Grammatik- und Tippregeln.
import affUrl from "../assets/dict/de.aff?url";
import dicUrl from "../assets/dict/de.dic?url";
import { getSetting, inTauri, setSetting } from "../db/db";


import { BUILTIN_WORDS, builtinCheck, type Hs, type Issue } from "./builtin";
export type { Issue };



let hs: Hs | null = null;
let loading: Promise<void> | null = null;
let own = new Set<string>();
const known = new Set(BUILTIN_WORDS.map((w) => w.toLowerCase()));

/** Lädt Hunspell und das Wörterbuch beim ersten Gebrauch (ca. 0,2 Sekunden) */
export function loadSpell(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      const [factory, aff, dic, words] = await Promise.all([
        import("hunspell-asm").then((m) => m.loadModule()), // erst beim ersten „Text prüfen“ laden
        fetch(affUrl).then((r) => r.arrayBuffer()),
        fetch(dicUrl).then((r) => r.arrayBuffer()),
        getSetting("spell_words").catch(() => null),
      ]);
      const a = factory.mountBuffer(new Uint8Array(aff), "de.aff");
      const d = factory.mountBuffer(new Uint8Array(dic), "de.dic");
      hs = factory.create(a, d);
      try { own = new Set(JSON.parse(words || "[]")); } catch { own = new Set(); }
    })();
  }
  return loading;
}

export let ltError = "";
async function loadOwnWords() {
  if (own.size) return;
  try { own = new Set(JSON.parse((await getSetting("spell_words")) || "[]")); } catch { own = new Set(); }
}

export async function addOwnWord(w: string) {
  own.add(w.toLowerCase());
  await setSetting("spell_words", JSON.stringify([...own]));
}

const isKnown = (w: string) => known.has(w.toLowerCase()) || own.has(w.toLowerCase());

/* ---------- LanguageTool (Java, optional): Rechtschreibung + Grammatik ---------- */
const LT_URL = "http://localhost:8081/v2";
let ltReady: Promise<boolean> | null = null;
let ltFailedAt = 0; // nach einem Fehlschlag 2 Minuten direkt Hunspell nehmen statt erneut zu warten
export let lastEngine: "LanguageTool" | "Hunspell" = "Hunspell";

export async function ltSettings() {
  return { on: (await getSetting("lt_on")) === "1", dir: (await getSetting("lt_dir")) ?? "" };
}
async function ping(): Promise<boolean> {
  try { const r = await fetch(LT_URL + "/languages", { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
}
/** Startet LanguageTool (falls nötig) und wartet, bis es antwortet (beim ersten Mal einige Sekunden) */
export function ensureLt(force = false): Promise<boolean> {
  if (force) ltFailedAt = 0;
  if (!ltReady || force) {
    ltReady = (async () => {
      const { on, dir } = await ltSettings();
      if (!on) return false;
      if (await ping()) return true;
      if (inTauri) {
        if (!dir) throw new Error("Kein LanguageTool-Ordner gewählt (System → Grammatik).");
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("lt_start", { dir });
      }
      const until = Date.now() + 30000; // LanguageTool braucht beim Start einige Sekunden
      while (Date.now() < until) { if (await ping()) return true; await new Promise((r) => setTimeout(r, 750)); }
      throw new Error("LanguageTool antwortet nicht. Ist Java 17 oder neuer installiert?");
    })();
    ltReady.catch(() => { ltReady = null; ltFailedAt = Date.now(); });
  }
  return ltReady;
}
interface LtMatch { offset: number; length: number; message: string; shortMessage?: string; replacements: { value: string }[]; rule: { issueType: string; category?: { id: string } } }
async function ltIssues(text: string): Promise<Issue[]> {
  const body = new URLSearchParams({ language: "de-DE", text });
  const r = await fetch(LT_URL + "/check", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (!r.ok) throw new Error("LanguageTool-Fehler " + r.status);
  const data = (await r.json()) as { matches: LtMatch[] };
  return data.matches
    .map((m): Issue => {
      const word = text.slice(m.offset, m.offset + m.length);
      const spell = m.rule.issueType === "misspelling";
      return {
        start: m.offset, end: m.offset + m.length, text: word,
        kind: spell ? "spell" : m.rule.issueType === "style" ? "hint" : "grammar",
        msg: m.shortMessage || m.message, suggestions: m.replacements.slice(0, 4).map((x) => x.value),
      };
    })
    .filter((i) => !(i.kind === "spell" && isKnown(i.text)));
}

/** Prüft einen Text und liefert alle Auffälligkeiten (sortiert nach Position) */
export async function checkText(text: string): Promise<Issue[]> {
  // Mit LanguageTool, wenn eingerichtet – sonst (oder bei Problemen) Hunspell + eigene Regeln
  try {
    if (Date.now() - ltFailedAt > 120000 && await ensureLt()) {
      await loadOwnWords();
      const res = await ltIssues(text);
      lastEngine = "LanguageTool";
      return res;
    }
  } catch (e) { ltError = String(e).replace(/^Error:\s*/, ""); ltFailedAt = Date.now(); }
  lastEngine = "Hunspell";
  await loadSpell();
  return builtinCheck(text, hs, isKnown);
}

/** Ersetzt eine Stelle im Text */
export const applyFix = (text: string, i: Issue, repl: string) => text.slice(0, i.start) + repl + text.slice(i.end);
