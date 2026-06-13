# Deployment Options After Render

This project is a long-running Node server that writes bookings, sessions, room inventory, and editable content to JSON files. Use a host that can either provide persistent storage or connect the app to a database.

## Recommended: Railway

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
