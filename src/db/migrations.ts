// Datenbank-Migrationen. Neue Etappen hängen hier einfach eine weitere Version an.
// Eine einmal ausgelieferte Version wird NIE mehr geändert.

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

// IHK-Qualifikationen, übernommen aus deiner Berichtsheft-Vorlage (Word).
// kind: betrieb = betriebliche Qualifikation, schule = schulische, sonst = Auffangoption
export const QUALIS: { name: string; kind: "betrieb" | "schule" | "sonst" }[] = [
  { name: "Administrieren von IT-Systemen", kind: "betrieb" },
  { name: "Betreiben von IT-Systemen", kind: "betrieb" },
  { name: "Programmieren von Softwarelösungen", kind: "betrieb" },
  { name: "Planen, Vorbereiten und Durchführen von Arbeitsaufgaben in Abstimmung mit den kundenspezifischen Geschäfts- und Leistungsprozessen", kind: "betrieb" },
  { name: "Informieren und Beraten von Kunden und Kundinnen", kind: "betrieb" },
  { name: "Installieren und Konfigurieren von Netzwerken", kind: "betrieb" },
  { name: "Konzipieren und Realisieren von IT-Systemen", kind: "betrieb" },
  { name: "Entwickeln, Erstellen und Betreuen von IT-Lösungen", kind: "betrieb" },
  { name: "Erbringen der Leistungen und Auftragsabschluss", kind: "betrieb" },
  { name: "Durchführen und Dokumentieren von qualitätssichernden Maßnahmen", kind: "betrieb" },
  { name: "Aufbau und Organisation des Ausbildungsbetriebes", kind: "betrieb" },
  { name: "Umsetzen, Integrieren und Prüfen von Maßnahmen zur IT-Sicherheit und zum Datenschutz", kind: "betrieb" },
  { name: "Beurteilen marktgängiger IT-Systeme und kundenspezifischer Lösungen", kind: "betrieb" },
  { name: "Betrieb und Sicherheit vernetzter Systeme gewährleisten", kind: "betrieb" },
  { name: "Kundenspezifische Systemintegration durchführen", kind: "betrieb" },
  { name: "Netzwerke und Dienste bereitstellen", kind: "betrieb" },
  { name: "Serviceanfragen bearbeiten", kind: "betrieb" },
  { name: "Vernetztes Zusammenarbeiten unter Nutzung digitaler Medien", kind: "betrieb" },
  { name: "Umweltschutz", kind: "betrieb" },
  { name: "Allgemeinbildende Fächer", kind: "schule" },
  { name: "Das Unternehmen und die eigene Rolle im Betrieb beschreiben", kind: "schule" },
  { name: "Schutzbedarfsanalyse im eigenen Arbeitsbereich durchführen", kind: "schule" },
  { name: "Clients in Netzwerke einbinden", kind: "schule" },
  { name: "Software zur Verwaltung von Daten anpassen", kind: "schule" },
  { name: "Arbeitsplätze nach Kundenwunsch ausstatten", kind: "schule" },
  { name: "Sonstige Qualifikation", kind: "sonst" },
];

