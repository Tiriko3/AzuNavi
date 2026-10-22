// Freigegebene Orte (ab 0.4.1, nur PC): einmalige Übernahme der bisher benutzten Ordner und Dateilinks.
// Rust fragt dabei in einem Windows-Fenster nach, erst nach „Erlauben“ wird etwas freigegeben (fs_adopt in fs_grants.rs).
// Das Frontend liefert nur die Vorschläge aus der Datenbank, es kann selbst nichts freigeben.
import { invoke } from "@tauri-apps/api/core";
import { getSetting } from "../db/db";
import { getRoots, listTracked, listFolderProjects } from "../db/filesRepo";

/** Vorschläge aus der Datenbank: Arbeit, Schule, Cloud-Ordner, mit Projekten verknüpfte Ordner und verknüpfte Dateien */
export async function collectKnown(): Promise<{ folders: string[]; files: string[] }> {
  const roots = await getRoots();
  const cloud = await getSetting("cloud_dir");
  const folders = [roots.arbeit, roots.schule, cloud, ...(await listFolderProjects()).map((f) => f.path)].filter((p): p is string => !!p);
  const files = (await listTracked()).map((f) => f.path).filter(Boolean);
  return { folders: [...new Set(folders)], files: [...new Set(files)] };
}

export async function adoptKnownLocations(collect: () => Promise<{ folders: string[]; files: string[] }> = collectKnown): Promise<void> {
  const st = await invoke<{ asked: boolean }>("fs_grants_state");
  if (st.asked) return;   // wurde schon einmal gefragt (egal mit welcher Antwort)
  const { folders, files } = await collect();
  await invoke("fs_adopt", { folders, files });
}

/* ---------- Übersicht und Entziehen (System → Freigaben) ---------- */
export interface GrantItem { path: string; name: string; exists: boolean }
export interface GrantsList { roots: GrantItem[]; files: GrantItem[]; undo_dirs: number }
export const listGrants = () => invoke<GrantsList>("fs_grants_list");
/** Eine Freigabe entziehen. Die Ordner und Dateien selbst werden nie angefasst. `path` ist der Text aus listGrants. */
export const revokeGrant = (kind: "root" | "file" | "all-files", path?: string) => invoke<void>("fs_grants_revoke", { kind, path: path ?? null });
