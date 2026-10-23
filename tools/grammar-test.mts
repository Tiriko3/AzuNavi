// Test der eingebauten Prüfung (0.5.1): Regeln und Hunspell. Start: npx tsx tools/grammar-test.mts
import { readFileSync } from "node:fs";
import { builtinCheck, BUILTIN_WORDS, type Issue } from "../src/spell/builtin.ts";
import { extraIssues } from "../src/spell/rules.ts";

const { loadModule } = await import("hunspell-asm");
const f = await loadModule();
const hs = f.create(f.mountBuffer(new Uint8Array(readFileSync("src/assets/dict/de.aff")), "de.aff"), f.mountBuffer(new Uint8Array(readFileSync("src/assets/dict/de.dic")), "de.dic"));
const known = new Set(BUILTIN_WORDS.map((w) => w.toLowerCase()));
const isKnown = (w: string) => known.has(w.toLowerCase());
const run = (t: string) => builtinCheck(t, hs, isKnown);

let ok = 0, bad = 0;
const check = (c: unknown, m: string) => { if (c) ok++; else { bad++; console.log("  ✗ " + m); } };
const find = (t: string, part: string) => run(t).find((i) => i.text.includes(part) || i.msg.includes(part));
/** Findet der Text einen Treffer an dieser Stelle mit diesem Vorschlag? */
function flags(t: string, word: string, sug: string, kind?: Issue["kind"]) {
  const idx = t.indexOf(word);
  const hit = run(t).find((i) => i.start <= idx && i.end >= idx + word.length - 1 && i.suggestions.includes(sug));
  return !!hit && (!kind || hit.kind === kind);
}
const clean = (t: string) => { const r = run(t); if (r.length) console.log("    Fehlalarm in: " + t.slice(0, 70) + " → " + r.map((i) => `„${i.text}“ (${i.msg})`).join("; ")); return r.length === 0; };

console.log("das / dass");
check(flags("Ich sage dir dass ist falsch.", "dass", "das"), "„dass ist“ → „das“");
check(flags("Ich glaube, das er morgen kommt.", "das", "dass"), "„glaube, das er“ → „dass“");
check(flags("Es ist wichtig, das wir das prüfen.", "das", "dass"), "„wichtig, das wir“ → „dass“");
check(flags("Ich weiß das man das so macht.", "das", "dass"), "„weiß das man“ → „dass“ (ohne Komma)");
check(flags("Schade, das es nicht geklappt hat.", "das", "dass"), "Großschreibung am Anfang: „Schade, das es“");
check(clean("Das Auto, das ich gekauft habe, ist rot."), "Relativsatz „das ich gekauft“ bleibt unberührt");
check(clean("Ich weiß, dass er kommt. Das ist gut, dass wir das wissen."), "richtiges „dass“ und „das“");
check(clean("Das ist das Beste, das wir machen können."), "„das Beste, das wir“ (Relativpronomen)");

console.log("seit / seid");
check(flags("Wir arbeiten seid zwei Jahren damit.", "seid", "seit"), "„seid zwei Jahren“");
check(flags("Das läuft seid Wochen stabil.", "seid", "seit"), "„seid Wochen“");
check(flags("Ich bin seid einem Jahr dabei.", "seid", "seit"), "„seid einem Jahr“");
check(clean("Ihr seid zwei Wochen früher da. Ihr seid gut. Seid ihr bereit? Ihr seid Anfang Mai in Köln."), "„ihr seid“ bleibt unberührt");
check(clean("Ich arbeite seit zwei Jahren hier, seit Montag im Team."), "richtiges „seit“");

console.log("Komma");
check(flags("Ich gehe nach Hause weil ich müde bin.", " weil", ", weil"), "fehlendes Komma vor „weil“");
check(flags("Ich prüfe das bevor ich starte.", " bevor", ", bevor"), "vor „bevor“");
check(flags("Wir testen es obwohl es spät ist.", " obwohl", ", obwohl"), "vor „obwohl“");
check(flags("Er weiß dass es funktioniert.", " dass", ", dass"), "vor „dass“");
check(flags("Das ist nicht schnell sondern langsam.", " sondern", ", sondern"), "vor „sondern“");
check(flags("Rufe mich an falls du Hilfe brauchst.", " falls", ", falls"), "vor „falls“");
check(flags("Was ist wenn der Server ausfällt?", " wenn", ", wenn", "hint"), "vor „wenn“ als Hinweis");
check(clean("Ich gehe nach Hause, weil ich müde bin. Nur weil ich es sage, stimmt es nicht."), "richtig gesetzt und „nur weil“");
check(clean("Er blieb, und weil er müde war, ging er früh. Kurz bevor wir starten, prüfe ich es. Gerade weil das so ist, melde ich mich."), "„und weil“, „kurz bevor“, „gerade weil“");
check(clean("Es klappt nur wenn alles stimmt, besonders wenn ihr zusammenarbeitet, selbst wenn es spät ist, es sei denn, wir verschieben."), "„nur wenn“, „besonders wenn“, „selbst wenn“");
check(clean("Das ist nicht nur schnell, sondern auch sicher."), "„nicht nur …, sondern auch“");
check(clean("Dass wir das schaffen, ist klar. Weil es regnet, bleiben wir drinnen. Sodass alle zufrieden sind."), "Satzanfang „Dass“, „Weil“");

console.log("Vergleich und Wortwahl");
check(flags("Der neue Server ist schneller wie der alte.", "wie", "als"), "„schneller wie“ → „als“");
check(flags("Das ist größer als wie gedacht.", "als wie", "als"), "„als wie“");
check(flags("Wegen dem Update bleibt es heute zu.", "dem", "des", "hint"), "„wegen dem“");
check(clean("So schnell wie möglich. Es ist nicht mehr wie früher. Genauso gut wie vorher. Ich weiß, wie das geht."), "„so schnell wie“, „nicht mehr wie früher“");