const sq = (t: string) => t.replace(/'/g, "''");

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "Grundtabellen: Einstellungen und Verknüpfungen",
    statements: [
      // Einstellungen: gewählter Bereich, zuletzt gewählter Menüpunkt, Ton an/aus ...
      `CREATE TABLE IF NOT EXISTS settings (
         key   TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
      // Eine gemeinsame Verknüpfungstabelle für ALLES (Notiz <-> Projekt <-> Kontakt <-> Datei ...),
      // auch zwischen Schule und Arbeit.
      `CREATE TABLE IF NOT EXISTS links (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         a_type     TEXT    NOT NULL,
         a_id       INTEGER NOT NULL,
         b_type     TEXT    NOT NULL,
         b_id       INTEGER NOT NULL,
         created_at TEXT    NOT NULL DEFAULT (datetime('now')),
         UNIQUE (a_type, a_id, b_type, b_id)
       )`,
      `CREATE INDEX IF NOT EXISTS idx_links_a ON links (a_type, a_id)`,
      `CREATE INDEX IF NOT EXISTS idx_links_b ON links (b_type, b_id)`,
    ],
  },
  {
    version: 2,
    name: "Etappe 2: Notizen, Projekte, Qualifikationen, Anhänge",
    statements: [
      // Projekte: hier nur das Nötigste, die Pinnwand folgt in Etappe 5
      `CREATE TABLE IF NOT EXISTS projects (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         name       TEXT NOT NULL,
         scope      TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      `CREATE TABLE IF NOT EXISTS qualifications (
         id   INTEGER PRIMARY KEY AUTOINCREMENT,
         name TEXT NOT NULL UNIQUE,
         kind TEXT NOT NULL,
         sort INTEGER NOT NULL
       )`,
      // Eine Notiz = eine erledigte Aufgabe (bewusst ohne Dauer-Feld)
      `CREATE TABLE IF NOT EXISTS notes (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         date       TEXT NOT NULL,
         scope      TEXT NOT NULL,
         text       TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      `CREATE INDEX IF NOT EXISTS idx_notes_date ON notes (date)`,
      // Anhänge: die Datei liegt als Kopie im App-Ordner, hier steht nur der relative Pfad
      `CREATE TABLE IF NOT EXISTS attachments (
         id            INTEGER PRIMARY KEY AUTOINCREMENT,
         note_id       INTEGER NOT NULL,
         original_name TEXT NOT NULL,
         stored_path   TEXT NOT NULL,
         created_at    TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      `CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments (note_id)`,
      ...QUALIS.map(
        (q, i) =>
          `INSERT OR IGNORE INTO qualifications (name, kind, sort) VALUES ('${sq(q.name)}', '${q.kind}', ${i + 1})`
      ),
    ],
  },
  {
    version: 3,
    name: "Etappe 3: Kontakte (Personenbaum)",
    statements: [
      `CREATE TABLE IF NOT EXISTS persons (
         id            INTEGER PRIMARY KEY AUTOINCREMENT,
         name          TEXT NOT NULL,
         role          TEXT,
         scope         TEXT NOT NULL,
         parent_id     INTEGER,
         phone         TEXT,
         email         TEXT,
         info          TEXT,
         portrait_path TEXT,
         created_at    TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      `CREATE INDEX IF NOT EXISTS idx_persons_parent ON persons (parent_id)`,
    ],
  },
  {
    version: 4,
    name: "Etappe 4: Dateien, Ordner-Verknüpfungen, Verlauf",
    statements: [
      // Dateien, die die App kennt (verschoben oder verknüpft). Fehlt der Pfad, zeigt die App "nicht gefunden".
      `CREATE TABLE IF NOT EXISTS files (
         id       INTEGER PRIMARY KEY AUTOINCREMENT,
         path     TEXT NOT NULL UNIQUE,
         name     TEXT NOT NULL,
         scope    TEXT,
         added_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      // Ordner, die mit einem Projekt verknüpft sind (alles darin gehört dann zum Projekt)
      `CREATE TABLE IF NOT EXISTS folders (
         id       INTEGER PRIMARY KEY AUTOINCREMENT,
         path     TEXT NOT NULL UNIQUE,
         added_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      // Verlauf aller Verschiebungen (für Rückgängig und zum Dazulernen)
      `CREATE TABLE IF NOT EXISTS file_moves (
         id          INTEGER PRIMARY KEY AUTOINCREMENT,
         kind        TEXT NOT NULL,
         name        TEXT NOT NULL,
         ext         TEXT,
         from_path   TEXT NOT NULL,
         to_path     TEXT NOT NULL,
         scope       TEXT,
         dest_folder TEXT NOT NULL,
         project_id  INTEGER,
         mode        TEXT NOT NULL,
         via         TEXT NOT NULL,
         moved_at    TEXT NOT NULL DEFAULT (datetime('now')),
         undone_at   TEXT
       )`,
      `CREATE INDEX IF NOT EXISTS idx_moves_time ON file_moves (moved_at)`,
    ],
  },
  {
    version: 5,
    name: "Etappe 5: Pinnwand (Fortschritt, Status, Position der Zettel)",
    statements: [
      `ALTER TABLE projects ADD COLUMN description TEXT`,
      `ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'aktiv'`,
      `ALTER TABLE projects ADD COLUMN progress INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE projects ADD COLUMN board_x REAL`,
      `ALTER TABLE projects ADD COLUMN board_y REAL`,
      `ALTER TABLE projects ADD COLUMN updated_at TEXT`,
    ],
  },
  {
    version: 6,
    name: "Projekte: zuständige Person und Mitarbeitende (Rolle an der Verknüpfung)",
    statements: [
      `ALTER TABLE links ADD COLUMN role TEXT`,
    ],
  },
  {
    version: 7,
    name: "Etappe 6: Aufgaben pro Projekt (Was als Nächstes)",
    statements: [
      `CREATE TABLE IF NOT EXISTS project_tasks (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         project_id INTEGER NOT NULL,
         text       TEXT NOT NULL,
         done       INTEGER NOT NULL DEFAULT 0,
         sort       INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         done_at    TEXT,
         note_id    INTEGER
       )`,
      `CREATE INDEX IF NOT EXISTS idx_tasks_project ON project_tasks (project_id)`,
    ],
  },
  {
    version: 8,
    name: "Etappe 7: Mindmap (freie Knoten, freie Linien, gemerkte Positionen)",
    statements: [
      `CREATE TABLE IF NOT EXISTS mindmap_nodes (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         project_id INTEGER NOT NULL,
         label      TEXT NOT NULL,
         color      TEXT NOT NULL DEFAULT 'teal',
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      // Linien, die du selbst ziehst. Knoten werden als Schlüssel gespeichert, z. B. "free:3", "note:12", "person:4"
      `CREATE TABLE IF NOT EXISTS mindmap_edges (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         project_id INTEGER NOT NULL,
         a          TEXT NOT NULL,
         b          TEXT NOT NULL,
         UNIQUE (project_id, a, b)
       )`,
      `CREATE TABLE IF NOT EXISTS mindmap_pos (
         project_id INTEGER NOT NULL,
         node_key   TEXT NOT NULL,
         x          REAL NOT NULL,
         y          REAL NOT NULL,
         PRIMARY KEY (project_id, node_key)
       )`,
    ],
  },
  {
    version: 9,
    name: "Etappe 8: Berichtsheft-Wochenentwürfe",
    statements: [
      `CREATE TABLE IF NOT EXISTS report_weeks (
         year        INTEGER NOT NULL,
         week        INTEGER NOT NULL,
         data        TEXT NOT NULL,
         updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
         exported_at TEXT,
         export_path TEXT,
         PRIMARY KEY (year, week)
       )`,
    ],
  },
  {
    version: 10,
    name: "Etappe 10: Personen-Netzplan (mehrere Beziehungen, gemerkte Plätze)",
    statements: [
      // Mehrere Vorgesetzte/Untergebene pro Person. „a“ ist übergeordnet, „b“ untergeordnet.
      `CREATE TABLE IF NOT EXISTS person_links (
         id    INTEGER PRIMARY KEY AUTOINCREMENT,
         a_id  INTEGER NOT NULL,
         b_id  INTEGER NOT NULL,
         label TEXT,
         UNIQUE (a_id, b_id)
       )`,
      // Alte Einzel-Zuordnung (parent_id) übernehmen
      `INSERT OR IGNORE INTO person_links (a_id, b_id)
         SELECT parent_id, id FROM persons WHERE parent_id IS NOT NULL`,
      `CREATE TABLE IF NOT EXISTS person_pos (
         person_id INTEGER PRIMARY KEY,
         x REAL NOT NULL,
         y REAL NOT NULL
       )`,
      `CREATE TABLE IF NOT EXISTS board_pos (
         project_id INTEGER PRIMARY KEY,
         x REAL NOT NULL,
         y REAL NOT NULL
       )`,
    ],
  },
  {
    version: 11,
    name: "Etappe 11: Kontakt-Gruppen (eine Person kann in mehreren Gruppen sein)",
    statements: [
      `CREATE TABLE IF NOT EXISTS contact_groups (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
         color      TEXT NOT NULL DEFAULT '#38b6ff',
         created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`,
      `CREATE TABLE IF NOT EXISTS contact_group_members (
         person_id INTEGER NOT NULL,
         group_id  INTEGER NOT NULL,
         PRIMARY KEY (person_id, group_id)
       )`,
    ],
  },
];
