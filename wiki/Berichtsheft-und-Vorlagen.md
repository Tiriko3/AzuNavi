# Berichtsheft und Vorlagen

Die App sammelt deine Notizen einer Woche und schreibt daraus den Wochenbericht in die Vorlage, die du brauchst.

## Eingebaute Vorlagen

Unter *System → Vorlage → Ansehen / ändern* (am Handy: *Mehr → Berichtsheft-Vorlage*) kannst du wählen:

| Vorlage | Für wen | Export |
|---|---|---|
| **IHK-Tageskarten** (Standard) | IHK-Berufe, auch Mediengestaltung. Eine Karte pro Tag, Qualifikationen zum Wählen. | Word |
| **Tagesnachweis mit Stunden** | Betriebe, die Tage mit Stundenspalte wollen. Die Stunden trägst du selbst ein. | Word |
| **Wochenbericht öffentlicher Dienst** | PDF-Formular der HHU. Die Felder werden direkt ausgefüllt, danach kannst du im PDF weiterschreiben und unterschreiben. | PDF |

Die Nummer des Berichts (*Nr*) im PDF trägst du selbst ein.

## Eigene Vorlage

Du kannst auch eine eigene **Word-Datei (.docx)** hochladen. Die App erkennt Tageskarten, Platzhalter-Vorlagen (`{{NAME}}`, `{{MONTAG}}`, `{{VON}}`, `{{BIS}}` …) oder macht aus einem ausgefüllten alten Bericht eine leere Kopie. Ein PDF-Formular als eigene Vorlage geht nicht. Dafür gibt es die eingebaute PDF-Vorlage.

## Alte Berichte importieren

*Notizen → Importieren* liest alte Berichtshefte als **Word oder PDF** und macht daraus Notizen.

- **PDF-Formulare (HHU-Wochenbericht, Fachbericht):** Die Einträge stehen in Formularfeldern. Die App liest diese Felder. Berufsschule wird als Schule erkannt.
- **Tagesnachweis aus LaTeX:** Der Text eines Tages wird satzweise in Notizen zerlegt. Umlaute und Silbentrennung werden repariert, **das ist eine Heuristik und nicht perfekt**. Die Stunden werden nicht übernommen.
- Schau dir die importierten Notizen danach kurz an.

Der Import schreibt nur in deine eigene App. Es wird nichts hochgeladen.
