// Vorschaubilder der Standard-Vorlagen (liegen unter src/assets/vorlagen/<profil>.webp, erzeugt mit scripts/make-previews.ts)
const files = import.meta.glob("../assets/vorlagen/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
export function previewOf(id: string | null | undefined): string {
  const hit = (n: string) => Object.entries(files).find(([k]) => k.endsWith(`/${n}.webp`))?.[1];
  return hit(id ?? "si") ?? hit("si") ?? "";
}
