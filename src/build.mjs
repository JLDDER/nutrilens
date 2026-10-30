// Production build for NutriLens AI (Windows / macOS / Linux).
//
// Usage: open a terminal in this folder and run:   node build.mjs
// Requires Node.js 18+ (https://nodejs.org). Run it from PowerShell or Command Prompt.
// Tailwind: a standalone CLI in this folder (e.g. tailwindcss-windows-x64.exe, v3.4.17 from
// github.com/tailwindlabs/tailwindcss/releases/tag/v3.4.17) is used if present, otherwise npx.
//
// Source layout                      Output (upload everything inside dist/ to GitHub)
//   index.html   markup              dist/index.html   one file: CSS and scripts inlined
//   css/app.css  plain CSS           dist/images/      key-guide screenshots
//   js/i18n.js   UI strings          dist/icons/       favicon and home-screen icon
//   js/foods.js  food table
//   js/app.js    application
//   js/photos.js photos & sharing
//   manifest.webmanifest              dist/manifest.webmanifest  "Add to Home Screen" as an app
//   images/, icons/
//
// Steps:
//   1. The <style type="text/tailwindcss"> block in index.html is Tailwind's input, so the
//      component classes live in one place; only classes used in index.html and js/ are compiled.
//   2. Everything between <!-- TAILWIND:BEGIN and <!-- TAILWIND:END --> (Play CDN + that block)
//      is replaced by the compiled CSS.
//   3. <link rel="stylesheet" href="css/…"> and <script src="js/…"> are inlined, so a browser
//      never mixes a new index.html with cached old scripts.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'dist';
const TMP_IN = 'tailwind.in.css';
const TMP_OUT = 'tailwind.out.css';
const COPY_DIRS = ['images', 'icons'];
/** Files served next to index.html as they are. */
const COPY_FILES = ['manifest.webmanifest'];
/** A standalone Tailwind binary in this folder takes precedence over npx. */
const standalone = fs.readdirSync('.').find(f => /^tailwindcss(-[\w-]+)?(\.exe)?$/i.test(f) && fs.statSync(f).isFile());
const fail = msg => { console.error(`\n✖ ${msg}\n`); process.exit(1); };
const read = file => {
  if (!fs.existsSync(file)) fail(`${file} not found — run build.mjs from the project folder. (找不到 ${file}，請在專案資料夾執行)`);
  return fs.readFileSync(file, 'utf8');
};

let html = read('index.html');

// 1–2. Tailwind
const block = /[ \t]*<!-- TAILWIND:BEGIN[\s\S]*?<!-- TAILWIND:END -->\r?\n?/;
if (!block.test(html)) fail('TAILWIND:BEGIN / TAILWIND:END markers not found. (找不到 TAILWIND 標記)');
// Anchored to the start of a line so a mention of the tag inside a comment is never matched.
const components = html.match(block)[0].match(/^[ \t]*<style type="text\/tailwindcss">([\s\S]*?)<\/style>/m)?.[1] ?? '';
if (/<[a-z!\/]/i.test(components)) fail('The text/tailwindcss style block contains HTML; check the TAILWIND markers. (樣式區塊中混入了 HTML)');

fs.writeFileSync(TMP_IN, `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n${components}\n`);
let css;
try {
  if (!process.env.SKIP_TAILWIND) {
    const cli = standalone ? `"./${standalone}"` : 'npx --yes tailwindcss@3.4.17';
    console.log(`Compiling Tailwind with ${standalone || 'npx'} …`);
    execSync(`${cli} -c tailwind.config.js -i ${TMP_IN} -o ${TMP_OUT} --minify`, { stdio: 'inherit' });
  }
  css = fs.readFileSync(TMP_OUT, 'utf8');
} catch (e) {
  fail(`Tailwind build failed (see the messages above). (Tailwind 編譯失敗，請看上方的錯誤訊息)\n  Command: ${e.cmd || e.message}\n`
    + '  Tip: put tailwindcss-windows-x64.exe (v3.4.17) in this folder to build without npx.');
} finally {
  fs.rmSync(TMP_IN, { force: true });
  if (!process.env.SKIP_TAILWIND) fs.rmSync(TMP_OUT, { force: true });
}
html = html.replace(block, () => `  <style>${css}</style>\n`);

// 3. Inline local stylesheets and scripts (a "</script" inside a script would end the tag early)
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)" \/>/g, (_, file) => `<style>\n${read(file)}</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, file) => {
  const code = read(file);
  if (/<\/script/i.test(code)) fail(`${file} contains "</script", which cannot be inlined.`);
  return `<script>\n${code}</script>`;
});

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR);
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html);
for (const dir of COPY_DIRS) if (fs.existsSync(dir)) fs.cpSync(dir, path.join(OUT_DIR, dir), { recursive: true });
for (const file of COPY_FILES) if (fs.existsSync(file)) fs.copyFileSync(file, path.join(OUT_DIR, file));

const kb = f => Math.round(fs.statSync(f).size / 1024);
console.log(`✔ Done -> ${OUT_DIR}/index.html (${kb(path.join(OUT_DIR, 'index.html'))} KB) + ${COPY_DIRS.join('/, ')}/, ${COPY_FILES.join(', ')}`);
console.log('  Upload the CONTENTS of the dist folder to GitHub. (把 dist 資料夾「裡面」的檔案上傳到 GitHub)');
