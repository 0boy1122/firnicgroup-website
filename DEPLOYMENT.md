# Deployment Options After Render

This project is a long-running Node server that writes bookings, sessions, room inventory, and editable content to JSON files. Use a host that can either provide persistent storage or connect the app to a database.

## Recommended Free Path: Vercel + Neon Postgres

Vercel can host this project now that writable app data is stored in Postgres through `DATABASE_URL`. Vercel's function filesystem is read-only except temporary scratch space, so do not deploy without the database variable.

1. Push the repo to GitHub.
2. Create a new Vercel project from the GitHub repo.
3. Keep the default build settings. The included `vercel.json` routes all requests through `api/index.js`.
4. Add environment variables:

```sh
DATABASE_URL=postgresql://...
PGSSLMODE=require
ADMIN_PASSWORD=...
GROQ_API_KEY=...
SMTP_USER=...
SMTP_PASS=...
NOTIFY_EMAIL=...
```

Only `DATABASE_URL`, `PGSSLMODE`, and `ADMIN_PASSWORD` are required for the site, admin panel, and persistent data. Groq and SMTP are optional.

On first request, the app creates a `firnic_state` table and seeds room/content data from the repo. Submissions, room availability, and editable content are then stored in Postgres.

## Alternative Free Path: Koyeb + Neon Postgres

Koyeb has a free web Service, but its local filesystem is ephemeral. Use `DATABASE_URL` with a free Postgres provider such as Neon or Supabase so bookings and admin edits persist.

1. Create a free Neon Postgres project.
2. Copy its pooled connection string.
3. In Koyeb, create a Web Service from the GitHub repo.
4. Use the Dockerfile builder if Koyeb asks which builder to use.
5. Set the exposed port to `3000`.
6. Add environment variables:

```sh
DATABASE_URL=postgres://...
PGSSLMODE=require
GROQ_API_KEY=...
ADMIN_PASSWORD=...
SMTP_USER=...
SMTP_PASS=...
NOTIFY_EMAIL=...
```

On first boot, the app creates a `firnic_state` table and seeds room/content data from the repo. Submissions, room availability, and editable content are then stored in Postgres.

## Paid Persistent Disk Path: Railway

Railway is the closest replacement for the current Render setup.

1. Create a new Railway project from the GitHub repo.
2. Set the start command to:

```sh
npm start
```

3. Add the environment variables from `.env.example`:

```sh
GROQ_API_KEY=...
ADMIN_PASSWORD=...
SMTP_USER=...
SMTP_PASS=...
NOTIFY_EMAIL=...
```

4. Add a Railway volume. The app automatically uses Railway's `RAILWAY_VOLUME_MOUNT_PATH`.
5. On first boot, if the volume is empty, the app seeds `content.json` and `rooms.json` from the repo.

Do not rely on the repo `data/` folder for production submissions. Production booking data should live on the mounted volume.

## Good Alternative: Fly.io

Fly works well if you are comfortable with a small Docker-based deployment.

1. Create a Fly app.
2. Create and mount a volume at `/data`.
3. Set secrets:

```sh
fly secrets set GROQ_API_KEY=... ADMIN_PASSWORD=... SMTP_USER=... SMTP_PASS=... NOTIFY_EMAIL=... DATA_DIR=/data
```

4. Deploy using the included `Dockerfile`.

## Possible, But Needs Data Migration: Vercel

Vercel is not a direct fit for this app as-is because Vercel Functions have a read-only filesystem with temporary `/tmp` scratch space. To use Vercel safely, move:

- submissions
- sessions
- room availability
- editable content

to a database such as Supabase, Neon/Postgres, Turso, or Vercel storage.

## Possible: DigitalOcean

DigitalOcean App Platform can run the Node app, but for the current JSON-file datastore you should use a persistent storage option or move the data to a managed database. The included `Dockerfile` is suitable for a DigitalOcean container deployment path.

## Local Run

```sh
npm install
npm start
```

Local data stays in `data/` unless `DATA_DIR` is set.
