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
| `js/photos.js` | Meal photos (IndexedDB), photo viewer and share images; loaded after `app.js` and registers its own actions |
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

## Meal photos and sharing

- The photos of each analysis are stored in IndexedDB (`nutrilens_photos`), keyed by the job id that the
  saved meal keeps as `photoId`. They never leave the device and are not part of the JSON backup.
- By default photos of meals older than 90 days are deleted at startup; 資料 → 餐點照片保存 can keep them forever.
  Photos no meal or job uses are deleted at the same time.
- Sharing draws a JPEG on a canvas (1080 px wide) and passes it to the system share sheet
  (`navigator.share` with files) or downloads it. A meal image never includes goals; the day image
  includes the target and calories left unless switched off in the preview.

## Conventions

- 2-space indentation, double quotes in HTML, single quotes in JS, no line over ~160 characters
  (prompt text excepted).
- Clickable elements use `data-action="name"`; handlers live in `ACTIONS` (app.js §11). A feature file
  such as `photos.js` adds its entries with `Object.assign(ACTIONS, …)`.
- Text uses `data-i18n` / `-placeholder` / `-title` / `-aria-label` with keys from `js/i18n.js`.
- Every `<button>` declares its `type`.
- Tailwind class names must appear as complete literal strings so the build can find them.
