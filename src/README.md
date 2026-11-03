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

- **Precise (default)** — prompt v9, 3 requests. The model identifies foods, cooking method and portion
  (from container, area and thickness); composition comes from `js/foods.js` (294 as-served foods:
  衛福部 TFND and 日本食品標準成分表 八訂) when the food and method match exactly, otherwise from the model;
  oil is added from measured absorption rates only when the value excludes it; the weight is the median of
  the main estimate and two Flash-Lite re-estimates; a total kcal printed on the package scales the items.
- **Standard** — prompt v5, 1 request; the model estimates everything.
- Branded, chain and packaged products use their published nutrition (`PUBLISHED_GUIDE`, `published: true`):
  taken as served, no oil added. The main request (and suggestions) offer Google Search as a tool; a model or
  key that cannot use it (free keys often answer 429 "quota exceeded") gets the request again without it,
  and search is not offered again for 12 hours (`nutrilens_search_off_until_v1`, `run.searchOff`).
- The two re-estimates also name each item's cooking method (`METHOD_GUIDE`); the oil is the average over the
  three votes, so a split vote adds part of the oil (shown as 做法判斷不一) instead of all or none.
- Both modes and the weight re-estimates share `PORTION_GUIDE`: scale (the user's references first, then
  typical sizes), volume, bulk density and the edible share of bone-in cuts, with sources in the code.
- **Accuracy test** (資料管理 → 準確度驗證) compares both modes against known values (labels or weighed meals).

## Goal history

Goals are kept as a history (`nutrilens_goal_history_v1`: `[{ from, cal, p, c, f }]`). A change applies
from the day it is made, so past days keep the goals they had (dashboard, history list and day share use
`db.goalsFor(date)`). Goals set before this existed apply from the first recorded day.

## Reminders

A banner reminds to back up after 14 days without a backup (`nutrilens_last_backup_v1`) and to recalculate
the goals when the latest weight differs by 2 kg or more from the weight they were calculated with. "Later"
is stored in `nutrilens_reminders_v1`. Meals logged from a description only carry `source: 'text'`.

## Scale references

Objects the user measured (`nutrilens_scale_refs_v1`: `[{ id, name, size }]`, managed in 資料管理) appear as
chips under the photos. The ticked ones (`nutrilens_scale_refs_on_v1`, remembered between meals) go with the
photos as "Reference objects in the photo, measured by the user: …", are kept in the job as `refs` and in the
diagnostics record, and are part of the JSON backup.

## Meal suggestions

「建議吃什麼」 on today's dashboard. The app picks the meals still to plan from the clock and today's meal times
(`defaultSlots`), divides what is left of today's goals over the chosen meals by 25/35/30/10, renormalised over
the chosen ones (`mealTargets`; when the day is nearly or fully used, each meal gets a light, protein-first
minimum instead), and sends only text — targets, places, today's food names, favorites, restrictions, note — to
Gemini (`buildSuggestPrompt`). The model returns foods with portions, grams, table keys and methods; the
nutrients are computed like a precise analysis (`combinePrecise`), so a suggestion and the later photo agree.
Options more than 15 % off in calories or 20 % short of protein are sent back once with the app's numbers
(`suggestCorrection`); the closer of the two answers is kept. Places and restrictions are kept in
`nutrilens_suggest_prefs_v1` (backed up); today's last result in `nutrilens_suggest_cache_v1` until a meal
changes. Suggestions are never logged: meals are still logged by photo.

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
