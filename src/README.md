# NutriLens AI

Photograph a meal, let Gemini estimate its nutrition, and track daily goals and weight.
Each user brings their own Gemini API key (stored only in their browser).

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | Markup, head meta, Tailwind component classes |
| `css/app.css` | Plain CSS that Tailwind utilities do not cover |
| `js/i18n.js` | UI strings (zh / en), one key per line |
| `js/foods.js` | Cooked-food composition table used by precise mode (every row cites its source) |
| `js/app.js` | Application script, 12 numbered sections |
| `images/` | Key-guide screenshots |
| `icons/` | Favicon and home-screen icon |
| `build.mjs`, `tailwind.config.js` | Production build |

## Develop

Open `index.html` in a browser. Tailwind runs from its Play CDN, so no build is needed while editing.

## Build and deploy (GitHub Pages)

This folder (`src/`) is the source; the repository root holds the built site that GitHub Pages serves.

1. In `src/`, run `node build.mjs` (Node.js 18+; uses `tailwindcss-windows-x64.exe` v3.4.17 in this folder if present, otherwise npx).
2. Copy **the contents of `src/dist/`** (`index.html`, `images/`, `icons/`) to the repository root and commit both.

`dist/index.html` is self-contained apart from the images: CSS and scripts are inlined, so a
browser can never combine a new page with cached old scripts.

## Conventions

- 2-space indentation, double quotes in HTML, single quotes in JS, no line over ~160 characters
  (prompt text excepted).
- Clickable elements use `data-action="name"`; handlers live in `ACTIONS` (app.js §11).
- Text uses `data-i18n` / `-placeholder` / `-title` / `-aria-label` with keys from `js/i18n.js`.
- Every `<button>` declares its `type`.
- Tailwind class names must appear as complete literal strings so the build can find them.

## Testing build

`test.html` in the repository root is a build of this source with the **precise analysis mode** and the
**accuracy test** (資料管理 → 進階 → 準確度驗證). The live `index.html` stays on the standard mode until
the accuracy test shows the precise mode is better.
