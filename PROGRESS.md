# Crónicas Web — progress & roadmap

The technical reference is in [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md). This file tracks what's done, what's broken and what's next.

Legend: ✅ done · 🟡 partial · ⬜ to do · 🐞 known bug

---

## v2.1 — 2026-10-29

### Fixed
- ✅ **D&D API "not working"**: Norton antivirus HTTPS scanning made every Node `fetch` fail with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. The server now trusts the Windows certificate store, and the error message shows the real cause.
- ✅ **Blank buttons on the character sheet**: button text inherited the parchment's dark ink colour on dark buttons. The sheet buttons have their own light style now.
- ✅ **Tokens drifted between screens**: positions were relative to a letterboxed frame. The map stage now follows the image's aspect ratio.
- ✅ **Initiative corrupted stats**: rolling initiative overwrote each actor's initiative bonus with the rolled total, so every later roll added a bigger bonus.
- ✅ "Colocar nota" (map note) button never turned on.
- ✅ The "delete campaign" confirm box came pre-filled with `APAGAR`, so it confirmed nothing.
- ✅ Removing a creature left its token and its place in the turn order.
- ✅ The player sheet overflowed sideways on phones, and so did the DM Compendium and Characters tabs.

### Added
- ✅ **Full SRD integration** through dnd5eapi.co: monsters (with artwork), spells, equipment, magic items and conditions. One GraphQL call per list, with rich metadata (CR, type, HP, level, school, rarity, damage, cost), and Portuguese details where translated.
- ✅ **Offline SRD cache** (`data/srd-cache/`): anything opened once also works without internet.
- ✅ **Compendium tab (DM)**: search and filters (CR band or creature type, spell level, rarity, equipment category), full stat blocks.
  - Monsters: add N copies to the encounter as monsters or bosses, keeping image, CR, XP, attacks and initiative bonus.
  - Spells, equipment and magic items: "give to player" fills an empty sheet row (weapons also fill an attack row).
  - Conditions: apply to any player or creature.
- ✅ **Monster attack buttons**: one click rolls to-hit (d20 + bonus) and then the damage dice, logged as "Goblin · Cimitarra · ataque".
- ✅ **Battle mode**: "Iniciar batalha" switches to battle mode and rolls initiative for everyone. The **turn tracker** shows on the DM, player and projector screens, with previous and next turn. The active actor glows on cards and on the map, and the player whose turn it is sees "É a tua vez!". "Terminar batalha" clears it all.
- ✅ **Day / Night / Normal / Battle ambience** on every screen: page tint, plus a map overlay (night filter, warm daylight, pulsing red vignette).
- ✅ **Multiple maps (scenes)**: every upload becomes a new scene with its own tokens, drawings and notes. Switch, "open and show to the group", rename and delete. Thumbnails in the Mapas tab.
- ✅ **Campaigns tab**: list sorted by last played, "Continuar" to switch, create, delete with a real confirmation, rename the chapter, export and import.
- ✅ **Token motion**: moves glide on every screen with a small hop and a coloured trail. The DM drags with live feedback, taps a token to select it, and unplaced tokens show dimmed. Tokens carry an HP bar, and downed creatures turn grey.
- ✅ **Player view rebuilt for PC and tablet**: a status bar (portrait, HP, AC, initiative, effects, music) and separate **Ficha / Mapa / Mesa / Grupo** tabs, so the sheet and the map are never on screen together. Quick-dice buttons for players.
- ✅ **Icon library**: a Lucide SVG sprite (87 icons), local, so it works offline.
- ✅ Portraits on the projector, the launcher and other players' views.

### Checked
- Desktop 1366×860, tablet 768×1024 and phone 375×812: every DM tab and every player tab has no sideways overflow and no console errors.
- Through the API: compendium load, spawning 2 goblins, start battle, token placement and move animation (player view), map upload/switch/delete, end battle, create/switch campaign.

---

## Hardening pass — 2026-10-29

### Fixed
- ✅ **HP desync (critical)**: the live HP a DM changes and the copy inside the player's sheet were two different numbers, so the player's next autosave silently reverted the DM's damage/heal. Every DM change now mirrors into `sheet`, one direction only.
- ✅ **Hidden creatures leaked**: rolls, log lines and the turn order tied to a hidden creature reached the players and the projector. Entries now carry `refs` to the actors they mention, and public views drop entries whose actors are hidden.
- ✅ **Server could crash**: streaming a missing/antivirus-locked file, or requesting a directory through `/media` or `/portraits`, killed the process (EISDIR/EBUSY). Streams are guarded, filenames are allow-listed, and path traversal is rejected.
- ✅ **Two servers on one data folder** corrupted `campaign.json` (each kept a diverging copy). A PID lockfile guards the data dir, recovers from a stale lock after a hard crash, and clears on Ctrl+C.
- ✅ **Corrupt `campaign.json`** refused to start the app. It is now backed up as `.bad-<timestamp>` and a fresh state is created.
- ✅ Snapshot saves are debounced (4 s) instead of writing to disk on every single action; a busy port shows a friendly message instead of a stack trace.
- ✅ **Sheet saves (many)**: name/class/level fields rendered outside the `<form>` and were never saved; the class/level change handlers pointed at the wrong element (hit dice and proficiency never updated); saving from a non-combat tab wiped all saving throws and proficiencies; the first save crashed if death saves were unset; "calcular PV" read a null reference.
- ✅ **SSE re-render fights**: a state push used to overwrite fields mid-typing and destroy open dialogs. Only fields the user has touched (dirty tracking) are restored, dialogs live outside the re-rendered root, and a lost connection reloads the page.
- ✅ Input hardening: HP/AC junk values are clamped, token moves only log on real movement, annotation colours are validated, campaign updates take a key whitelist (prototype-pollution guard), imports are length-capped.
- ✅ Small ones: duplicated "extras" textarea wrote to a dead path, the map-note input clears after placing a note, switching the inspected sheet flushes pending edits first, and failed saves now show an inline error instead of throwing.

