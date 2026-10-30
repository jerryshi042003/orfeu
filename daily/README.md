# Daily feed for jerrythegoat.com/orfeu

Muse adds a week of days here every Saturday from the cloud. The page at
https://jerrythegoat.com/orfeu/ reads `daily/feed.json` straight from GitHub and shows a day
only after the `daily-feed` Action has marked it `"status": "ok"`. Dates the site already hosts
(its own `days.json`) always win.

## What to append

One object per date to `days` in `feed.json`. Write only these fields; the Action fills names,
countries and Spotify playlists and sets `status`:

```json
{
 "date": "2026-11-01",
 "culture": { "genre": "salsa", "reel": "https://www.instagram.com/reel/XXXX/", "caption": "Creator name · where it was filmed" },
 "place": { "place": "cali", "reel": "https://www.instagram.com/reel/YYYY/", "caption": "Creator name · neighbourhood" },
 "why": "One line: why this culture belongs to this city."
}
```

- `genre` is a slug from `assets/data/genres.json`; `place` is a slug from `assets/data/locations.json`.
  A scene without a genre uses `"label": "Habibi Funk", "spotify": "track/ID"` instead of `genre`.
- The culture must come from the city's country: `daily/homes.json` lists each culture's countries.
  Add a culture there (real home countries only) before using it.
- `place.reel` is required. `culture.reel` is optional; without it the page shows the genre's photo.
  Reels are linked and embedded from the creator's own post, never downloaded or re-uploaded.
- Never edit or remove an existing day. A rejected day can be fixed by changing that entry.

`node daily/resolve.mjs --dry` runs the same check locally.
