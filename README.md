# Julie's Floor Designer

A client-side web app for planning floor panel/tile layouts. Enter room and panel dimensions, choose orientation and edge offsets, and see a live SVG preview with cut-panel stats.

All dimensions use **centimeters (cm)**.

## Run locally

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (usually `http://localhost:5173`).

## Build for production

```bash
npm run build
npm run preview
```

## Features

- **Room & panel inputs** — width × length in cm
- **Material presets** — choose `Fluffy (Panel)`, `Floorify (Tile)`, or `Custom`; presets apply panel dimensions and PNG textures together
- **Orientation** — 0° (as specified) or 90° (swaps panel width/length for the grid)
- **Edge offsets** — specify the size of the first cut strip at the left and top edges
- **Live preview** — SVG layout with the active profile name in the header, plus a modified indicator after edits
- **Summary stats** — panel counts, edge cut sizes, material estimate, coverage
- **Tile texture** — drag & drop or browse for a panel image; shown in the SVG preview (cut panels use the same texture with a light overlay)
- **Door symbols** — place one or more door overlays on room walls, with inward/outward facing and left/top vs right/bottom hinge orientation; click a wall in the preview or use the sidebar controls
- **Image export** — download the current SVG layout preview as a high-resolution PNG
- **Auto-save** — room, panel, material, layout, doors, and texture settings persist in `localStorage` and restore on reload
- **Named profiles** — save, load, and delete layout templates (including selected material and texture when storage allows)
- **Profile export/import** — download profiles as JSON for backup or sharing; import merges into saved profiles

## Profile export/import

Profiles can be exported as pretty-printed JSON (single profile or all at once). Export filenames include the profile or collection name, a local timestamp, and the export version, for example `living-room-2026-06-23-1714-v2.json`. Files include a `format`/`version` header for forward compatibility. The selected material id is stored as `selectedMaterial`. Custom tile images are embedded as base64 JPEG when present; built-in material textures reference versioned PNG files in the app.

On import, profiles are merged into browser storage. Duplicate IDs are reassigned automatically. If a profile name already exists, you can import as a numbered copy or replace the existing profile. Invalid JSON or missing fields show a clear error notice.

## Image export

Use **Export image** in the preview header to download the visible room SVG content as a timestamped PNG, for example `living-room-2026-06-23-1714-v2.png` when a profile is selected. The PNG is rendered at 2× the on-screen SVG size and uses locally stored data URL tile textures, so custom tile images can be exported without cross-origin canvas issues.

## Persistence

Settings auto-save to the browser under these keys:

| Key | Contents |
|-----|----------|
| `julies-floor-designer:session` | Current form values, selected material, door overlays, and optional tile image |
| `julies-floor-designer:profiles` | JSON array of named saved profiles |

Large tile images are resized before storage. If the browser quota is exceeded, settings are still saved but the image may be omitted (a notice is shown).

## Key files

| File | Purpose |
|------|---------|
| `index.html` | App shell and form controls |
| `src/layout.js` | Layout calculation logic |
| `src/doors.js` | Door overlay geometry and SVG rendering |
| `src/main.js` | UI wiring, SVG rendering, stats, persistence |
| `src/storage.js` | localStorage session + profile helpers |
| `src/style.css` | Styles |

## Offset behavior

- **Left cut / Top cut** = width or height of the **first partial panel** at the starting edge (left wall and top wall).
- **0** means the layout starts flush with a full panel at that edge; any remainder is cut on the opposite edge (right / bottom).
- **> 0** places a cut strip of that size first, then full panels, then a cut on the opposite edge if needed.

Example: room 400 cm wide, panels 120 cm wide, left cut **20 cm** → 20 cm strip, then three full 120 cm panels, then a 20 cm strip on the right.
