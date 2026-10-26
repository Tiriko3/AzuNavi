# Änderungen

## 0.9.2 – Firefox, PDF-Import, drei Vorlagen
- **Firefox:** Die Web-App hing nach „Nur in diesem Browser speichern“, weil sie auf die Antwort von `navigator.storage.persist()` wartete. Firefox fragt dabei den Nutzer, die Antwort kann ausbleiben. Der Aufruf wird nicht mehr abgewartet. In einem echten Firefox 158 (Linux, ohne Fenster) getestet: Start, alle Hauptseiten, Export.
- **Dateien-Seite ohne Ordner-Zugriff (Firefox, Safari):** Statt PC-Ordnern legt die App einen eigenen Ordner „Arbeit“ und „Schule“ im Browser-Speicher (OPFS) an. Dateien und Ordner ziehen oder auswählen (werden kopiert), Eda sortiert wie gewohnt. „Alles als ZIP laden“ nimmt den Ordner mit. Die Daten liegen nur in diesem Browser.
- **PDF-Import:** Formularfelder werden gelesen (HHU-Wochenbericht und Fachbericht). Bisher kam bei diesen PDFs nichts an, weil die Einträge nicht im sichtbaren Text stehen. Berufsschule wird als Schule erkannt, „Urlaub“, „Sommerferien“ und „/“ werden nicht als Tätigkeit gezählt.
- **PDF-Import, LaTeX-Tagesnachweis mit Stundenspalte:** Wochen werden erkannt, ein Tag wird satzweise in Notizen zerlegt, Umlaute (`t¨aglich`), Silbentrennung und die Stundenzahlen werden bereinigt. Das ist eine Heuristik.
- **Drei eingebaute Vorlagen zur Auswahl** (System → Vorlage, am Handy Mehr → Berichtsheft-Vorlage, im Tutorial): IHK-Tageskarten (Standard, auch für Mediengestaltung), Tagesnachweis mit Stunden (Word, Stunden zum Ausfüllen), Wochenbericht öffentlicher Dienst (PDF-Formular, wird direkt ausgefüllt). Neue Platzhalter `{{VON}}`, `{{BIS}}`, `{{MONTAG_STUNDEN}}` …
- Der Export-Knopf heißt jetzt „Exportieren“ (Word oder PDF je nach Vorlage). Neu: `pdf-lib` (läuft offline, wird nur beim PDF-Export geladen).
- Tests: `tools/import-test.mts` (27 Prüfungen, nur erfundene Daten) und 7 neue Prüfungen für den Browser-Ordner in `tools/webfiles-test.mts` (jetzt 32).
- Wiki-Seiten für GitLab liegen im Ordner `wiki/`.

## 0.9.1 – Das große Wort im Menü ist nicht mehr abgeschnitten
- **Fehler behoben:** Das große senkrechte Wort links im Hauptmenü (PROJEKTE, BERICHTSHEFT, DATEIEN …) ragte über den linken Bildrand hinaus, etwa ein Viertel der Buchstabenhöhe fehlte. Es steht jetzt etwa 55 Pixel (Stage-Pixel, bei 1600 Breite) weiter rechts, die Buchstaben beginnen mit rund 15 Pixel Rand.
- Gemessen wurde das für alle sechs Wörter ohne Figur davor: Die linke Kante der Buchstaben liegt 7,5 Pixel rechts von der Position des Elements. Ein Browser-Test sichert das ab.


## 0.9.0 – Neuer Leo
- **Leo ist komplett neu gestaltet** (in Canva erzeugt): ein junger Mann mit sandblonden, zurückgekämmten Haaren, grün-grauen Augen, weißem Hemd mit hochgekrempelten Ärmeln, marineblauer Weste, lockerer cyanblauer Krawatte, Azubi-Karte am Band und Kopfhörern um den Hals. Er ersetzt den alten Leo (silbergraue Haare, Strickjacke), dessen Kopf in den Original-Dateien oben abgeschnitten war.
- Sechs Posen, eine pro Menüpunkt: schreibt (Notizen), winkt (Kontakte), liest ein Blatt (Berichtsheft), zeigt nach oben rechts (Projekte), trägt eine Kiste mit Ordnern (Dateien), tippt auf dem Tablet (System). Der Kopf ist überall vollständig.
- Freigestellt und mit Real-ESRGAN auf 2160 Pixel Höhe (4K) hochskaliert (`tools/make-leo.py`). Die Datei-Namen bleiben (`figuren/chars/leo/<menüpunkt>.webp`), die Auswahl in Tutorial und System zeigt automatisch den neuen Leo.
- Wer Leo schon gewählt hatte, behält ihn, mit neuem Aussehen.


