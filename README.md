# Demo Analytics — AI search visibility dashboard (front-end demo)

> **Self-initiated demo, not a client project. Sample data only.**
> "Demo Analytics" and "Fernhill Goods" are fictional. The logo is a generic placeholder. No real company data, no real API calls, no external requests (system fonts only).

A small portfolio piece: a single-page SaaS dashboard showing how often a store is mentioned in AI answers. Plain HTML, CSS and vanilla JavaScript. No frameworks, no build step, no npm packages. Charts are drawn by hand with SVG/CSS/JS.

## Folder structure

```
index.html            Markup for all four views + the persistent demo footer
css/
  tokens.css          Design tokens (colour, spacing, radius, shadow, type, motion)
  base.css            Reset, accessibility helpers, scroll-reveal base styles
  components.css      Reusable BEM blocks (card, kpi, ring, chart, steps, table, state...)
  views.css           Per-view layout + the view-switch transition
js/
  app.js              Routing, rendering, states, scroll-triggered animation, progress simulation
  charts.js           Line chart, bar chart, sparkline, score ring, count-up
  data-loader.js      fetch() wrapper for /data (the only file that knows where data comes from)
data/
  overview.json       Data for the Overview view
  report.json         Data for the Analysis progress + Report views
```

## Run locally

`fetch()` and ES modules need HTTP, so don't open `index.html` by double-clicking. From this folder:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
# or
npx serve .
```

## Deploy

It's a static site with no config. On Vercel, upload/drag the folder (framework preset: "Other", no build command, no output directory). Any static host works the same way.

## Views

| Hash | View | What it shows |
| --- | --- | --- |
| `#overview` | Overview | KPI cards, score ring, animated line chart, store vs. competitors bar chart |
| `#progress` | Analysis progress | Stepped list with status icons and an animated progress bar (simulated) |
| `#report` | Report | Citations list, competitors table, recommendation cards with priority labels |
| `#states` | States showcase | Loading / empty / error for every view, switched with a radio toggle |

Views switch without reloading (hash routing, so back/forward and deep links work). After a switch, focus moves to the page heading for keyboard and screen-reader users.

## How animations are triggered

- **Scroll reveal:** elements with `data-reveal` start hidden; one shared `IntersectionObserver` (`onVisible()` in `app.js`) adds `.is-visible` the first time they enter the viewport. Siblings are staggered with `--reveal-delay`.
- **Charts:** each chart host is observed. On first entry `chart.play()` adds `.is-drawn`, and CSS does the rest: the line is revealed by a cover rectangle sliding away, bars scale up from the baseline (staggered with `--i`), the sparkline scales in.
- **Numbers and ring:** `countUp()` updates text with `requestAnimationFrame` from 0 to the value. The ring writes a `--p` (0..1) variable on every frame, and two half-rings rotate from it.
- **View switch:** the old view gets `.is-leaving` (fade/slide out), then the new one gets `.is-entering`.
- **Progress:** a `requestAnimationFrame` loop starts the first time the Progress view is shown (and on Replay). Step durations come from `analysis.steps[].durationMs`.
- **Skeletons:** a gradient `translateX` shimmer.
- **Only `transform` and `opacity` are animated.** Hover backgrounds are a pseudo-element whose opacity changes.
- **Mobile and reduced motion:** all durations are `calc(<ms> * var(--motion-scale))` in `tokens.css`. `--motion-scale` is `1` on desktop, `0.6` at 768px and below (shorter, with less travel), and `0` under `prefers-reduced-motion` (everything snaps to its final state, spinners and shimmer stop). JS reads the same token, so count-ups and the progress simulation follow it.

## Where real data would plug in

Change `js/data-loader.js` (`BASE_PATH` / `loadData`) to call your API and return objects shaped like the JSON below. Set `MIN_LOADING_MS` to `0`, since it only exists so the skeleton is visible with local files. `app.js` already handles loading, empty (no rows) and error (`DataError`, with Retry) for both sources.

## JSON field names

### `data/overview.json`

| Field | Type | Meaning |
| --- | --- | --- |
| `meta.store` | string | Store name shown in titles |
| `meta.periodLabel` | string | Label in the header chip |
| `meta.generatedAt` | ISO string | When the data was produced |
| `meta.isSampleData` | boolean | Marks demo data |
| `kpis.visibilityScore` | `{value, previous, max}` | Score now, in the previous period, and the scale maximum |
| `kpis.mentions` | `{value, previous}` | Mention counts (the delta % is computed) |
| `kpis.competitorRank` | `{value, total, previous}` | Rank now, number of brands, previous rank |
| `kpis.trend` | `{changePoints, windowWeeks}` | Point change over the window |
| `visibilitySeries.unit` | string | Unit suffix, e.g. `%` |
| `visibilitySeries.labels` | string[] | X-axis labels (one per point) |
| `visibilitySeries.values` | number[] | Weekly visibility values, same length as `labels` |
| `competitors[]` | `{name, score, isStore}` | Bar chart entries; `isStore: true` is highlighted |

### `data/report.json`

| Field | Type | Meaning |
| --- | --- | --- |
| `meta.store`, `meta.generatedAt`, `meta.isSampleData` | | As above |
| `summary` | string | Short paragraph at the top of the Report |
| `analysis.questionsSampled` | number | Shown under the progress bar |
| `analysis.steps[]` | `{id, label, description, durationMs}` | Steps of the progress list |
| `citations[]` | `{source, domain, type, count}` | Cited sources; the bar is relative to the largest `count` |
| `competitors[]` | `{name, isStore, visibility, mentions, avgPosition, positiveSentiment, change}` | Table rows (`change` in points) |
| `recommendations[]` | `{id, title, description, priority, impact, effort}` | `priority` is `high`, `medium` or `low` |

If `visibilitySeries.values` is empty, the Overview shows its empty state. If `analysis.steps` or all report lists are empty, Progress and Report show theirs.

## Accessibility notes

- Semantic landmarks (`nav`, `main`, `header`, `footer`), one `h1` that updates per view, a skip link.
- `aria-current="page"` on the active nav item, `role="progressbar"` with live `aria-valuenow`, `aria-live` status text for progress steps and state previews.
- The line chart is keyboard-readable (focus it, then use Left/Right/Home/End) and also works with pointer and touch. The bar chart and ring expose their values via `aria-label`; count-ups give screen readers the final value.
- Status is never colour-only: deltas have arrows and signs, priorities have an icon plus text, steps have a text badge.
- Visible focus rings, text contrast of at least 4.5:1, wide tables scroll inside a focusable region.

## Notes

- Tested headless at 1440, 768 and 360px wide: no console errors, no horizontal overflow, no external requests.
- "Demo Analytics", "Fernhill Goods", competitor names and `.example` domains are invented. Any resemblance to a real product is coincidental.
