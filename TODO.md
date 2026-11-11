# To-do

## Offline mode for the Home Screen web app

Start with offline support in the existing web app. Consider a native shell later if dependable background downloads or native playback controls become necessary.

- [ ] Add a service worker to cache the app shell, including scripts, styles, fonts, and icons, so Groovy can open without connectivity after an initial online visit.
- [ ] Store library data, episode descriptions, and artwork locally for offline browsing.
- [ ] Add download and delete actions for episodes, with progress, failure, and available-offline indicators. Only mark a download available after it finishes successfully.
- [ ] Play downloaded audio locally, including support for range requests and seeking. Use streaming when no download is available and the device is online.
- [ ] Request persistent storage with `navigator.storage.persist()` and check the result with `navigator.storage.persisted()`. Home Screen installation may help eligibility; persistence must not be assumed.
- [ ] Use `navigator.storage.estimate()` to monitor usage, cap downloads, and offer storage cleanup. Handle quota failures without losing existing downloads or progress.
- [ ] Save listening progress and played/unplayed changes locally while offline, then sync on reconnect. Define how conflicting changes from multiple devices are resolved.
- [ ] Keep offline data isolated by account and define sign-out cleanup so another user cannot access the previous account's library or progress.
- [ ] Detect missing or evicted downloads and allow re-downloading. Persistent storage does not protect against explicit data clearing.
- [ ] Keep online-only actions, such as podcast search and fetching new feeds, clearly identified while offline.
- [ ] Test in the installed iPhone app: airplane-mode launch, playback, seeking, screen lock, Bluetooth, interrupted downloads, storage exhaustion, app updates, and reconnect syncing.

Initial scope: downloads may require keeping Groovy open until they finish. Do not promise background downloads when iOS suspends the web app. The first visit and episode downloads require connectivity.

If these limits are too restrictive, evaluate a native shell that reuses the React UI and Cloudflare backend, with native background downloads, file storage, playback, and media controls. Account for Apple's signing and distribution requirements.

Reference: [WebKit storage policy and persistent storage](https://webkit.org/blog/14403/updates-to-storage-policy/).