### Checked
- 34-case API test suite against a scratch data dir: HP sync (including the autosave-no-revert case), privacy filtering for hidden creatures on log/rolls/turn order/maps, turn wrap + round count, crash-guard paths (traversal, directories, missing files), prune on creature delete, lockfile (second instance, stale lock, dead-PID lock, Ctrl+C), campaign key whitelist — 34/34.

### Notes
- The frontend changes are API-verified but not yet browser-clicked; the DM/projector/player views warrant a quick manual pass before a session.
- `CronicasWeb.exe` starts whatever `server.js` is on disk, so these fixes apply after restarting it — but the exe build itself is still the out-of-repo one flagged above.

---

## Known issues
- 🐞 **No authentication**: the role (`dm` / `player`) is claimed by the browser, so anyone on the Wi-Fi can open `/dm`. Fine at a home table, risky on public Wi-Fi. → add a DM PIN (see roadmap).
- 🐞 Compendium **list names are English** (the GraphQL API has no translations), while details are Portuguese where available.
- 🐞 The portable `CronicasWeb.exe` was built outside this repo. If it bundles an older Node, the certificate fix may not load (see DOCUMENTATION → certificate note). The package needs rebuilding from this source.
- 🐞 The sheet has fixed row counts (6 attacks, 12 inventory rows, 17 spells), and "give to player" stops when they're full.
- 🐞 `app.js` is one 90 KB file and `style.css` one long sheet. That's hard to maintain (see Tech debt).

---

## Roadmap (suggested order)

### Next up
- ⬜ **DM PIN**: protect `/dm` and the DM-only actions with a PIN set on first run (stored hashed in `data/`).
- ⬜ **Rebuild the portable .exe** from this source on Node 24, and document the build script.
- ⬜ **Fog of war**: the DM paints revealed areas per scene, and players and the projector only see those.
- ⬜ **Map zoom & pan** (wheel / pinch) and a **ruler** (grid squares → metres, 1.5 m per square).
- ⬜ **Players move their own token**, optionally limited to their turn and their speed.
- ⬜ **Encounter difficulty**: XP budget by party level (easy/medium/hard/deadly) shown in the Encontro tab.

### Battle & table
- ⬜ Drag to reorder initiative, manual initiative edits, add a late joiner mid-fight.
- ⬜ Roll monster HP from its hit dice when spawning (option), with numbered tokens (Goblin 1, 2…) on the map.
- ⬜ Condition icons on tokens, with tooltips holding the SRD rule text.
- ⬜ Concentration and death-save tracking surfaced in the turn tracker.
- ⬜ Short/long rest buttons (restore HP, hit dice, spell slots).
- ⬜ Spell-slot checkboxes per level that players tick off.
- ⬜ Music per mode (day / night / battle tracks) and per scene, with crossfade.
- ⬜ Dice animation (3D or 2D tumble) on the projector.

### Content
- ⬜ Custom homebrew monsters and items saved to a local library.
- ⬜ Loot generator from the SRD magic-item rarities.
- ⬜ Class and race data from the API to auto-fill features, proficiencies and saves.
- ⬜ English/Portuguese toggle for compendium details (`&lang=en` already works server-side).

### Tech debt
- ⬜ Split `public/app.js` into ES modules (state, views, map, sheet, compendium) without adding a build step.
- ⬜ Split `style.css` by area and remove the old duplicated rules.
- ⬜ Smoke tests: start the server on a temp `CRONICAS_DATA_DIR`, run every action, check `publicState` filtering per role.
- ⬜ Add a request-size and rate guard on uploads, and file-type sniffing (not just the data-URL prefix).

---

## Updating the icon sprite
Icons come from [Lucide](https://lucide.dev) (ISC licence). To add one, append its name to the list and rebuild `public/icons.svg`. The script is plain Node, with no dependencies:

```js
// node build-icons.mjs public/icons.svg swords skull map …
const [, , out, ...names] = process.argv; const fs = await import('node:fs'); const parts = [];
for (const n of names) { const svg = await (await fetch(`https://unpkg.com/lucide-static@1.49.0/icons/${n}.svg`)).text();
  parts.push(`<symbol id="i-${n}" viewBox="0 0 24 24">${svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</symbol>`); }
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${parts.join('')}</svg>`);
```

Current set: swords sword shield shield-half skull crown sun moon sun-moon map map-pin scroll-text book-open book-marked wand-sparkles sparkles flame heart heart-pulse heart-crack backpack dices dice-5 dice-6 users user user-round ghost eye eye-off plus minus x check search trash-2 pencil pen-line upload download image music volume-2 play pause skip-forward rotate-ccw house layout-dashboard monitor tablet-smartphone clock-3 history notebook-pen grid-3x3 move zap gem coins hourglass flag circle-dot crosshair layers library save folder-open folder-plus chevron-right chevron-left arrow-right footprints shield-plus feather castle mountain tent bug paw-print list-ordered wifi refresh-cw settings-2 info triangle-alert loader-circle
