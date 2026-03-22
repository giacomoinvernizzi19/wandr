# Wandr - AI Travel Itinerary Planner

## Accounts

| Platform | Account | ID |
|---|---|---|
| GitHub | giacomoinvernizzi19 | -- |
| Cloudflare | g.invernizzi.jm@gmail.com | `73412abe...` |

---

## Quick Context

| | |
|---|---|
| **What** | AI travel planner: 10 questions -> day-by-day itinerary on split-view map |
| **Stack** | CF Workers + Alpine.js + D1 + Leaflet + Gemini 2.5 Flash |
| **Status** | Deployed |
| **Type** | Personal |
| **Live URL** | https://wandr.g-invernizzi-jm.workers.dev |
| **GitHub** | https://github.com/giacomoinvernizzi19/wandr |

---

## Tech Stack

- **Frontend:** Alpine.js, Leaflet, vanilla CSS (no build step)
- **Backend:** Cloudflare Workers (TypeScript)
- **Database:** Cloudflare D1 (SQLite)
- **AI:** Gemini 2.5 Flash (free tier, Google Search grounding)
- **Auth:** Google OAuth (manual implementation)
- **Map:** Leaflet + OpenStreetMap tiles

---

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Worker: routing, auth, API, Gemini calls |
| `static/index.html` | Landing page |
| `static/plan.html` | 10-step questionnaire |
| `static/trip.html` | Split-view itinerary + map |
| `static/my-trips.html` | Saved trips grid |
| `static/app.js` | API helpers, auth store |
| `static/style.css` | Design system |

---

## Scripts

```bash
npx wrangler dev                                    # Development server (localhost:8787)
env -u CLOUDFLARE_API_TOKEN npx wrangler deploy     # Production deploy (personal account)
```

**IMPORTANTE:** `CLOUDFLARE_API_TOKEN` in `.env` root punta all'account Enpal.
Per deploy su account personale, SEMPRE usare `env -u CLOUDFLARE_API_TOKEN` per forzare OAuth.

---

## Browser Testing

```bash
# Test with Playwright skill
cd C:/ClaudeCode/.claude/skills/playwright-skill
node run.js C:/tmp/playwright-test-wandr.js
```

---

## Decisions

| Data | Decisione | Alternative | Perche' |
|------|-----------|-------------|---------|
| 2026-03-21 | Gemini 2.5 Flash | OpenAI, Claude | Free tier + Google Search grounding |
| 2026-03-21 | Manual Google OAuth | Arctic, Lucia | No library deps, CF Workers compatible |
| 2026-03-21 | Alpine.js + no build | React, Svelte | Simplicity, no build step |

---

## Learnings

### Gotchas

- `env -u CLOUDFLARE_API_TOKEN` per deploy su account personale
- Leaflet `invalidateSize()` after split-view resize
- `fitBounds` uniform `padding: [30, 30]`
- `bindPopup({ autoPan: false })` on all markers
- Gemini JSON: always try-catch parse
- Google OAuth state cookie: `SameSite=Lax`
- Nominatim: max 1 req/sec, debounce 500ms
- Alpine.js `x-if` removes DOM, breaks Leaflet — usare `x-show` + `x-cloak` per container mappa
- `JSON.parse()` in getter ritorna nuovi oggetti ogni volta — mutazioni in-memory sono effimere, riscrivere in `activities_json`
- Wrangler v4 asset handler ritorna 405 su POST in locale (SPA mode) — funziona in produzione
- Transport heuristic: haversine * 1.3 = distanza urbana approssimata. Auto-select mode per distanza (<=1.5km walk, 1.5-5km bike/transit, >5km car)
- `removeActivity()` deve ricalcolare `travel_to_next` del precedente e cancellare quello dell'ultimo

---

## Audit Log

| Data | File Modificati | CI Result | Note |
|------|-----------------|-----------|------|
| 2026-03-21 | src/index.ts, static/*.html, static/style.css | - | Initial build: questionnaire, trip view, map, auth |
| 2026-03-22 | static/trip.html, static/style.css | Playwright PASS | Bug fix: pin/refresh persistence, first-load rendering. New: Timeline Gantt view |
| 2026-03-22 | src/index.ts, static/plan.html, static/trip.html, static/style.css, src/index.test.ts | vitest 18/18 + Playwright 31/31 | Timeline: transport segments, color legend, dynamic axis (midnight). Questionnaire: multi-select transport (pills), bike option, removed mix |
| 2026-03-22 | static/trip.html, static/style.css, static/sw.js | Playwright 49/49 | Timeline rewrite: dynamic time engine, readable bars (emoji+time+name), transport strip below bars (80px rows), legend removed, pinned=amber 3px border, mobile vertical timeline, detail emoji, SW v4 |
| 2026-03-22 | static/trip.html, static/style.css, static/sw.js | Playwright 33/33 | Timeline v2: replaced horizontal Gantt with vertical schedule strip. Full-width rows (time+accent+emoji+name+duration), transport connectors, proportional duration fill. Removed all orphaned gantt JS/CSS. SW v6 |
| 2026-03-22 | src/index.ts, static/trip.html, static/my-trips.html, static/style.css, static/sw.js | Playwright PASS | Trip management: PATCH rename endpoint, inline rename + delete in My Trips. Remove activity with transport recalc. Local transport heuristic (haversineKm + estimateTransport). Transport mode override (clickable strips + picker). SW v7 |

---

**Created:** 2026-03-21
**Last updated:** 2026-03-22
