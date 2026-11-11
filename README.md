# Groovy

A mobile-first RSS podcast player for iPhone Safari and Android Chrome. React + TypeScript with Cloudflare Workers Static Assets, a Worker API, and D1 for accounts, subscriptions, progress, and preferences.

## Local setup

Use Node 22.13 or newer (tests use Node's built-in SQLite).

```sh
npm ci
npm run db:migrate
npm run user -- my-account
```

The user command prompts for your chosen password twice, without echoing it, and prints a JSON entry containing its salted hash. Create `.dev.vars` with the complete user map on one line (replace the example hash with the actual output):

```dotenv
USER_PASSWORD_HASHES='{"my-account":"scrypt$32768$8$3$..."}'
```

Then start the app:

```sh
npm run dev
```

Open the URL Vite prints and enter the password you chose. The account ID is an administrator identifier; listeners enter only their password. No Cloudflare login or database write happens during hash generation.

`npm run dev` builds the assets and starts both Vite and Wrangler; Ctrl+C stops both. Vite proxies `/api` to Wrangler on port 8788; Wrangler watches the Worker API files; Vite handles frontend hot reload. To preview the production build alone, use `npm run build` followed by `npm run preview`. `.dev.vars` is ignored by Git. Manual RSS entry works without directory credentials; search uses Podcast Index and requires both credentials below.

For podcast search, get a key and secret from [Podcast Index](https://api.podcastindex.org/) and add both to `.dev.vars`:

```dotenv
PODCAST_INDEX_KEY='your-key'
PODCAST_INDEX_SECRET='your-secret'
```

Set both as Worker runtime secrets for production, then deploy the updated code:

```sh
npx wrangler secret put PODCAST_INDEX_KEY
npx wrangler secret put PODCAST_INDEX_SECRET
npm run deploy
```

RSS feeds and existing libraries still work without search credentials.

## Deploy to your Cloudflare account

The Worker and D1 database are both named `groovy`. The existing database ID is retained in `wrangler.jsonc`; this migration does not require a new database or schema migration. The D1 binding stays `DB`.

1. Run `npx wrangler login`. For a fresh installation only, create a database with `npx wrangler d1 create groovy` and put its ID in the existing `DB` binding.
2. Apply any pending schema migrations: `npx wrangler d1 migrations apply groovy --remote`.
3. Run `npm run user -- my-account`, choose a password, and merge the printed entry into the complete `USER_PASSWORD_HASHES` object. Keep existing account IDs to retain their libraries. Set the **Worker runtime secret** with:

   ```sh
   npx wrangler secret put USER_PASSWORD_HASHES
   ```

   Paste the complete JSON object containing all users. A secret previously set on a Pages project is not copied to a Worker. If Wrangler offers to create the `groovy` Worker, accept. For later updates, this command updates the Worker's secret; preserve a copy of the complete map in your password manager because Cloudflare does not return existing secret values.
4. Run `npm run deploy`. This builds the frontend and runs `wrangler deploy`, uploading the API and assets together. Open the printed `workers.dev` URL and test login, subscriptions, playback, and paused restoration. `.dev.vars` is local-only and is not uploaded.

For Git-based deployment, use **Workers & Pages → Create application → Import a repository**, select `naveenv92/groovy`, and create a Worker named `groovy` (or use the existing Worker). Set production branch `main`, root directory to the repository root, build command `npm run build`, deploy command `npx wrangler deploy`, and build environment variable `NODE_VERSION=22`. Static output is configured as `dist` in Wrangler; there is no Pages output-directory setting. If a non-production branch deployment command is requested, use `npx wrangler versions upload`. Set `USER_PASSWORD_HASHES` under the Worker's runtime Variables and Secrets, not just the build environment. Pushes to `main` then deploy automatically.

`worker/index.ts` routes `/api` and `/api/*` to the API; all other requests use the `ASSETS` binding. The assets configuration serves the SPA for app navigation, while API routes always reach the Worker. The existing `public/_headers`, icons, and web-app manifest are included in the frontend build.

Never upload `.dev.vars` or account passwords. If migrating from an already hosted site, changing its origin requires signing in again; data remains in the same D1 database. A Home Screen shortcut for the old URL must be re-added using the new URL unless you retain the same custom domain.

## Behavior

- Search Podcast Index or open a public RSS URL, then follow shows in your library. Feeds and search results are cached for 15 minutes. Feeds are limited to 12 MB, 500 items, and four redirects. RSS 2.0 audio enclosures are supported; Atom and private feeds are outside v1.
- Audio streams directly from publishers. The player’s speed modal can save a per-podcast override; its knob turns green when one is active. General playback settings set the default speed without changing podcast overrides. Native audio provides pitch-preserving 0.5×–2× speed, seeking, and independently configurable 5–120 second skips (15 back / 30 forward by default).
- Progress syncs every 10 seconds during playback, on pause, when switching episodes, and on page hide on a best-effort basis. On refresh or login, the most recently listened-to unfinished episode reopens paused at its saved position. Playback never starts automatically. Older history is restored from the publisher feed when available. The latest server write wins across devices.
- Passwords are chosen by you (1–256 characters, including spaces and Unicode) and hashed with salted scrypt (`N=32768, r=8, p=3`, 32-byte output). The `USER_PASSWORD_HASHES` secret maps stable account IDs to these hashes. Each person must have a different password because login has no username. Use long, unique passwords.
- The user map is one JSON object, for example `{"naveen":"scrypt$...","friend":"scrypt$..."}`. Merge entries when adding users; replacing the object with only a new user disables everyone omitted. Neither passwords nor hashes belong in Git, Wrangler's public variables, or `VITE_` variables.
- Accounts are created in D1 on first successful login. D1 stores a fingerprint of the configured hash to validate sessions; the secret is the source of authentication. Keep the same account IDs when moving existing users to this setup so their libraries and progress are retained. Existing database-only passwords are no longer accepted; configure each user in the secret before deploying this change.
- Rotate a password by generating a new hash for the same account ID, updating the secret, and redeploying. Changed or removed entries invalidate existing sessions. Sessions otherwise expire after 30 days. Login is limited to 10 attempts per IP per 15 minutes.
- Password-only login verifies each configured account sequentially. It is intended for a small manually managed user list; login cost grows with that list. Node crypto compatibility is enabled in `wrangler.jsonc`.
- Feed fetches validate URLs and redirects, check public DNS addresses, limit response size/time, and reject XML entity/DOCTYPE declarations. The Worker must have no private-network or service bindings for arbitrary publisher requests.
- Media Session publishes title, podcast name, artwork, position, and supported playback actions. The phone OS handles Bluetooth output. Car artwork and controls are best effort, depending on browser, OS, and receiver. No Web Bluetooth pairing is needed.
- Screen-locked playback uses the native audio element. The browser must remain alive; offline downloads and playback after browser termination are outside v1. Publisher codecs, HTTPS availability, and seeking support can affect playback.

## Checks

```sh
npm test
npm run build
npx wrangler deploy --dry-run --outdir /tmp/groovy-worker
```

After pulling schema changes, run `npm run db:migrate` locally and `npx wrangler d1 migrations apply groovy --remote` before deploying.

Tests cover Worker API/asset routing, deployment configuration, RSS parsing and metadata fallbacks, malformed XML, URL/DNS restrictions, fetch limits, login/session security, account isolation, settings validation, progress persistence, and secret-based credential rotation using an in-memory SQLite database, plus scrypt and secret validation checks.

Before release, test the actual iPhone, Android phone, and car: login → search or paste RSS → follow → play → change speed → skip → reload → resume. Check natural pitch, screen lock, backgrounding, Bluetooth reconnects, car title/artwork updates between episodes, and car play/pause/seek buttons. Test publisher failures, missing artwork, and slow connections. No physical device or browser automation verification has been performed in the restricted build environment.
