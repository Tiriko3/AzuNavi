// Eingebaute Grammatik-, Zeichensetzungs- und Schreibregeln für Deutsch (ab 0.5.1). Kein Java, keine Verbindung, läuft überall
// (PC, Web, Handy). Das sind Regeln für die häufigsten Fehler, keine Sprachverarbeitung: Sie vermeiden Fehlalarme lieber, als jeden
// Fehler zu finden. LanguageTool (System → Grammatik) bleibt als genauere Option am PC bestehen.
//
// Jede Regel liefert Issues mit Position, Meldung und Vorschlägen. Pure Funktion ohne Abhängigkeiten, daher einzeln testbar.
export interface RuleIssue { start: number; end: number; text: string; kind: "spell" | "grammar" | "hint"; msg: string; suggestions: string[] }

const L = "A-Za-zÄÖÜäöüß";
const NB = `(?<![${L}])`;   // kein Buchstabe davor (\\b kennt Umlaute nicht)
const NA = `(?![${L}])`;    // kein Buchstabe dahinter
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sameCase = (orig: string, repl: string) => (orig[0] !== orig[0].toLowerCase() ? repl[0].toUpperCase() + repl.slice(1) : repl);

/** Wörter, vor denen KEIN Komma fehlt, wenn sie direkt vor einer Konjunktion stehen („nur weil“, „und dass“, „kurz bevor“ …) */
const NO_COMMA_BEFORE = new Set(("und oder sowie bzw beziehungsweise nur auch gerade erst kurz lange schon noch besonders vor allem zumal selbst sogar insbesondere " +
  "bloß eben ausgerechnet genau vielleicht sowohl als so ohne statt anstatt außer auf bis von mit für bei nach zu um wie ob sondern aber denn doch jedoch zudem " +
  "nicht weder noch ja nein also dann wenn dass da wo gleich unmittelbar direkt einfach allein bereits kaum fast etwa ungefähr nämlich zwar sei denn dafür darum deshalb deswegen weshalb").split(" "));

const SURE_CONJ = ["dass", "weil", "obwohl", "obgleich", "sodass", "falls", "nachdem", "bevor", "sobald", "solange", "indem", "wohingegen"];

/** Wörter, nach denen „das“ eigentlich „dass“ heißen müsste (Denk-, Sag-, Wahrnehmungsverben und Wertungen), wenn ein Satzglied folgt */
const THINK = "sagen|sagt|sagte|meine|meint|meinte|glaube|glaubt|glaubte|denke|denkt|dachte|hoffe|hofft|hoffte|weiß|wusste|wissen|sehe|sieht|sah|sehen|merke|merkt|merkte|" +
  "bemerke|bemerkt|bemerkte|feststellen|stelle fest|stellt fest|stellte fest|zeigt|zeigte|zeigen|bedeutet|bedeuten|erkläre|erklärt|erklärte|erkennen|erkannte|empfehle|empfiehlt|" +
  "sicher|klar|wichtig|schade|gut|bekannt|logisch|möglich|dafür|davon|darauf|dazu|sodass|aufgefallen|bewusst|egal|schön|toll|nett|gesehen|gehört|gelesen|gemerkt|gewusst|" +
  "vergessen|beachten|beachte|achte|sorge dafür|sorgt dafür|so";

const ABBR = ["z.B.", "d.h.", "u.a.", "i.d.R.", "u.U.", "z.T.", "o.ä.", "s.o.", "s.u.", "v.a.", "u.v.m.", "z.Z.", "i.A.", "z.H.", "u.ä."];
const NEED_DOT = ["ggf", "usw", "bzw", "evtl", "inkl", "vgl", "etc", "zzgl", "bspw", "ca"];