## 0.8.2 – Leos Scheitel richtig gerundet
- **Fehler aus 0.8.1 behoben:** Die in 0.8.1 nachgezeichneten Scheitel (Leo, teils Kai, Mira, Nova, Ruby) sahen in der Vergrößerung wie eine flache graue Scheibe aus, die auf dem Kopf sitzt. Ursache: Die Kuppe war zu hoch und setzte mit senkrechten Seiten an. Jetzt wird die Rundung aus der echten Kontur berechnet (ein Kreis durch die Breite am Schnitt und etwas weiter unten) und setzt die Kopfform glatt fort, ohne Absatz und ohne eigenen Rand. Die Haarstruktur kommt gespiegelt aus den Zeilen darunter. Die Ergänzung ist 4 bis 39 Pixel hoch (bei 2160 Pixel Bildhöhe), je nachdem, wie viel in der Quelldatei fehlte. 12 Bilder (`tools/fix-heads.py`).
- Sonst unverändert gegenüber 0.8.1.

## 0.8.1 – Feinschliff nach dem Test
- **Tutorial, Dateien-Schritt:** Wenn der „Ordner einrichten“-Dialog nicht offen war, zeigte der Pfeil nach oben links (auf einen gesperrten Bereich) und nichts war anklickbar. Jetzt ist auch der Knopf „Einrichten“ erlaubt und das Ziel des Pfeils, und der Text sagt, was zu tun ist (in der Mitte „Hauptordner wählen“, sonst zuerst „Einrichten“).
- **Eda** stellt sich vor als „dein **E**lektronischer **D**atei-**A**ssistent“ (Tutorial und Menü-Beschreibung).
- **Nacht-Zeiten frei wählbar:** System → Nacht-Hintergrund → „Nach Uhrzeit“ → von … bis … (geht über Mitternacht, gleiche Zeiten = nie). Wer 00:00 bis 23:59 einstellt, hat den Mond fast immer; „Immer“ und „Nie“ bleiben.
- **Figuren größer:** Alle Hauptfiguren außer dem „Original“ stehen jetzt größer (840 statt 700 Pixel Höhe) und etwas weiter rechts, damit sie im Menü nicht mehr verloren wirken. Die Bilder sind weiter 4K.
- **Leos Kopf:** Bei Leo (und bei einigen Posen von Kai, Mira, Nova, Ruby) war der Scheitel oben am Bildrand abgeschnitten. Das war schon in den ursprünglichen Dateien so. Die fehlende Rundung wird jetzt aus der Kopfform nachgezeichnet (`tools/fix-heads.py`), 12 Bilder. Caramella und Eda bleiben unverändert.
- **Aufgeräumt:** README (Mizu, Grammatikprüfung ohne Java), `docs/ENTWICKLUNG.md` komplett neu, `Cargo.lock` auf der richtigen Version, der Release-Text nennt jetzt Windows und die Übernahme der alten Daten am Handy.
- Neu: `tools/night-test.mts`, Browser-Tests für den Tutorial-Schritt und die Nacht-Zeiten.


## 0.8.0 – Wasser-Übergang beim Seitenwechsel, Lichtnetz bei Nacht
- **Wasser-Übergang:** Beim Öffnen und Schließen einer Seite läuft jetzt der Wasser-Burst aus deinem neuen Video: eine Splash-Krone, Wellenringe und ein großer Burst, der den Bildschirm füllt und wieder freigibt. Genau wenn er alles bedeckt, wechselt die Seite darunter. Das Video ist Bild für Bild mit Real-ESRGAN auf 2560×1440 hochskaliert (etwa 1,2 Sekunden, etwas schneller abgespielt als im Original). Bei „Animationen aus“ (oder wenn das Abspielen nicht klappt) läuft der alte Übergang mit den drei Balken.
- **Lichtnetz bei Nacht:** Im Nacht-Hintergrund liegt unter dem Mond das dunkle Lichtnetz aus dem Video (schimmernde Wasseroberfläche mit rosa Funken, nahtlose Schleife).
- Nicht eingebaut (liegt im Video bereit): die Blasen, die Welle und die Splash-Krone allein.
- Neu: `tools/make-design-assets.py splash`, Browser-Test, dass der Übergang beim Seitenwechsel läuft.


