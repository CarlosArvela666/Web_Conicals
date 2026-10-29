# Crónicas Web — technical documentation

A local-network virtual tabletop for D&D 5e. One Node process on the DM's computer serves every screen at the table: the DM console, up to six player devices, and a projector/TV view. All state lives in JSON files under `data/`, and every change is pushed live to all screens.

## Running it

| How | Command | Notes |
|---|---|---|
| Portable Windows build | `CronicasWeb.exe` | Bundles its own Node. Opens the DM view and sits in the tray. See the certificate note below. |
| Any OS with Node ≥ 22 | `node server.js` | Listens on `0.0.0.0:3040`. Prints the LAN addresses to give players. |
| Localhost only | `HOST=127.0.0.1 node server.js` | Nobody else on the network can connect. |

Environment variables: `PORT` (default 3040), `HOST` (default `0.0.0.0`), `CRONICAS_DATA_DIR` (default `./data`).

There are no npm dependencies; the app uses only Node's built-in modules.

### Antivirus / HTTPS certificate note

Antivirus products that scan HTTPS (Norton, Avast, Kaspersky, ESET…) re-sign every HTTPS response with their own root certificate. Windows trusts that root, but Node's built-in certificate list does not, so every call to the D&D API failed with `fetch failed · UNABLE_TO_VERIFY_LEAF_SIGNATURE`. That was the "API is not working" bug.

`server.js` now loads the Windows certificate store at startup using `tls.setDefaultCACertificates`, which needs a recent Node (24.x). Tested here on Node 24.18. If the portable `.exe` bundles an older Node, the startup log prints "Certificados do sistema indisponíveis". In that case, run `node --use-system-ca server.js` (Node 22.15+ / 23.8+) or rebuild the package on Node 24.

## Screens (URLs)

| URL | Who | What |
|---|---|---|
| `/` | anyone | Launcher: pick DM, a player seat, or the projector. Shows the active campaign. |
| `/dm` | Dungeon Master | Tabs: **Mesa** (overview, battle start/stop, ambience, music) · **Encontro** (creatures, initiative, quick heal/damage) · **Mapas** (scene library, tokens, drawing, notes) · **Compêndio** (SRD browser) · **Personagens** (full sheets for all 6 seats) · **Campanhas** (switch/continue/create/delete, backups) · **Registo** (session log and rolls). |
| `/player/1` … `/player/6` | each player | A status bar (portrait, HP, AC, initiative, "your turn!"), then tabs: **Ficha** (full 5e sheet) · **Mapa** (only when the DM reveals it) · **Mesa** (quick dice, roller, roll feeds, revealed creatures) · **Grupo** (party and public log). The chosen tab is remembered per device. |
| `/projector` | TV / projector | Big map, turn tracker, party HP, public rolls and log. Read-only. |

## Architecture

```
server.js          HTTP server, state machine, persistence, SRD proxy + cache
public/index.html  shell
public/app.js      the whole client (render-to-string + event binding)
public/style.css   all styles (dark "grimoire" UI + parchment character sheet)
public/vendor/dice-box-threejs/  3D dice (MIT, vendored, loaded on demand)
public/icons.svg   Lucide icon sprite (ISC licence), used as <svg><use href="/icons.svg#i-NAME"/></svg>
data/              campaign saves, uploaded maps/portraits/music, SRD cache
```

### Data flow

1. A client calls `POST /api/action` with `{role, playerId, type, ...payload}`.
2. `action()` in `server.js` validates the role and mutates `state`, then runs `persist()` + `saveCampaignSnapshot()` + `broadcast()`.
3. Every open screen holds an SSE connection (`GET /api/events?role=…&id=…`) and receives a **role-filtered** copy of the state (`publicState()`):
   - **dm**: everything, plus the campaign list and map-library summaries.
   - **player**: their own full sheet; other players only as public summaries; only visible creatures, public log and public rolls.
   - **projector**: the public party summary, visible creatures, public log and rolls.
4. The client re-renders the whole view from that state. Unsaved form input and focus are kept by `captureDraft()`/`restoreDraft()`. Token moves are replayed as animations by `captureTokens()`/`animateTokens()`.

### HTTP endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state?role=&id=` | One-off state snapshot |
| GET | `/api/events?role=&id=` | Server-sent events stream (`event: state`) |
| POST | `/api/action` | All mutations (see below) |
| GET | `/api/catalog/:kind` | SRD lists: `monsters`, `spells`, `equipment`, `magic-items`, `conditions` (`?q=` filter). Fetched in one GraphQL query each and cached. |
| GET | `/api/resource?url=/api/2014/…` | SRD detail (Portuguese `pt-BR` where translated; `&lang=en` for English). Cached. |
| GET | `/srd-images/monsters/x.png` | Monster artwork, proxied and cached on disk |
| GET | `/maps/*`, `/portraits/*`, `/media/*` | Uploaded files |

### Actions (`type` in `POST /api/action`)

DM-only unless noted.

