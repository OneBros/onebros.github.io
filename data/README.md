# Onebros data

All site content lives in these JSON files. The HTML pages only render them.

| File | Contents |
| --- | --- |
| `games.json` | `submitRunUrl` (the Run Submissions Form opened by every "Submit a run" button), `discordUrl` (the community Discord invite behind every "Join the Discord" button; the buttons stay hidden while it is empty), role tracks and roles, and every game: id, title, year, per-game role names (`roleNames`), and whether its page is published (`"page": true`). `defaultRoles` and a game's `roles` list are reference data only (not displayed); a game page shows its roles through the tiers in `games/<id>.json`. |
| `games/<id>.json` | Full rules for one game (e.g. `games/des.json`). Only needed when `"page": true`. |
| `runners.json` | Verified runners and the roles/challenges they completed. |
| `staff.json` | Staff page: roles, groups (sections, in display order; a group can hold several roles, e.g. Moderation = Admin + Moderator) and staff members. See [Staff](#staff). |
| `rules.json` | General / Overarching Rules shown on the homepage. Each section has `content` and/or `subsections`. A content block is a paragraph (string), `{ "list": [...] }`, or `{ "note": "...", "text": "..." }`. A section with `"exception"` (No Hit) is shown apart from the regular rules, and is also shown on every game page's No Hit section. |

## Roles

Roles are split into two separate tracks in `games.json`:

| Track | Role ids (lowest → highest) |
| --- | --- |
| `onebros` — Onebros challenge rules | `champion`, `legend`, `master`, `elitemaster`, `grandmaster` |
| `nohit` — Team Hitless ruleset | `hitless-scholar`, `hitless-sage` |

No Hit roles are never a sub-tier of Legend/Master; they are listed and grouped separately everywhere.
A game can rename Onebros roles with `roleNames` (Demon's Souls: Slayer / Monumental / Old One).

## Adding a runner

Append an object to the **end** of the `runners` array in `runners.json`:

```json
{
  "id": "runner-id",
  "name": "DisplayName",
  "avatar": "https://link-to-profile-picture.jpg",
  "profile": "https://www.youtube.com/@channel",
  "addedAt": "2026-09-28T14:05:00Z",
  "games": [
    {
      "game": "des",
      "role": "master",
      "challenges": [
        { "title": "Challenge name", "proof": "https://www.youtube.com/watch?v=...", "completedAt": "2023-10-10" }
      ]
    },
    {
      "game": "des",
      "role": "hitless-scholar",
      "challenges": [
        { "title": "Challenge name", "proof": "https://www.youtube.com/watch?v=..." }
      ]
    }
  ]
}
```

- `id`: unique, lowercase, no spaces.
- `avatar`: profile picture path or URL (local files go in `assets/runners/`). Shown as a circle
  (cropped by CSS only). If it is empty or fails to load, the runner's initial is shown.
- `profile`: an external page for this runner (normally YouTube, or a Team Hitless profile).
  Shown as a link on their runner page (`runner.html?runner=<id>`). Use `null` when there is none.
  The picture and name on runner cards open that runner page, not this URL.
- `challenges`: may be `[]` when only the role is verified; the card then shows just "Game — Role".
  Never add placeholder titles or URLs.
- `games[].proof` (optional): proof link for a role-only run with no challenge title (e.g. a
  Champion run). The role name on the card ("Champion") becomes the link. Runs with challenges
  keep their links on `challenges[].proof`.
- `addedAt` (every new runner): when the entry was **added to the Onebros site**. Used for the
  homepage Recent Runs: newest added first, unless the game/role entry has its own `addedAt`.
  Runners with the same `addedAt` keep their order in this file, the one further down (added
  later) first; runners without `addedAt` come after all dated ones.
  It is about the site listing, not the achievement.
- `games[].addedAt` (optional): when this one game/role entry was added to the site, when it was
  added later than the runner (e.g. a new role for an existing runner). The homepage "Verified
  Runs" list (the ten most recent) orders entries by this, falling back to the runner's `addedAt`,
  newest first. Do not change the runner's `addedAt` for a new entry.
- **Format for both `addedAt` fields:** write new additions as a full UTC timestamp,
  `YYYY-MM-DDTHH:MM:SSZ` (e.g. `2026-10-06T16:39:26Z`), so additions made on the same day still
  sort in the order they were added. Always use UTC with `Z`, never a local offset like
  `+03:00`: the values are compared as text. Older date-only values (`YYYY-MM-DD`) stay valid;
  they sort before any timestamp of the same day, and only an exact tie falls back to the
  position in this file.
- `challenges[].completedAt` (optional): completion date, `YYYY-MM-DD`. Source priority:
  (1) independently documented actual completion; (2) otherwise the publication date of the
  most recently published relevant proof video; (3) otherwise the calendar day of the entry
  `addedAt`, falling back to the runner's `addedAt`. Never use submission or verification
  dates as completion dates. A publication proxy or site-addition fallback does not establish
  the actual day the challenge was completed. For YouTube, retain the calendar day from the
  source `publishDate` metadata without UTC conversion; inspect every relevant playlist video,
  rather than assuming the last playlist item is newest. Record the source when backfilling
  or correcting dates. Keep `addedAt` independent and unchanged.
- Sorting: Recent Runs use entry/runner `addedAt`; the homepage game filter keeps tier then
  entry completion date, with its existing `addedAt` tie-breaker. The Runners directory uses
  each runner's newest challenge `completedAt` across all games. Profiles keep game groups,
  ordered by their highest tier, then the Games menu order from `games.json`;
  entries within each group use tier then completion, and challenges use completion descending.
  Hall of Fame keeps its tier groups and orders entries within each by their newest challenge
  completion. No Hit remains in its existing separate track, with the same date ordering.
  Missing completion dates sort after dated ones within the applicable tier/group. Directory
  and Hall of Fame date ties use later runner position in this file first; challenge ties keep
  their input order. No `addedAt` fallback is applied by those completion comparators.
- Neither date is shown on the cards yet.
- `games[]`: one entry per role a runner holds in a game. A Onebros role and a No Hit role
  in the same game are two separate entries.
- `games[].game`: a game `id` from `games.json` (`des`, `ds1`, `ds2`, `ds3`, `bb`, `sekiro`, `er`).
- `games[].role`: a role id from the table above. Pages show the game's own name where it has one.
- `challenges[].title`: shown as the link text. `proof` is the video URL it opens.
  An empty `proof` shows the title as plain text.

### Completion-date audit (2026-10-12)

All 70 challenges were reviewed. For 69, exact YouTube publication metadata supplies the
publication proxy; independently documented actual completion dates were not available.
Only Soul (`reaper8475`), `ds1` / `legend`, remains unverified and retains `2026-10-05`
from the existing `runner.addedAt`. This is a conventional sorting fallback, not a verified
completion or publication date. The other twelve former site-addition fallbacks now use
confirmed publication dates. The completion comparators themselves never substitute `addedAt`.

## Importing and validating runner changes

Run `npm run validate` and `npm test` before submitting runner data. GitHub Actions
runs both checks on pushes and pull requests. The validator rejects invalid calendar
dates, missing challenge completion dates, duplicate runner IDs/names, duplicate
game/role entries and repeated proofs within a game/role. YouTube video/playlist IDs
are case-sensitive; tracking parameters do not create a distinct challenge.

The tracker importer accepts optional CSV columns `Completion Date` and
`Proof Publication Date`, both strictly `YYYY-MM-DD`. Populate them only after
reviewing the actual completion evidence or exact publication metadata. For a playlist,
inspect all relevant videos and supply the most recently published video's calendar
day, regardless of playlist position. The importer performs no metadata retrieval.
`Checked Date`, `Timestamp`, submission dates and verification dates are ignored.
An absent documented date uses entry `addedAt`, otherwise runner `addedAt`.

New runners and new game/role entries receive the actual import-time UTC `addedAt`.
Normal reimports preserve existing names, profiles, avatars, proofs and dates, including
empty fields. Corrections to existing dates require an explicit reviewed JSON edit;
the importer does not perform them. Use `runner-aliases.json` to resolve alternative
names to existing IDs. `--replace` remains an explicit destructive rebuild option;
matching existing challenges retain their data and dates.

For a new challenge in an existing game/role entry, review whether that entry needs
an explicit `addedAt` correction so it appears in Recent Runs: the current schema has
one site-addition date per game/role, not per challenge. The importer preserves any
existing value. Onebros and Hitless follow the same date rules; Hitless remains its
separate track.

Validation checks structure and calendar validity, not the truth of a supplied date.
Include the evidence and source choice in the pull request for human review.

## Staff

A staff member who is also a runner is linked to their `runners.json` entry when their `id`,
`username` or `name` matches the runner's `id` or `name` (no duplicate runner is needed). Their
staff card then opens the runner page, and runner cards show the staff name and picture.

Staff avatars are curated by hand and always win:

- A staff `avatar` is never replaced by the runner's avatar or a YouTube picture. YouTube URLs
  are links only.
- Files in `assets/staff/` belong to `staff.json`. Some runner records reuse one as their
  `avatar`; never overwrite a staff file to change a runner's picture. Give the runner its own
  file in `assets/runners/` instead. The avatar scripts only write to `assets/runners/` and
  `runners.json`.

Group order in `groups` is the section order; within a group people follow the group's `roles`
order (e.g. Admin before Moderator), then file order. Each person appears once, in the first
group matching any of their roles, with a badge for every role they hold.

## Adding a game page

1. Create `games/<id>.json` with the same structure as `games/des.json`:
   - `tiers`: one per Onebros role, in progression order, each with `role`, `content`,
     `challengesTitle` and `challenges` (`{ title, items }`).
   - `restrictions` (optional): `{ title, groups: [{ type, title, items }] }`.
   - `noHit` (optional): `{ content, roles: [{ role, content }] }` with roles
     `hitless-scholar` / `hitless-sage`. Shown as a separate track, never as a tier.
2. In `games.json`, set that game's `"page": true`, list its Onebros roles in `roles`
   (e.g. add `elitemaster`), and fill in `roleNames` if the game uses its own names.
3. Optional images in `games.json` (files go in `assets/games/`):
   - `"logo": { "src", "width", "height", "blend" }` — the page's cinematic hero: large and
     centred, it replaces the visible text title (the text stays available to screen readers).
     Use `"blend": "screen"` for a logo drawn on a black background. With a logo only (as
     Demon's Souls), the hero is the logo on the site background.
   - `"hero": { "src", "width", "height", "alt", "position" }` (optional) — background artwork
     behind the logo, cropped to fill.
   - `"cardBackground": { "src", "position" }` (optional) — artwork behind the game's card on
     the homepage, behind each homepage / Runners page runner card whose top role is in this game,
     and behind that game's run cards on a runner page, cropped to fill under a dark overlay.
   - `"pageBackground": { "src", "position" }` (optional) — full-page artwork behind the game page,
     and the hero background of every runner page whose highest-tier run is in this game
     (falls back to `cardBackground`). `position` is a CSS
     `background-position` (default `center`). Aim for about 1600×900 WebP (as
     `des-background.webp`). Cards without it keep the plain background.

No HTML or JavaScript changes are needed. The page is served at `game.html?game=<id>`.

### Rule text format

`content` is a list of blocks: a string (paragraph), `{ "list": [...] }`,
`{ "note": "...", "text": "..." }`, or a link `{ "label": "Proof example:", "text": "...", "url": "https://..." }`.
List items are strings or `{ "text": "...", "items": [...] }`.
Inside any rule text, `**double asterisks**` render as bold.
