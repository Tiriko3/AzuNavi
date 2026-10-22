// Test der Frontend-Seite der freigegebenen Orte (0.4.1): welche Rust-Befehle mit welchen Parametern aufgerufen werden.
// Start: npx esbuild tools/grants-test.mts --bundle --platform=node --format=esm --outfile=/tmp/grants-test.mjs '--define:import.meta.env={"DEV":false,"VITE_AZ_WEB":""}' --external:'*.wasm?url' && node /tmp/grants-test.mjs
import "fake-indexeddb/auto";
const st = new Map<string, string>();
(globalThis as any).sessionStorage = { getItem: (k: string) => st.get(k) ?? null, setItem: (k: string, v: string) => void st.set(k, v), removeItem: (k: string) => void st.delete(k) };
(globalThis as any).window = Object.assign(globalThis, { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Edg/130" }, configurable: true });
const calls: { cmd: string; args: any }[] = [];
let asked = false;
(globalThis as any).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: any) => {
    calls.push({ cmd, args });
    if (cmd === "fs_grants_state") return { asked };
    if (cmd === "fs_adopt") { asked = true; return { answer: "ja", folders: args.folders.length, files: args.files.length }; }
    if (cmd === "fs_pick_files") return args.multiple ? ["C:\\D\\a.pdf", "C:\\D\\b.pdf"] : ["C:\\D\\a.pdf"];
    if (cmd === "fs_pick_folder") return "C:\\Arbeit";
    if (cmd === "fs_save_file") return "C:\\X\\s.zip";
    return null;
  },
};
let ok = 0, bad = 0;
const check = (c: unknown, m: string) => { if (c) ok++; else { bad++; console.log("  ✗ " + m); } };
const last = () => calls[calls.length - 1];

// Plattform-Flags wie im Fenster (Vite-Umgebung nachbilden)
const { fsapi } = await import("../src/fsapi.ts");
const fs = await fsapi();
console.log("Dialoge am PC gehen über Rust");
check(JSON.stringify(await fs.pickFiles()) === '["C:\\\\D\\\\a.pdf","C:\\\\D\\\\b.pdf"]', "pickFiles liefert die Pfade");
check(last().cmd === "fs_pick_files" && last().args.keep === false && last().args.multiple === true, "pickFiles: nur für diese Sitzung");
check((await fs.pickFile()) === "C:\\D\\a.pdf" && last().args.multiple === false && last().args.keep === false, "pickFile: Standard = nur Sitzung");
await fs.pickFile(true); check(last().args.keep === true, "pickFile(true): dauerhaft (Verknüpfung)");
check((await fs.pickFolder("T")) === "C:\\Arbeit" && last().cmd === "fs_pick_folder" && last().args.keep === true, "pickFolder: Standard = dauerhaft (Arbeit/Schule/Cloud)");
await fs.pickFolder("T", false); check(last().args.keep === false, "pickFolder(…, false): nur Sitzung");
check((await fs.saveFile("s.zip", new Uint8Array([1, 2, 3]), "Sicherung", "zip")) === "C:\\X\\s.zip", "saveFile liefert den Pfad");
check(last().cmd === "fs_save_file" && last().args.ext === "zip" && last().args.defaultName === "s.zip" && last().args.bytes.length === 3, "saveFile: Rust öffnet den Dialog und schreibt");
check(!calls.some((c) => c.cmd.startsWith("plugin:dialog")), "kein JS-Dialog mehr (der würde Rust umgehen)");

console.log("Bisherige Orte einmalig übernehmen");
{
  const { adoptKnownLocations } = await import("../src/desktop/grants.ts");
  const collect = async () => ({ folders: ["C:\\Arbeit", "C:\\Schule"], files: ["C:\\Downloads\\a.pdf"] });
  calls.length = 0;
  await adoptKnownLocations(collect);
  const ad = calls.find((c) => c.cmd === "fs_adopt");
  check(!!ad && ad.args.folders.length === 2 && ad.args.files[0] === "C:\\Downloads\\a.pdf", "erster Start: Vorschläge gehen an Rust (dort fragt ein Windows-Fenster)");
  calls.length = 0;
  await adoptKnownLocations(collect);
  check(!calls.some((c) => c.cmd === "fs_adopt"), "danach wird nicht noch einmal gefragt");
  check(calls.length === 1 && calls[0].cmd === "fs_grants_state", "nur die Statusabfrage");
}
console.log(`\n${ok} bestanden, ${bad} fehlgeschlagen`);
process.exit(bad ? 1 : 0);
