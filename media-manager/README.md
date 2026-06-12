# Media Manager Feature — Installation Guide

## Files in this zip

```
configure/src/components/sections/MediaManager.tsx   ← NEW file (copy to repo)
addon/mediaManagerRoutes.js                          ← NEW file (copy to repo)
addon/applyOverride.js                               ← NEW file (copy to repo)
addon/INDEX_JS_CHANGES.js                            ← READ THIS — shows what to change in index.js
configure/src/components/SETTINGSLAYOUT_CHANGES.js   ← READ THIS — shows what to change in SettingsLayout.tsx
```

---

## Step 1 — Copy new files to your repo

Copy these files directly into your repo (no existing files changed):

| File in this zip | Copy to |
|---|---|
| `configure/src/components/sections/MediaManager.tsx` | `configure/src/components/sections/MediaManager.tsx` |
| `addon/mediaManagerRoutes.js` | `addon/mediaManagerRoutes.js` |
| `addon/applyOverride.js` | `addon/applyOverride.js` |

---

## Step 2 — Edit addon/index.js (2 small changes)

Open `addon/index.js` and make these changes:

### 2a. Add requires near the top (after other requires)

```js
const { registerMediaManagerRoutes } = require('./mediaManagerRoutes');
const { applyOverride } = require('./applyOverride');
```

### 2b. Call registerMediaManagerRoutes after addon is created

Find where `const addon = express()` is (or similar), and add after it:

```js
registerMediaManagerRoutes(addon);
```

### 2c. Replace the TRAILER OVERRIDE block

Find this comment in index.js:
```
// --- TRAILER OVERRIDE (runs after cache, always fresh) ---
```

Replace the **entire block** from that comment to the closing `}` with the code
from `INDEX_JS_CHANGES.js` (the block starting with `// --- TRAILER OVERRIDE`).

---

## Step 3 — Edit configure/src/components/SettingsLayout.tsx (2 small changes)

### 3a. Add lazy import

Find:
```ts
const LazyRatingPage = lazy(() => import('./RatingPage'));
```

Add after it:
```ts
const LazyMediaManager = lazy(() =>
  import('./sections/MediaManager').then((module) => ({ default: module.MediaManager }))
);
```

### 3b. Add to settingsPages array

Find the `settingsPages` array and add this entry before the closing `] as const;`:
```ts
{ value: 'media-manager', title: 'Media Manager', Component: LazyMediaManager, icon: Film },
```

---

## Step 4 — Push to GitHub → Render deploys

After all changes, push to GitHub. Render will rebuild automatically.

---

## How it works

1. Go to your configure page → **Media Manager** tab
2. Search for any movie or series
3. Click it to select
4. **Trailer tab**: Paste a YouTube URL or video ID → Save
5. **Artwork tab**: Paste URLs for poster, background, logo, thumbnail → Save
6. **Metadata tab**: Override title, year, description → Save

Changes apply **instantly** on the next time that movie is opened in Stremio.
Manual overrides always win over AI-fetched trailers and TMDB data.
To revert to automatic behavior, click **Clear** to remove the override.

---

## Storage

Overrides are stored in Redis under keys: `override:v1:<stremioId>`
TTL: 1 year. Clearing an override deletes the key immediately.
