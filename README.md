# Callbook: a cold-calling CRM

A fast personal CRM for cold-calling local businesses and selling them websites.
It combines a call tracker, sales pipeline, follow-up reminders and website-project tracker for one person working through many prospects.

**Main workflow:** find a business → add the lead → call → record the result → the follow-up is scheduled automatically → follow up → interested → won → website project → track the project → add the website link → complete.

## Features

- **Dashboard.** Opens on "what should I do right now": 🔥 Call now, ⚠️ Overdue, 📅 Upcoming, 🚧 Active projects and key stats.
- **Call Mode.** Shows one lead at a time with big buttons and keyboard shortcuts (`C` call, `D` called, `X` no answer, `I` interested, `R` not interested, `L` later, `A` note, `→` skip). **Called** asks for a short note, schedules the follow-up and moves on.
- **Automatic follow-ups.** Every contact schedules the next follow-up (default **7 days**; you can pick 1/3/7/14/30 days or a custom date). A new contact recalculates it from the new contact date, and non-working days can be skipped.
- **Reminders.** Grouped as Overdue, Today and Upcoming. Mark them completed or snooze them for 1/3/7 days or to a custom date. Sidebar badges and optional browser notifications (at most once a day per type, only during working hours) keep you on track.
- **Leads.** A searchable, filterable table or a drag-and-drop **Kanban** board (New, Contacted, Interested, Negotiating, Won, Not Interested, Follow Up Later, Lost).
- **Quick actions** everywhere: Called, No answer, Interested, Not interested, Follow up later, Won. **Won** creates the website project.
- **Lead detail page.** One place for contact and sales info, follow-up, website links (visit, open and copy), the project, notes, interaction history and the activity timeline.
- **Projects.** Nine stages with a visual progress bar, price / paid / remaining, deadlines, and preview and live links.
- **Global search** (`/` or `⌘K`) across name, contact, phone (in any format), email, notes and location.
- **Analytics.** Calls per week/month, conversion rate, revenue, a weekly chart and a Calls → Interested → Won funnel.
- **Settings.** Default follow-up period, working days and hours, time zone, currency, phone country, notifications and dark/light/system theme. You can also export a backup and load or remove the demo data.

The first run loads about 12 fictional **demo** businesses, each marked with a `DEMO` tag. Remove them in Settings → Data.

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, React Router, dnd-kit, Recharts
- **Backend:** Node.js, Express, SQLite (`better-sqlite3`), zod validation
- **Shared:** TypeScript domain types and date logic used by both sides (`shared/`)

```
server/   API: db schema, service layer (business rules), routes, validation, demo seed
shared/   types, date math (follow-up calculation), URL/phone helpers
src/      React app: pages/, components/, lib/ (api client, store, derived stats)
tests/    end-to-end workflow tests against the API
```

Data model: `leads` 1–n `interactions`, `leads` 1–n `reminders`, `leads` 1–1 `projects`, `leads` 1–n `activities` (the automatic timeline), plus `settings`.
Website links (existing / preview / live) are stored on the lead, so they're available before and after a deal.

## Run locally

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173 (API on :3001)
```

```bash
npm test           # API workflow tests
npm run build      # typecheck + build frontend and server
npm start          # production server on $PORT (default 3000)
```

The database is `data/crm.db`. Set `DATABASE_PATH` to change it.

## Deploy

Any host with a persistent disk works (Railway, Render, Fly.io, a VPS). The app needs a writable disk for the SQLite database, so serverless hosts like Vercel aren't a fit.

```bash
docker build -t callbook .
docker run -p 3000:3000 -v callbook-data:/data -e APP_PASSWORD=choose-one callbook
```

| Env var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `DATABASE_PATH` | SQLite file (Docker default `/data/crm.db`) |
| `APP_PASSWORD` | Turns on HTTP Basic auth (any username). **Set this on any public deployment.** |
| `SEED_DEMO=false` | Skip loading demo data on first start |
