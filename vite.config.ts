import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";

// Die Rechtschreib-Pakete (hunspell-asm, emscripten-wasm-loader) importieren CommonJS-Module als Namensraum
// („import * as x“) und rufen sie dann als Funktion auf. Webpack verzeiht das, Vite/Rollup/esbuild nicht.
// Diese Korrektur macht daraus normale Importe – im fertigen Build und im Entwicklungsmodus.
function fixNamespaceImports(code: string, id: string): string | null {
  const p = id.replace(/\\/g, "/");
  if (!/node_modules\/(hunspell-asm|emscripten-wasm-loader)\//.test(p)) return null;
  let out = code;
  // nanoid: nur für interne Dateinamen benutzt -> eigene Zufalls-ID (unabhängig von der nanoid-Version)
  out = out.replace(/import \* as nanoid from (['"])nanoid\1;?/,
    "const nanoid = (s = 21) => Array.from(crypto.getRandomValues(new Uint8Array(s)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');");
  out = out.replace("import * as runtime from './lib/node/hunspell'", "import runtime from './lib/node/hunspell'");
  out = out.replace("import * as unixify from 'unixify'", "import unixify from 'unixify'");
  return out === code ? null : out;
}

// Sicherheitsregeln (CSP) der Web-App: Skripte nur aus der App selbst, keine Verbindungen nach außen
const WEB_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; " +
  "font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const webCspPlugin = {
  name: "web-csp",
  transformIndexHtml(html: string) { return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${WEB_CSP}" />`); },
};

const fixPlugin = {
  name: "fix-namespace-imports",
  transform(code: string, id: string) { return fixNamespaceImports(code, id); },
};

export default defineConfig(({ mode }) => ({
  // Web-App (GitHub Pages): liegt unter https://<name>.github.io/AzuNavi/
  base: mode === "web" ? (process.env.AZ_BASE ?? "/AzuNavi/") : "/",
  plugins: mode === "web" ? [react(), fixPlugin, webCspPlugin] : [react(), fixPlugin],
  clearScreen: false,
  build: { chunkSizeWarningLimit: 1600, outDir: mode === "web" ? "dist-web" : "dist" },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [{
        name: "fix-namespace-imports-dev",
        setup(build) {
          build.onLoad({ filter: /(hunspell-asm|emscripten-wasm-loader)[\\/].*\.js$/ }, async (args) => {
            const code = await readFile(args.path, "utf8");
            const fixed = fixNamespaceImports(code, args.path);
            return fixed ? { contents: fixed, loader: "js" } : undefined;
          });
        },
      }],
    },
  },
  // Tauri erwartet einen festen Port
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