## 0.7.2 – Das Wasser läuft jetzt immer, und in 4K
- **Fehler behoben: Das Wasser im Menü stand still.** Auf Rechnern, bei denen Windows die Animationseffekte abgeschaltet hat (zum Beispiel virtuelle Maschinen), meldet das Programm „reduzierte Bewegung“. Das hat 0.7.0 und 0.7.1 beachtet und deshalb nur das Standbild gezeigt, auch beim Startbildschirm und beim Intro. Jetzt zählt nur noch der Schalter **System → Animationen**.
- **Neu: System → „Windows-Einstellung ‚Animationen reduzieren‘ beachten“** (Standard: aus). Wer die Windows-Einstellung als Vorgabe haben will, schaltet sie ein.
- **Wächter:** Bleibt ein Video von allein stehen (zum Beispiel, weil das Springen an den Anfang scheitert), startet das Programm es neu. Bei unsichtbarem Fenster pausiert es, danach läuft es weiter.
- **Wasser-Video hochskaliert:** Jedes der 96 Bilder wurde mit Real-ESRGAN auf 2240×2168 hochgerechnet (vorher 560×720). Das Video ist etwa 700 KB groß. Das Original-Video selbst ist weich gezeichnet, das bleibt so.
- Neu: Browser-Tests, dass das Wasser sich wirklich bewegt (Zeitstempel ändert sich), mit und ohne Windows-Einstellung.


## 0.7.1 – Bilder für leere Seiten
- **Leere Seiten sind nicht mehr nur Text:** Auf „Noch keine Notizen“, „Noch keine Kontakte“ und „Noch keine Projekte“ steht jetzt ein Bild (Kiste mit Blasen bzw. Zettel mit Pin, 4K hochskaliert) und Mizu in der passenden Pose (schreibt, winkt, zeigt auf den Zettel). Bei „Maskottchen aus“ entfällt Mizu.
- **Fehler behoben:** Auf der Projekte-Seite sahen neue Nutzer in der Standardansicht „Netzplan“ nur ein leeres dunkles Feld, weil die Hinweis-Karte nur an der (ausgeblendeten) Pinnwand hing. Jetzt steht sie auch im Netzplan, mit dem Knopf „Erstes Projekt anlegen“.
- Neu: `tools/make-design-assets.py ui` erzeugt die Bilder; Browser-Test für die leeren Seiten.


## 0.7.0 – Alles in 4K, Wasser, Nacht-Hintergrund, Mizu, Tutorial
- **Die gezeichneten Wasserflecken und die fliegenden Teilchen im Menü sind komplett entfernt.** Stattdessen läuft rechts im Menü bewegtes Wasser mit aufsteigenden Blasen (nur der Wasserteil des Gemini-Videos, ohne Figur; nahtlose Schleife, etwa 160 KB). Bei „Animationen aus“ steht ein Standbild.
- **Mizu ersetzt Nami** (Name in `src/mascot.ts`). Der Wassergeist ist nur der Begleiter (Tutorial, Hilfe, Notizen-Animation, Startbildschirm, Handy). **Die Hauptfigur bleibt frei wählbar** (Original, Kai, Leo, Mira, Nova, Ruby, im Tutorial und unter System → Figur). Wer mit 0.6.0 versehentlich den Wassergeist als Hauptfigur hatte, bekommt seine vorherige Auswahl zurück.
- **Alles in 4K:** Die sieben Hintergründe (sechs Seiten, Nacht) sind jetzt 3840×2160, alle Figuren (Mizu, Kai, Leo, Mira, Nova, Ruby, Caramella, Eda) 2160 Pixel hoch. Hochskaliert mit Real-ESRGAN (Anime-Modell, `tools/sr.py`) statt einfach vergrößert: scharfe Linien statt weicher Ränder. Das „Original“ war schon groß genug.
- **Nacht-Hintergrund:** Von 21 bis 6 Uhr (echte Uhrzeit) liegt statt des Wassers das Mond-Bild hinter Menü und Seiten; das Menürad liegt in der dunklen Mondscheibe. System → Nacht-Hintergrund: Automatisch, Immer oder Nie. Der Wechsel passiert von allein (jede Minute geprüft).
- **Tutorial:** Der Figur-Schritt erklärt den Unterschied zwischen Hauptfigur und Begleiter. Der Start-Text nennt Datenordner und Passwortschutz. Der Abschluss zeigt, was neu ist (Text prüfen, Passwortschutz, Nacht-Hintergrund). Der System-Schritt der Tour kennt Passwortschutz, Datenordner, Freigaben und die Sicherung zwischen PC und Handy.
- Entfernt: die Seiten-Blasen und das Lichtnetz-Video aus 0.6.0 (das Wasser-Video ersetzt sie).
- Programmgröße: etwa 12 MB mehr durch die 4K-Figuren.
- Neu: `tools/make-design-assets.py` und `tools/sr.py` erzeugen alle Design-Dateien reproduzierbar. Browser-Tests für Wasser, Nacht (mit festgelegter Uhrzeit) und Tutorial.

