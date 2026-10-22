// Brücke zu den Datenordner-Befehlen des PC-Programms (src-tauri/src/data_cmds.rs).
// Rust prüft jeden Pfad: gelesen und geschrieben wird nur innerhalb des gewählten Datenordners und nur, was AzuNavi gehört.
import { invoke } from "@tauri-apps/api/core";

/** PC-Programm (Tauri-Fenster, nicht Android). Gleiche Bedingung wie isDesktopApp in platform.ts, hier ohne Vite-Abhängigkeit (testbar unter Node). */
export const hasDisk = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && !(typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

/** Handy-App (Tauri, Android/iOS): Daten im App-Speicher (appStore.ts). Gleiche Bedingung wie isMobileApp in platform.ts, ohne Vite-Abhängigkeit. */
export const hasApp = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window && typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export interface DiskLoc { id: string; name: string; path: string; exists: boolean }
export interface LegacyInfo { exists: boolean; size: number; modified: number; dir: string; backup_dir: string | null }
export interface BackupInfo { dir: string; files: string[]; bytes: number; created: boolean }

const NOT_FOUND = "NICHT_GEFUNDEN";
const text = (e: unknown) => String((e as Error)?.message ?? e);

export const disk = {
  locations: () => invoke<DiskLoc[]>("data_locations"),
  /** Ordner-Dialog (von Rust geöffnet). Abbruch: null */
  pickFolder: () => invoke<DiskLoc | null>("data_pick_folder"),
  open: (id: string) => invoke<DiskLoc>("data_open", { id }),
  close: () => invoke<void>("data_close"),
  /** Nur aus der Liste nehmen, der Ordner bleibt unberührt */
  forget: (id: string) => invoke<void>("data_forget", { id }),
  /** null, wenn es die Datei nicht gibt */
  read: async (rel: string): Promise<Uint8Array | null> => {
    try { return new Uint8Array(await invoke<ArrayBuffer>("data_read", { rel })); }
    catch (e) { if (text(e).includes(NOT_FOUND)) return null; throw new Error(text(e)); }
  },
  /** Atomar: erst Zwischendatei, dann umbenennen. Der Inhalt geht als Rohdaten, der Pfad (kodiert) im Header. */
  write: async (rel: string, bytes: Uint8Array): Promise<void> => {
    try { await invoke<void>("data_write", bytes, { headers: { "x-rel": encodeURIComponent(rel) } }); }
    catch (e) { throw new Error(text(e)); }
  },
  list: () => invoke<string[]>("data_list"),
  removeLock: () => invoke<void>("data_remove_lock"),
};

export const legacy = {
  info: () => invoke<LegacyInfo>("legacy_info"),
  backup: (stamp: string) => invoke<BackupInfo>("legacy_backup", { stamp }),
};
