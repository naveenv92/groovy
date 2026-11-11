# Groovy

A mobile-first RSS podcast player for iPhone Safari and Android Chrome. React + TypeScript on Cloudflare Pages, Pages Functions for the API, and D1 for accounts, subscriptions, progress, and preferences.

## Local setup

Use Node 22.13 or newer (tests use Node's built-in SQLite).

```sh
npm ci
npm run db:migrate
npm run user -- my-account
npm run build
npm run preview
```

Open the URL Wrangler prints and log in with the generated password. The account name is only an administrator identifier; listeners enter just their password. Save the password securely: only its digest is stored. Running the user command again rotates the password and revokes existing sessions without removing listening data.

For frontend development, keep `npm run preview` running on port 8788 and run `npm run dev` in another terminal. Vite proxies `/api` to Wrangler; rebuild when changing Functions. `.dev.vars` is ignored by Git. Manual RSS entry works without directory credentials; search works without credentials through Apple’s podcast directory.

## Deploy to your Cloudflare account

1. Run `npx wrangler login` and `npx wrangler d1 create groovy`. Replace the placeholder `database_id` in `wrangler.jsonc` with the returned ID.
2. Run `npx wrangler d1 migrations apply groovy --remote`.
3. Run `npm run build`, then `npx wrangler pages project create groovy --production-branch main` and `npx wrangler pages deploy dist --project-name groovy`.
4. Run `npm run user -- my-account --remote` to provision each listener, then share their generated password privately.

The Cloudflare Pages project is named `groovy`. The D1 database is named `groovy`. The D1 binding is named `DB`. For Git-based Pages builds, use `npm run build`, output directory `dist`, and the repository root. Pages discovers the `functions` directory automatically. Never upload `.dev.vars` or account passwords. `npm run deploy` builds and deploys to Pages; add `--project-name groovy` to Wrangler if prompted to select a project.

## Behavior

- Search Apple’s podcast directory or open a public RSS URL, then follow shows in your library. Feeds and search results are cached for 15 minutes. Feeds are limited to 4 MB, 500 items, and four redirects. RSS 2.0 audio enclosures are supported; Atom and private feeds are outside v1.
- Audio streams directly from publishers. Native audio provides pitch-preserving 0.5×–2× speed, seeking, and independently configurable 5–120 second skips (15 back / 30 forward by default).
- Progress syncs every 10 seconds during playback, on pause, when switching episodes, and on page hide on a best-effort basis. On refresh or login, the most recently listened-to unfinished episode reopens paused at its saved position. Playback never starts automatically. Older history is restored from the publisher feed when available. The latest server write wins across devices.
- Password-only accounts use generated 192-bit secrets. SHA-256 digests are appropriate for these random credentials; do not replace them with short human passwords. Sessions expire after 30 days; login is limited to 10 attempts per IP per 15 minutes. Account rotation revokes every session for that account.
- Feed fetches validate URLs and redirects, check public DNS addresses, limit response size/time, and reject XML entity/DOCTYPE declarations. The Worker must have no private-network or service bindings for arbitrary publisher requests.
- Media Session publishes title, podcast name, artwork, position, and supported playback actions. The phone OS handles Bluetooth output. Car artwork and controls are best effort, depending on browser, OS, and receiver. No Web Bluetooth pairing is needed.
- Screen-locked playback uses the native audio element. The browser must remain alive; offline downloads and playback after browser termination are outside v1. Publisher codecs, HTTPS availability, and seeking support can affect playback.

## Checks

```sh
npm test
npm run build
npx wrangler pages functions build --outdir /tmp/groovy-functions
```

After pulling schema changes, run `npm run db:migrate` locally and `npx wrangler d1 migrations apply groovy --remote` before deploying.

Tests cover RSS parsing and metadata fallbacks, malformed XML, URL/DNS restrictions, fetch limits, login/session security, account isolation, settings validation, progress persistence, and credential rotation using an in-memory SQLite database.

Before release, test the actual iPhone, Android phone, and car: login → search or paste RSS → follow → play → change speed → skip → reload → resume. Check natural pitch, screen lock, backgrounding, Bluetooth reconnects, car title/artwork updates between episodes, and car play/pause/seek buttons. Test publisher failures, missing artwork, and slow connections. No physical device or browser automation verification has been performed in the restricted build environment.
