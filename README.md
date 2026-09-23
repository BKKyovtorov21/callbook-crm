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
- **Backend:** Node.js, Express, Redis (Upstash via Vercel in production; a local JSON file in development), zod validation
- **Shared:** TypeScript domain types and date logic used by both sides (`shared/`)

```
server/   API: db schema, service layer (business rules), routes, validation, demo seed
shared/   types, date math (follow-up calculation), URL/phone helpers
src/      React app: pages/, components/, lib/ (api client, store, derived stats)
tests/    end-to-end workflow tests against the API
```

Data model: `leads` 1–n `interactions`, `leads` 1–n `reminders`, `leads` 1–1 `projects`, `leads` 1–n `activities` (the automatic timeline), plus `settings`.
Each entity is a JSON record in a Redis hash (`crm:leads`, `crm:projects`, `crm:reminders` for open reminders, `crm:lead:<id>:interactions|activities|reminders` for per-lead history). Every request reads what it needs in one round trip, then applies all its writes atomically (`MULTI/EXEC`) — see `server/store.ts`.
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

Locally the data lives in `data/crm.json` (set `DATA_FILE` to change it). A `data/crm.db` from an older version is imported automatically on first start. If Redis credentials are set (see below), it uses Redis instead.

## Deploy to Vercel (with Vercel's Redis)

Vercel can't keep files between requests, so production stores data in **Redis** from Vercel's Storage tab (Upstash). `vercel.json` makes Vercel run `npm run build:vercel`. That build packages the site plus one serverless function for `/api/*` ([Build Output API](https://vercel.com/docs/build-output-api/v3)).

1. **Create the database.** In Vercel, open the project → **Storage** → **Create Database** → **Upstash for Redis** (or connect an existing one). Pick the region your functions run in; the default is Washington, D.C. (iad1). Connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
2. **Set a password.** In Settings → Environment Variables, add `APP_PASSWORD` with the password you'll log in with (**required on a public URL**).
3. **Redeploy.** Push to `main`, or use Deployments → Redeploy.
4. **Copy your local data to Redis (optional, one time).** In the Redis database page, open the **.env.local** tab and copy the values into `.env.local` in this folder (git ignores this file). Then run:

   ```bash
   npm run db:push
   ```

   This refuses to overwrite a Redis database that already has leads. Pass `--force` to replace it: `npm run db:push -- --force`.

The API also accepts `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, or a plain `REDIS_URL` (e.g. Redis Cloud).

## Deploy anywhere else (Docker)

Any always-on host works (Railway, Render, Fly.io, a VPS). It uses Redis if you set the variables above; otherwise it uses a JSON file on a persistent volume.

```bash
docker build -t callbook .
docker run -p 3000:3000 -v callbook-data:/data -e APP_PASSWORD=choose-one callbook
```

| Env var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default 3000) |
| `DATA_FILE` | JSON data file when not using Redis (Docker default `/data/crm.json`) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis (set automatically by Vercel's Redis integration) |
| `REDIS_URL` | Any Redis server, used if the REST variables aren't set |
| `APP_PASSWORD` | Turns on the login screen. **Set this on any public deployment.** |
| `SEED_DEMO=false` | Skip loading demo data on first start |