## 0.6.0 – Neues Design: Wassergeist, Hintergründe, Flüssigkeit
- **Neue Hauptfigur: der Wassergeist.** Ein Kind aus Wasser mit Tropfen-Kopf und dunkelblauem Hoodie, im Stil der Persona-Menüs. Er ersetzt Nami: im Hauptmenü (je Menüpunkt eine eigene Pose: schreibt, winkt, liest, zeigt, trägt den Ordner, gibt einen Tipp), im Tutorial, in der Hilfe, am Handy und im Startbildschirm. Mit 0.6.0 wird die neue Figur **einmalig** gewählt. Wer seine alte Figur zurück will: System → Figur. Die anderen Figuren (Original, Kai, Leo, Mira, Nova, Ruby) bleiben wählbar.
- **Name an einer Stelle:** Der Begleiter heißt vorläufig **Awa**. Der Name steht nur in `src/mascot.ts` (`MASCOT_NAME`) und gilt dann überall.
- **Hintergründe:** Das Hauptmenü und jede Seite haben ein eigenes Bild in eigener Farbe (Notizen hellblau, Kontakte violett mit Personen-Netz, Berichtsheft marineblau mit Papieren und Kalender, Projekte Pinnwand mit roten Pins, Dateien petrol mit Ordnern, System Platine mit Zahnrädern).
- **Flüssigkeit:** Statt der gezeichneten Wasserflecken liegt im Menü ein bewegtes Lichtnetz (Wasseroberfläche von unten), auf den Seiten steigen Blasen auf. Beides sind kleine Videos auf Schwarz, die mit „aufhellen“ darübergelegt werden (zusammen etwa 540 KB), mit nahtloser Schleife. Bei „Animationen aus“, „reduzierter Bewegung“ oder unsichtbarem Fenster stehen oder pausieren sie.
- Die Dateien wurden aus Gemini-Bildern und -Videos erzeugt (`tools/make-design-assets.py`: Freistellen, Zuschneiden, Verkleinern). Sie sind für die private Nutzung gedacht.
- Neu: Browser-Test des Designs (`tools/desktop-e2e.mts`, Abschnitt N).