export function extraIssues(text: string): RuleIssue[] {
  const out: RuleIssue[] = [];
  const add = (start: number, end: number, kind: RuleIssue["kind"], msg: string, suggestions: string[]) =>
    out.push({ start, end, text: text.slice(start, end), kind, msg, suggestions });
  const each = (re: RegExp, f: (m: RegExpExecArray) => void) => { re.lastIndex = 0; let m: RegExpExecArray | null; while ((m = re.exec(text))) { f(m); if (m[0].length === 0) re.lastIndex++; } };
  const prevCh = (i: number) => (i > 0 ? text[i - 1] : "");

  /* ---- das / dass ---- */
  // „dass“ direkt vor dem Verb: Hier steht das Demonstrativpronomen „das“ („Ich sage dir, dass ist falsch“)
  each(new RegExp(`${NB}(dass)\\s+(ist|war|sind|waren|wird|wurde|hat|hatte|kann|konnte|muss|soll|darf|bedeutet|funktioniert|geht|gibt|heißt|stimmt|klappt)${NA}`, "gi"),
    (m) => add(m.index, m.index + m[1].length, "grammar", "„das“ statt „dass“: Das Verb folgt direkt, also ist es das Pronomen", [sameCase(m[1], "das")]));
  // „das“ nach Denk-/Sagverb mit folgendem Satzglied: eigentlich „dass“ („Ich glaube, das er kommt“)
  each(new RegExp(`${NB}(${THINK})(\\s*,?\\s+)(das)(\\s+)(ich|er|wir|man|du|es|ihr|sie|der|die|dieser|diese|ein|eine|kein|keine|alle|viele|nichts|jemand|niemand|unser|unsere|mein|meine|sein|seine)${NA}`, "gi"),
    (m) => { const s = m.index + m[1].length + m[2].length; add(s, s + 3, "grammar", "Nach „" + m[1] + "“ meist „dass“ (Konjunktion)", [sameCase(m[3], "dass")]); });

  /* ---- seit / seid ---- */
  // nur eindeutige Zeitangaben (Dativ): „seid Jahren“, „seid zwei Jahren“, „seid einem Jahr“. „Ihr seid zwei Wochen weg“ bleibt unberührt (Akkusativ).
  const seitMsg = "Zeitangabe: „seit“ (mit t), „seid“ ist die Form von „ihr seid“";
  each(new RegExp(`${NB}(seid)\\s+(?:Jahren|Monaten|Wochen|Tagen|Stunden|Minuten|langem|kurzem)${NA}`, "gi"), (m) => add(m.index, m.index + 4, "grammar", seitMsg, [sameCase(m[1], "seit")]));
  each(new RegExp(`${NB}(seid)\\s+(?:(?:\\d+|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf|vielen|einigen|mehreren)\\s+(?:Jahren|Monaten|Tagen)|einem\\s+(?:Jahr|Monat|Tag)|einer\\s+(?:Woche|Stunde|Minute))${NA}`, "gi"),
    (m) => add(m.index, m.index + 4, "grammar", seitMsg, [sameCase(m[1], "seit")]));

  /* ---- Vergleich: „größer wie“ ---- */
  each(new RegExp(`${NB}(größer|kleiner|besser|schlechter|höher|niedriger|schneller|langsamer|älter|jünger|länger|kürzer|stärker|schwächer|leichter|schwerer|billiger|teurer)\\s+(wie)${NA}`, "gi"),
    (m) => { const s = m.index + m[0].length - 3; add(s, s + 3, "grammar", "Nach einem Komparativ steht „als“, nicht „wie“", ["als"]); });
  each(new RegExp(`${NB}(als)\\s+(wie)${NA}`, "gi"), (m) => add(m.index, m.index + m[0].length, "grammar", "„als wie“: nur eins von beiden", ["als", "wie"]));

  /* ---- wegen dem ---- */
  each(new RegExp(`${NB}(wegen)\\s+(dem)${NA}`, "gi"), (m) => { const s = m.index + m[0].length - 3; add(s, s + 3, "hint", "„wegen“ verlangt (schriftlich) den Genitiv", ["des"]); });

  /* ---- fehlendes Komma vor Konjunktionen ---- */
  const commaRule = (conj: string, kind: RuleIssue["kind"], msg: string) =>
    each(new RegExp(`([${L}]+)([ \\t]+)(${conj})${NA}`, "g"), (m) => {
      const prev = m[1].toLowerCase();
      if (NO_COMMA_BEFORE.has(prev)) return;
      // „dass ist …“: dort steht das Pronomen „das“, ein Komma davor wäre der falsche Rat (die Regel oben meldet das schon)
      if (conj === "dass" && new RegExp(`^\\s+(ist|war|sind|waren|wird|wurde|hat|hatte|kann|konnte|muss|soll|darf|bedeutet|funktioniert|geht|gibt|heißt|stimmt|klappt)${NA}`).test(text.slice(m.index + m[0].length))) return;
      const s = m.index + m[1].length;
      add(s, m.index + m[0].length, kind, msg, [", " + m[3]]);
    });
  for (const c of SURE_CONJ) commaRule(c, "grammar", "Vor „" + c + "“ fehlt ein Komma");
  commaRule("wenn", "hint", "Vor „wenn“ fehlt oft ein Komma (Nebensatz)");
  commaRule("sondern", "grammar", "Vor „sondern“ steht ein Komma");

  /* ---- Schreibweise und Typografie ---- */
  each(new RegExp(`(?<![${L}])([A-ZÄÖÜ][A-Za-zÄÖÜäöüß]{1,})(['’])s${NA}`, "g"), (m) => {
    const s = m.index + m[1].length; add(s, s + 2, "hint", "Kein Apostroph vor dem „s“ (Plural oder Genitiv)", ["s"]);
  });
  each(new RegExp(`(?<=[${L}\\d.,)])[ ]-[ ](?=[${L}\\d(„"])`, "g"), (m) => add(m.index, m.index + 3, "hint", "Gedankenstrich: „ – “ (lang) statt Bindestrich", [" – "]));
  each(/"([^"\n]{1,150})"/g, (m) => { if (/[=\\{};<>/]/.test(m[1])) return; add(m.index, m.index + m[0].length, "hint", "Deutsche Anführungszeichen: „…“", ["„" + m[1] + "“"]); });
  each(new RegExp(`(?<![${L}\\d.,])(\\d+(?:[.,]\\d+)?)(GB|MB|KB|TB|kB|GHz|MHz|Mbit/s|Gbit/s|Mbit|Gbit|kg|km|cm|mm|ms|€)(?![${L}])`, "g"),
    (m) => add(m.index, m.index + m[0].length, "hint", "Leerzeichen zwischen Zahl und Einheit", [m[1] + " " + m[2]]));
  each(new RegExp(`(?<![${L}])(?:${ABBR.map(esc).join("|")})(?![${L}])`, "gi"),
    (m) => add(m.index, m.index + m[0].length, "hint", "Abkürzung mit Leerzeichen: „" + m[0].replace(/\.(?=[A-Za-zÄÖÜäöü])/g, ". ") + "“", [m[0].replace(/\.(?=[A-Za-zÄÖÜäöü])/g, ". ")]));
  each(new RegExp(`(?<![${L}])(${NEED_DOT.join("|")})(?![${L}.])`, "g"), (m) => {
    const p = prevCh(m.index), n = text[m.index + m[0].length] ?? "";
    if (/[/\\._@:\-\d]/.test(p) || /[/\\_\-@:]/.test(n)) return;   // Teil eines Pfads, einer Adresse oder eines Namens
    add(m.index, m.index + m[0].length, "hint", "Abkürzungspunkt fehlt", [m[0] + "."]);
  });
  each(/([,;])\1+/g, (m) => add(m.index, m.index + m[0].length, "grammar", "Doppeltes Satzzeichen", [m[1]]));
  each(/(!{2,}|\?{2,})/g, (m) => add(m.index, m.index + m[0].length, "hint", "Mehrfaches Satzzeichen", [m[1][0]]));
  each(/\([ \t]+/g, (m) => add(m.index, m.index + m[0].length, "hint", "Kein Leerzeichen nach der öffnenden Klammer", ["("]));
  each(/(?<=\S)[ \t]+\)/g, (m) => add(m.index, m.index + m[0].length, "hint", "Kein Leerzeichen vor der schließenden Klammer", [")"]));
  return out;
}
