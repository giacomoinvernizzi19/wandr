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
| **Status** | New |

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
npx wrangler dev     # Development server
npx wrangler deploy  # Production deploy (--branch main!)
```

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

- `--branch main` per CF Pages deploy
- Leaflet `invalidateSize()` after split-view resize
- `fitBounds` uniform `padding: [30, 30]`
- `bindPopup({ autoPan: false })` on all markers
- Gemini JSON: always try-catch parse
- Google OAuth state cookie: `SameSite=Lax`
- Nominatim: max 1 req/sec, debounce 500ms

---

## Audit Log

| Data | File Modificati | CI Result | Note |
|------|-----------------|-----------|------|
| - | - | - | - |

---

**Created:** 2026-03-21
**Last updated:** 2026-03-21