## 0.5.1 – Grammatikprüfung ohne Java (überall)
- **Eingebaute Prüfung:** „Text prüfen“ kennt jetzt viele typische Fehler, ohne Java und ohne Internet, am PC, in der Web-App und am Handy. Vorher gab es das nur am PC mit LanguageTool; am Handy gab es gar keine Prüfung, jetzt steht sie bei jeder Notiz.
- **Was sie findet:**
  - **Rechtschreibung** wie bisher (Hunspell), dazu die klare Meldung „Hauptwort großschreiben“ bei „datei“ statt „Datei“.
  - **das / dass:** „dass ist …“ (gemeint ist „das“) und „Ich glaube, das er kommt“ (gemeint ist „dass“).
  - **Komma:** vor „dass, weil, obwohl, sodass, falls, nachdem, bevor, sobald, solange, indem, sondern“ und als Hinweis vor „wenn“. Typische Ausnahmen („nur weil“, „kurz bevor“, „und dass“, „nicht nur …, sondern auch“) werden nicht beanstandet.
  - **seit / seid:** „seid zwei Jahren“; **Vergleich:** „schneller wie“ → „als“, „als wie“; „wegen dem“.
  - **Schreibweise:** Apostroph vor dem Plural-s („Server's“), „z.B.“ → „z. B.“, fehlende Abkürzungspunkte (ggf, usw, bzw, ca …), Zahl und Einheit („16GB“), Gedankenstrich, deutsche Anführungszeichen, doppelte Satzzeichen, Leerzeichen in Klammern.
- **Weniger Fehlalarme:** Die alte Warnung „Nach Komma oft ‚dass‘“ ist entfernt (sie schlug bei jedem richtigen Relativsatz an). „die die“, „das das“ als doppeltes Wort, Ergänzungsstriche („Vor- und -größen“), Abkürzungen vor kleinem Wort („d. h. oft“, „ca. 5“), Adressen und Pfade, Code mit „::“ werden nicht mehr beanstandet. Weitere Fachwörter (Logs, Namespaces, …) und Abkürzungen sind im Wörterbuch.
- **Ehrlich:** Das sind Regeln für die häufigsten Fehler, keine vollständige Grammatik (zum Beispiel keine Prüfung von Artikel und Endungen). **LanguageTool bleibt als genauere Option am PC** (System → Rechtschreibung & Grammatik), jetzt als „zusätzlich“.
- Neu: `tools/grammar-test.mts` (66 Prüfungen mit echtem Wörterbuch und einem Korpus richtiger Texte, in dem nichts gemeldet werden darf), Browser-Test am Handy (Abschnitt M in `tools/desktop-e2e.mts`).

## 0.5.0 – Handy-App mit Datenordner-Format und Passwortschutz
- **Gleiche Datenschicht wie PC und Web:** Die Android-App speichert jetzt wie das PC-Programm und die Web-App in `azunavi.db` und `dateien/` (im geschützten App-Speicher unter `azunavi/`), mit derselben Verschlüsselung. Es gibt keinen Ordner zu wählen: Das Handy hat genau einen Speicher.
- **Passwortschutz am Handy:** Dieselben Profile wie am PC und im Browser (Passwort, Wiederherstellungsschlüssel, automatische Sperre, „Angemeldet bleiben“). Mehr → Passwortschutz.
- **Alte Daten übernehmen:** Beim ersten Start nach dem Update bietet die Handy-App an, die alten Daten zu übernehmen (Notizen, Kontakte, Projekte, Anhänge, Porträts, Vorlage).
  - **Vorher** speicherst du eine Sicherung über den Android-Speicherdialog (z. B. in OneDrive). Sie hat dasselbe Format wie „Daten mitnehmen“ und lässt sich mit „Sicherung einspielen“ wieder laden. **Ohne gespeicherte Sicherung wird nichts übernommen.**
  - Danach werden alle Zeilen nach dem Kopieren zur Probe mit dem Original verglichen, jede Datei wird zurückgelesen, und die Datenbank wird als **letzter** Schritt geschrieben. Bricht etwas ab, bleibt der Speicher leer und es geht von vorn.
  - Die alte Datenbank und die alten Dateien bleiben unverändert liegen und werden nie gelöscht.
- **Austausch Handy ↔ PC:** weiterhin über die Sicherungsdatei (Mehr → Sicherung erstellen / einspielen oder Cloud-Sicherung). Android kann Ordner in OneDrive nicht verlässlich öffnen, deshalb gibt es am Handy keinen gemeinsamen Live-Ordner.
- **Kleinere Rechte:** Die alte Datenbank darf am Handy nur noch gelesen werden (nur zur einmaligen Übernahme), nicht mehr beschrieben. Das SQL-Plugin wird sonst nirgends mehr benutzt.
- Bilder aus der Galerie landen im Datenordner (verschlüsselt, wenn das Profil ein Passwort hat).
- Neu: Browser-Durchläufe als Handy (`tools/desktop-e2e.mts`, Abschnitte J bis L), Test der Sicherung der alten Daten (`tools/desktop-test.mts`).

## 0.4.3 – Freigaben ansehen und entziehen, kleinere Rechte am PC
- **System → Freigegebene Ordner (PC):** Eine Übersicht zeigt, auf welche Ordner und Dateien AzuNavi außerhalb des Datenordners zugreifen darf. Jeder Ordner lässt sich mit zwei Klicks wieder entziehen („Entziehen“, dann „Wirklich entziehen?“), die einzelnen verknüpften Dateien und die Rückgängig-Orte mit „Alle entziehen“. Es wird nie etwas gelöscht oder verändert: Die Ordner und Dateien bleiben liegen, du wählst sie bei Bedarf auf der Dateien-Seite neu aus. Der Entzug wirkt sofort.
- **Kleinere Rechte (capabilities) am PC:** Das Fenster darf am PC nur noch die alte `persona.db` lesen und laden (nicht mehr schreiben), im App-Ordner nur lesen (nicht mehr schreiben) und den Öffnen-Dialog benutzen (nicht mehr Speichern, Meldungen, Fragen). Schreiben und Speichern laufen über die geprüften Rust-Befehle (Datenordner, Freigaben).
- **Handy unverändert:** Die Rechte der Android-App stehen jetzt in `capabilities/mobile.json` genau wie vorher (die Datei `default.json` gilt nur noch für Windows, Linux und macOS).
- Neu: Rust-Test fürs Entziehen (`fsguard.rs`), Browser-Test der Übersicht (`tools/desktop-e2e.mts`, Abschnitt I).

## 0.4.2 – Startbildschirm mit Wasser-Animation und Intro
- **Startbildschirm:** Hinter der Startkarte läuft ruhiges Wasser mit Lichtstrahlen und Blasen (kleines WebM ohne Ton, nahtlose Schleife, ca. 215 KB). Es pausiert, wenn das Fenster nicht sichtbar ist.
- **Intro beim Start:** Beim Öffnen von AzuNavi läuft einmal pro Start ein kurzer Übergang (ca. 4 s, Panels und Blasen, ca. 860 KB). Ein Klick oder eine Taste überspringt ihn. Innerhalb derselben Sitzung (z. B. nach „Sperren“ oder Neuladen) kommt er nicht noch einmal.
- **Abschaltbar:** Der Schalter **System → Animationen** schaltet beides aus (dann nur Standbild und kein Intro). Das gilt schon beim nächsten Start, auch vor dem Laden der Datenbank. Wünscht das Betriebssystem „reduzierte Bewegung“, bleibt es ebenfalls beim Standbild.
- Gilt für PC-Programm und Web-App. Die Handy-App ist unverändert.
- Web-App: Der Service Worker legt Videos (Teilantworten) nicht mehr in den Zwischenspeicher, damit es keine Fehlermeldungen gibt.
- Die Videos wurden mit Gemini erzeugt und sind für die private Nutzung gedacht, nicht zum Weitergeben oder Veröffentlichen.
- Tests: `tools/desktop-e2e.mts` prüft jetzt auch, dass das Video wirklich läuft, das Intro erscheint und sich überspringen lässt, nicht doppelt kommt und bei „Animationen aus“ und reduzierter Bewegung entfällt.

## 0.4.1 – Datei-Befehle nur noch an freigegebenen Orten (PC)
- **Sicherer Zugriff auf deine Dateien:** Die Datei-Befehle (Dateien-Seite, Verschieben, Vorschau, Öffnen, Cloud-Sicherung) arbeiten am PC nur noch in Ordnern und an Dateien, die du selbst freigegeben hast. Vorher konnten sie jeden Pfad lesen und schreiben und waren nur durch die Sicherheitsregeln des Fensters geschützt.
- **Wie etwas freigegeben wird:** Du wählst Ordner (Arbeit, Schule, Cloud-Ordner) und Dateien in Dialogen, die das Programm selbst (Rust) öffnet. Gewählte Ordner merkt sich AzuNavi dauerhaft (`freigaben.json`). Mit einem Projekt verknüpfte Dateien ebenfalls. Alles andere, was du auswählst oder aufs Fenster ziehst, gilt nur für diese Sitzung. Das Frontend kann nichts selbst freigeben.
- **Einmalige Rückfrage beim ersten Start:** AzuNavi fragt in einem Windows-Fenster, ob die bisher benutzten Ordner und verknüpften Dateien weiter erlaubt sein sollen (mit Liste der Ordner). Ein Klick auf „Erlauben“, danach läuft alles wie bisher. Bei „Nicht jetzt“ wählst du die Ordner auf der Dateien-Seite einfach neu aus.
- **Geprüft wird der echte Ort:** Verknüpfungen, die aus einem freigegebenen Ordner hinausführen, und `..` im Pfad werden abgelehnt. Ein Ordner „Arbeit2“ ist nicht „Arbeit“.
- **Rückgängig nach einem Neustart:** Der Ordner, aus dem eine Datei verschoben wurde (z. B. Downloads), wird nur als Ziel zum Zurücklegen gemerkt, nie zum Lesen.
- **„Speichern unter“** öffnet und schreibt jetzt Rust selbst.
- Android: unverändert (die Prüfung gibt es nur am PC).
- Noch offen: Rechte in `capabilities` verkleinern (nach der Umstellung von Android).
- Neu: Rust-Tests in `src-tauri/src/fsguard.rs`, `tools/grants-test.mts`.

## 0.4.0 – PC-Programm mit Datenordner und Profilen
- **Gleiche Daten am PC und im Browser:** Das PC-Programm legt seine Daten jetzt wie die Web-App in einem **Datenordner** ab (`azunavi.db`, `dateien/`, `profil.json`). Wählst du am PC und in der Web-App denselben Ordner (z. B. `OneDrive\AzuNavi`), arbeitest du an beiden Orten mit denselben Daten und demselben Profil.
- **Passwortschutz auch am PC:** Dieselben Profile mit Passwort und Wiederherstellungsschlüssel wie in der Web-App (Verschlüsselung der Datenbank und der Anhänge). System → Passwortschutz.
- **Alte Daten übernehmen:** Beim ersten Start bietet AzuNavi an, die alte `persona.db` samt Anhängen, Porträts und Vorlage zu übernehmen. **Vorher** wird eine Sicherung neben die alte Datei gelegt (`Sicherung-vor-0.4.0`, inklusive `persona.db-wal`, jede Kopie Byte für Byte geprüft). Danach wird alles Zeile für Zeile mit dem Original verglichen, die Datenbank wird als **letzter** Schritt geschrieben. Bricht etwas ab, bleibt der Ordner leer und es geht von vorn. Die alte Datenbank bleibt unverändert liegen und wird nie gelöscht.
- **Sicherer Zugriff auf den Datenordner:** Den Ordner wählst du im Dialog, den das Programm selbst öffnet. Rust liest, schreibt und listet nur AzuNavis eigene Dateien im gewählten Ordner (kein `..`, keine Laufwerke, keine Windows-Gerätenamen, keine Verknüpfungen). Geschrieben wird atomar (Zwischendatei, dann umbenennen, mit Wiederholungen, falls OneDrive die Datei kurz festhält). Fremde Dateien im Ordner bleiben unberührt.
- **Beim Beenden wird gespeichert:** Fenster schließen (X, Alt+F4, Beenden-Knopf) speichert zuerst alles und gibt die Sperre frei, damit die Web-App nicht warnt. Schlägt das Speichern fehl, bleibt das Fenster offen (zweites Schließen beendet trotzdem).
- **Fehlender Ordner:** Ist der Datenordner nicht erreichbar (Laufwerk, Cloud), zeigt AzuNavi das in der Liste an, statt einen neuen anzubieten.
- Anhänge und Porträts werden am PC in den Datenordner kopiert (`dateien/attachments`, `dateien/portraits`).
- Android-App unverändert (kommt in einer späteren Version). Die Rust-Befehle für den Datenordner gibt es nur am PC.
- Noch nicht in dieser Version: Die allgemeinen Datei-Befehle der Dateien-Seite (`fs_*`) und die Rechte in `capabilities` werden erst in 0.4.1 bzw. später eingeschränkt.
- Neu: `tools/desktop-test.mts` (Übernahme und Datenspeicher), `tools/desktop-e2e.mts` (Startbildschirm im Browser mit nachgebauter Tauri-Schnittstelle), `tools/legacy-fixture.mts`; Rust-Tests in `src-tauri/src/datadir.rs`.

## 0.3.1 – Dateien-Seite im Browser
- Die **Dateien-Seite** läuft jetzt auch in der Web-App (Chrome, Edge, Opera am PC): Du gibst deine Hauptordner (Arbeit und Schule) einmal frei, danach siehst du den Ordnerbaum, legst Ordner an, sortierst Dateien mit dem Assistenten ein, ordnest Projekte zu und nutzt Vorschau und Verlauf.
- **Ziehen & Ablegen** von Dateien und Ordnern ins Fenster funktioniert auch im Browser.
- Dateien von außerhalb werden **kopiert** (der Browser darf das Original nicht löschen), Verschiebungen innerhalb deiner freigegebenen Ordner sind echte Verschiebungen mit Rückgängig.
- Der Browser vergisst die Erlaubnis beim Schließen: Dann erscheint **„Zugriff erlauben“**, ein Klick genügt. Nicht verfügbar im Browser: „Im Explorer zeigen“, Ordner öffnen, „Datei suchen“ bei verschobenen Dateien.
- Andere Browser und Handys zeigen einen Hinweis statt der Seite.
- Neu: `tools/webfiles-test.mts` (Test der Datei-Logik).

## 0.3.0 – Profile mit Passwort (Web-App)
- **Passwortschutz mit Verschlüsselung** für die Web-App: Datenbank und Anhänge im Datenordner (oder im Browser-Speicher) werden mit AES-256-GCM verschlüsselt. Kein zentrales Konto, kein Server: Wer Ordner **und** Passwort hat, kommt an die Daten.
- Passwort mindestens 12 Zeichen (PBKDF2-SHA256, 600.000 Runden). Der Datenschlüssel liegt zweimal verpackt in `profil.json`: per Passwort und per **Wiederherstellungsschlüssel**, der bei der Einrichtung einmal angezeigt wird. Ohne beides sind die Daten weg (kein Admin-Reset).
- **Bestehende Daten werden automatisch übernommen** (jede Datei wird nach dem Verschlüsseln zur Probe entschlüsselt und verglichen; bei Abbruch macht der nächste Start weiter).
- **Angemeldet bleiben pro Gerät** (nicht exportierbarer Schlüssel im Browser, nie das Passwort), **Jetzt sperren** und **automatische Sperre** nach 5/15/30/60 Minuten.
- **Profilauswahl** für gemeinsam genutzte PCs: mehrere Speicherorte werden gemerkt, beim Start wählst du dein Profil.
- Passwort ändern, Passwort vergessen → Wiederherstellungsschlüssel. Einschalten unter System → Passwortschutz (am Handy: Mehr → Passwortschutz).
- Dateien sind an ihren Pfad gebunden: vertauschte oder manipulierte Dateien werden abgelehnt. Dateinamen und -größen bleiben sichtbar, nur der Inhalt ist verschlüsselt.
- PC-Programm und Android-App sind unverändert (kommen in einer späteren Version).
- Datenschutzseite erklärt den Passwortschutz.
- Neu: `tools/vault-test.mts` (Test der Verschlüsselung).

## 0.1.2 – Windows-Setup auf der Download-Seite
- Neuer Befehl `npm run release:windows`: baut das Windows-Programm, lädt Installer und portable Datei hoch und hängt sie an die Download-Seite der Version. Ohne Windows-Runner nötig, ein Befehl.
- Der Release-Job der Pipeline hängt seine Links an, wenn die Download-Seite schon existiert (Reihenfolge egal).

## 0.1.1 – Eine Adresse für alle Downloads
- Bei jeder neuen Version legt GitLab automatisch eine **Download-Seite (Release)** an, mit der Android-App und dem Link zur Web-App.
- Fester Link auf die jeweils **neueste Version**: `https://git.hhu.de/qov83dor/AzuNavi/-/releases/permalink/latest`
- Die Web-App verlinkt selbst auf diese Seite (Startbildschirm, System, Handy: Mehr).
- Neuer Diagnose-Job `runner-info` in der Pipeline.

## 0.1.0 – Neustart auf dem internen GitLab
Erste Version auf GitLab. Enthält alles aus der Entwicklung bis dahin:
- **Notizen, Berichtsheft (Word-Export mit eigener Vorlage), Projekte mit Netzplan und Pinnwand, Kontakte mit Netzplan**
- **Kontakt-Gruppen**: eine Person in mehreren Gruppen, ganze Gruppen zuweisen, Bereiche und Gruppen am Stück verschieben, Beziehungen (Leitung oder Kontakt)
- **Berufsprofile** mit Qualifikationen nach Ausbildungsordnung (optional)
- **Drei Wege**: Windows-Programm, Android-App (eigene Handy-Oberfläche mit Nami, Caramella und Eda), Web-App im Browser (installierbar, offline, Datenordner z. B. in OneDrive)
- **Sicherung** lokal und verschlüsselt in der eigenen Cloud
- **Sicherheit**: strenge Sicherheitsregeln (CSP), keine Verbindungen ins Internet, Datenschutzseite in der App
- Figuren in 4K-Auflösung

Die Versionsnummern davor (1.x) stammen aus der Entwicklungszeit auf GitHub. Installierte Apps lassen sich ohne Datenverlust auf 0.1.0 aktualisieren.