- **Campaigns:** `create-campaign`, `switch-campaign`, `delete-campaign`, `update-campaign`, `import`
- **Players:** `update-player` (players may edit their own sheet), `toggle-player-visibility`, `portrait-upload` (players: own seat)
- **Creatures:** `add-entity`, `update-entity`, `delete-entity`, `clear-encounter`
- **Combat:** `heal`, `damage`, `effect` (add/remove a condition), `roll` (anyone; the server rolls with `crypto.randomInt`), `roll-initiative`, `start-battle`, `end-battle`, `turn` (`step: ±1`)
- **Ambience:** `set-mode` (`day` | `night` | `normal` | `battle`), `battle-audio`, `media-upload`
- **Maps:** `map-upload` (each upload becomes a new scene), `map-select`, `map-rename`, `map-delete`, `map-visible`, `map-options` (grid), `place-token`, `token-size`, `annotation`, `clear-annotations`, `annotations-visible`
- **Fog of war:** `fog-stroke` (`{mode:'reveal'|'hide', r, points}`, where r is a fraction of the map width), `fog-reset` (`{cover:true}` covers everything, otherwise removes the fog), `fog-undo`
- **Log:** `log`

### Campaign state (`data/campaign.json`)

```jsonc
{
  "campaignId": "uuid",
  "campaign": { "name", "chapter", "mode": "normal|day|night|battle", "round", "activeTurn", "activeName",
                "turnOrder": [{ "kind": "player|monster|boss", "id", "name", "initiative" }] },
  "players": [ /* always 6 seats */ { "id": 1, "name", "character", "hp", "maxHp", "ac", "effects": [], "visible", "sheet": { /* full 5e sheet, see defaultSheet() */ } } ],
  "monsters": [ { "id", "name", "hp", "maxHp", "ac", "cr", "xp", "type", "size", "image", "attacks": [{ "name", "desc", "attack_bonus", "damage": [{ "damage_dice", "damage_type" }] }], "description", "effects", "die", "visible" } ],
  "bosses":   [ /* same shape as monsters */ ],
  "map":  { /* the ACTIVE scene, the same object as one entry of maps[] */ },
  "maps": [ { "id", "name", "url", "visible", "grid", "gridSize", "tokens": { "player:1": { "x": 0.3, "y": 0.5, "size": 42 } }, "annotations": [], "annotationsVisible",
              "fog": { "enabled": false, "base": "covered|clear", "strokes": [{ "mode": "reveal|hide", "r": 0.06, "points": [{ "x": 0.3, "y": 0.5 }] }] } } ],
  "battle": { "audioUrl", "audioName", "volume" },
  "log": [], "rolls": []
}
```

- Token coordinates are **fractions (0–1) of the map image**. The map stage is sized to the image's aspect ratio, so a token lands on the same spot of the image on every screen size. (It used to be a fraction of the letterboxed frame, so tokens drifted between the DM view and the projector.)
- `normalizeCampaign()` upgrades older saves on load and on every campaign switch, filling in `maps[]`, `turnOrder` and sheet defaults.
- Every campaign is also snapshotted to `data/campaigns/<id>.json`, and `data/campaign-index.json` lists them.

### SRD cache

`data/srd-cache/` holds the catalog lists, the details you've opened and monster images. Entries are refreshed after 7 days. If the API is unreachable, the stale copy is served instead, so anything opened once also works offline. Delete the folder to force a refresh. It is ignored by git.

## Client notes (`public/app.js`)

- Everything is rendered as template strings. `render()` → `dmRender()` / `playerRender()` / `projectorRender()`, then `bind()`.
- Buttons declare `data-action="…"`, and the single `handleAction(button)` dispatcher handles them all. `bindActions(scope)` wires a subtree, which the compendium uses for its partial refreshes.
- `icon(name)` returns an inline `<svg><use>` from the sprite. To add an icon, regenerate `public/icons.svg` from `lucide-static` (see `PROGRESS.md`).
- Ambience: `document.body.dataset.mode` tints the whole page, and `.map-frame.mode-*` drives the `.map-ambient` overlay: a night filter, warm day light, or a pulsing red vignette in battle.
- Token motion: tokens are rebuilt on every update, so `animateTokens()` replays each move from the last drawn position (Web Animations API, with a hop and a dashed trail). It respects `prefers-reduced-motion`.
- Map view (zoom/pan) is local to each screen: `mapView[mapId] = {z, x, y}` is applied as a CSS transform on `.map-stage` after every render. `stagePoint()` uses the transformed bounding box, so clicks, drags, the ruler and the fog brush all land on the right spot of the image at any zoom.
- `gridSize` is in pixels of the original image. The grid draws as `background-size: gs/naturalWidth %`, and the ruler converts with the same numbers.
- Fog renders as an SVG mask: base rect white (covered) or black (clear), reveal strokes black, hide strokes white, blurred for soft edges, over a turbulence "cloud" fill. It sits above tokens and notes, and the DM's copy is translucent.
- 3D dice: `watchRolls()` compares `rolls[0].id` after each update and animates up to 3 new rolls through a queue. `animateRoll()` calls `box.roll("NdS@v1,v2")`, so the dice land on the server's result. The library loads with `import()` the first time a roll happens, and the toggle is stored in `localStorage['cronicas-dice3d']`.