console.log("Schreibweise und Typografie");
check(flags("Die Server's laufen stabil.", "'s", "s", "hint"), "Apostroph beim Plural");
check(clean("Wie geht's? Das ist's. Es gibt's. Hol dir’s."), "„geht’s“ (klein) bleibt unberührt");
check(flags("Linux - ein Betriebssystem für Server.", " - ", " – ", "hint"), "Gedankenstrich");
check(clean("- erster Punkt\n- zweiter Punkt\nNetzwerk-Switch und E-Mail."), "Aufzählung und Bindestrich in Wörtern");
check(flags('Er sagte "Hallo" zu mir.', '"Hallo"', "„Hallo“", "hint"), "Anführungszeichen");
check(clean('Der Befehl "ping=1" und "C:\\Temp" und "a/b".'), "Anführungszeichen um Code bleiben unberührt");
check(flags("Ich habe 16GB Arbeitsspeicher.", "16GB", "16 GB", "hint"), "Zahl und Einheit");
check(clean("Ich habe 16 GB Arbeitsspeicher und 2,5 GHz, v1.2.3, Port 8080, 192.168.0.1/24."), "Zahlen mit Einheit und Adressen");
check(flags("Das geht z.B. so.", "z.B.", "z. B.", "hint"), "z.B. → z. B.");
check(flags("Wir klären das d.h. morgen.", "d.h.", "d. h.", "hint"), "d.h. → d. h.");
check(flags("Das gilt ggf Rücksprache.", "ggf", "ggf.", "hint"), "ggf → ggf.");
check(flags("Das dauert ca 5 Minuten.", "ca", "ca.", "hint"), "ca → ca.");
check(clean("Das gilt z. B. dort, d. h. oft, ggf. nicht, ca. 5 Minuten, usw. Siehe /etc/hosts."), "richtige Abkürzungen und Pfade");
check(flags("Hallo,, das geht nicht.", ",,", ",", "grammar"), "doppeltes Komma");
check(clean("In C++ gibt es std::vector und IPv6 ::1 und Namespaces a::b."), "„::“ in Code");
check(flags("Das ist ( Beispiel) so.", "( ", "(", "hint"), "Leerzeichen in der Klammer");
check(clean("Das ist (ein Beispiel) und noch (eins)."), "Klammern");

console.log("Hunspell: Rechtschreibung");
check(flags("Ich öffne die datei im Ordner.", "datei", "Datei", "spell") && find("Ich öffne die datei im Ordner.", "datei")?.msg === "Hauptwort großschreiben", "klein geschriebenes Hauptwort → „Datei“");
check(flags("Das ist der Standart.", "Standart", "Standard", "spell"), "„Standart“ → „Standard“");
check(clean("Die Datei liegt auf dem Server."), "richtiges Hauptwort");
check(find("Ich habe gemacht.", "gemacht") === undefined, "kleine Verben bleiben unberührt");

console.log("Korpus: richtige Texte dürfen keine Meldung bekommen");
const CORPUS = [
  "Heute habe ich im Serverraum einen neuen Switch eingebaut und die VLANs konfiguriert. Danach habe ich die Dokumentation im Wiki ergänzt.",
  "Ich habe gelernt, dass ein DHCP-Server Adressen automatisch vergibt, weil die Clients sonst manuell konfiguriert werden müssten.",
  "Wenn der Ping fehlschlägt, prüfe ich zuerst das Kabel und danach die Firewall-Regeln. Falls das nicht hilft, frage ich meinen Ausbilder.",
  "Der Techniker erklärte mir, wie man ein Backup einrichtet. Ich habe es anschließend selbst getestet, obwohl es schon spät war.",
  "Wir haben die Active-Directory-Gruppen angelegt, damit die Berechtigungen sauber getrennt sind. Das war eine interessante Aufgabe.",
  "In der Berufsschule hatten wir Netzwerktechnik, Programmierung und Wirtschaft. Die Klassenarbeit schreiben wir am Montag.",
  "Mein Ziel ist es, die Zertifikate bis Ende des Jahres zu bestehen und dann in die Systemintegration zu wechseln.",
  "Der Drucker im Büro (Raum 2.14) war nicht erreichbar. Ich habe den Treiber neu installiert und die Warteschlange geleert.",
  "Die Firma hat ca. 120 Mitarbeiter, d. h. wir brauchen mindestens 130 Lizenzen, z. B. für Office und Teams.",
  "Ich war nicht nur im Betrieb, sondern auch in der Schule, und beides hat mir gut gefallen.",
  "Das Dokument liegt unter C:\\Users\\Azubi\\Dokumente und im Repository https://git.example.org/azubi/bericht.git.",
  "Danach habe ich das Skript getestet, das die Logs rotiert, und die Ergebnisse im Wochenbericht festgehalten.",
  "Ich möchte lernen, wie man Fehler systematisch eingrenzt. Dazu nutze ich die Logs, den Monitor und die Hilfe der Kollegen.",
  "Es ist wichtig, dass wir Änderungen dokumentieren, weil sonst niemand nachvollziehen kann, was passiert ist.",
  "Nachdem ich die VM gestartet hatte, habe ich Ubuntu installiert. Sobald das fertig war, habe ich die Updates eingespielt.",
];
CORPUS.forEach((t, i) => check(clean(t), `Korpus ${i + 1}`));
check(extraIssues("").length === 0 && run("").length === 0, "leerer Text");

console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
