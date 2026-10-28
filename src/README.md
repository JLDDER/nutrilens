# NutriLens AI

Photograph a meal, let Gemini estimate its nutrition, and track daily goals and weight.
Each user brings their own Gemini API key (stored only in their browser).

## Project layout

| Path | Purpose |
|---|---|
| `index.html` | Markup, head meta, Tailwind component classes |
| `css/app.css` | Plain CSS that Tailwind utilities do not cover |
| `js/i18n.js` | UI strings (zh / en), one key per line |
| `js/foods.js` | Cooked-food composition table for precise mode (generated; every row cites its source) |
| `js/app.js` | Application script, 12 numbered sections |
| `images/` | Key-guide screenshots |
| `icons/` | Favicon and home-screen icon |
| `build.mjs`, `tailwind.config.js` | Production build |
| `tools/` | `gen_foods.py` builds `js/foods.js` from `tools/foodref/foodref.json` |

## Develop

Open `index.html` in a browser. Tailwind runs from its Play CDN, so no build is needed while editing.

## Build and deploy (GitHub Pages)

This folder (`src/`) is the source; the repository root holds the built site that GitHub Pages serves.

1. In `src/`, run `node build.mjs` (Node.js 18+; uses `tailwindcss-windows-x64.exe` v3.4.17 in this folder if present, otherwise npx).
2. Copy **the contents of `src/dist/`** (`index.html`, `images/`, `icons/`) to the repository root and commit both.

`dist/index.html` is self-contained apart from the images: CSS and scripts are inlined, so a
browser can never combine a new page with cached old scripts.

## Analysis modes

- **Precise (default)** — prompt v6, 3 requests. The model identifies foods, cooking method and portion
  (from container, area and thickness); composition comes from `js/foods.js` (294 as-served foods:
  衛福部 TFND and 日本食品標準成分表 八訂) when the food and method match exactly, otherwise from the model;
  oil is added from measured absorption rates only when the value excludes it; the weight is the median of
  the main estimate and two Flash-Lite re-estimates; a total kcal printed on the package scales the items.
- **Standard** — prompt v4, 1 request; the model estimates everything.
- **Accuracy test** (資料管理 → 準確度驗證) compares both modes against known values (labels or weighed meals).

## Conventions

- 2-space indentation, double quotes in HTML, single quotes in JS, no line over ~160 characters
  (prompt text excepted).
- Clickable elements use `data-action="name"`; handlers live in `ACTIONS` (app.js §11).
- Text uses `data-i18n` / `-placeholder` / `-title` / `-aria-label` with keys from `js/i18n.js`.
- Every `<button>` declares its `type`.
- Tailwind class names must appear as complete literal strings so the build can find them.
