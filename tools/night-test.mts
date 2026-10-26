// Test der Nacht-Zeiten (night.ts). Start: npx tsx tools/night-test.mts
import { isNightNow, validTime } from "../src/night.ts";
let ok = 0, bad = 0;
const check = (c: unknown, m: string) => { if (c) ok++; else { bad++; console.log("  ✗ " + m); } };
const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m);
check(isNightNow("auto", at(23, 30)) && isNightNow("auto", at(5, 59)) && isNightNow("auto", at(21, 0)), "Standard 21 bis 6: nachts ist Nacht");
check(!isNightNow("auto", at(6, 0)) && !isNightNow("auto", at(12)) && !isNightNow("auto", at(20, 59)), "Standard: tagsüber nicht");
check(!isNightNow("auto", at(18, 29), "18:30", "07:15") && isNightNow("auto", at(18, 30), "18:30", "07:15") && isNightNow("auto", at(7, 14), "18:30", "07:15") && !isNightNow("auto", at(7, 15), "18:30", "07:15"), "eigene Zeiten über Mitternacht (18:30 bis 07:15)");
check(isNightNow("auto", at(13, 59), "12:00", "14:00") && !isNightNow("auto", at(14, 0), "12:00", "14:00") && !isNightNow("auto", at(11, 59), "12:00", "14:00"), "Zeiten am selben Tag (12:00 bis 14:00)");
check(!isNightNow("auto", at(3), "08:00", "08:00") && !isNightNow("auto", at(8), "08:00", "08:00"), "gleiche Zeiten = nie");
check(isNightNow("auto", at(12), "00:00", "23:59") && isNightNow("auto", at(0), "00:00", "23:59") && !isNightNow("auto", at(23, 59), "00:00", "23:59"), "00:00 bis 23:59 = fast immer Nacht");
check(isNightNow("an", at(12)) && !isNightNow("aus", at(23)), "„Immer“ und „Nie“ gehen vor");
check(isNightNow("auto", at(23), "kaputt", "auch kaputt") && !isNightNow("auto", at(12), "kaputt", "auch kaputt"), "kaputte Zeiten: Standardzeiten");
check(validTime("22:15", "21:00") === "22:15" && validTime("", "21:00") === "21:00" && validTime(null, "06:00") === "06:00" && validTime("abc", "06:00") === "06:00", "Zeiten prüfen");
console.log(`${ok} bestanden, ${bad} fehlgeschlagen`); process.exit(bad ? 1 : 0);
