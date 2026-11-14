# Playing Card Design Template (14 Trees)

Turns up to 4 donor-family photos into print-ready 2.5 × 3.5 in playing cards, with no designer needed.

## How to use it (backoffice)

1. **Start it.** In a terminal, from this folder, run `python3 -m http.server 8642` and open http://localhost:8642. In the left sidebar, open **Templates → Playing Card template**.
2. **Add photos.** Drop up to 4 photos onto the dashed box, or click a card to add its photo. JPG, PNG and HEIC are all fine. You can continue with fewer than 4; only filled cards are exported, numbered 1, 2, 3…
3. **Check each card.** Faces are found and placed automatically. If a card looks off:
   - drag the photo to move it; use the slider, the mouse wheel or the +/− buttons to zoom
   - **Fit to frame** shows the whole photo inside the card, with a blurred background filling any gaps (good for wide group shots)
   - **Crop** opens the photo so you can draw the part to keep (free, card-shaped or square); the card is then re-placed around the faces in the crop
   - **Reset** goes back to the automatic placement
4. Read any yellow notes under a card (no face found, a face near the cut line, low resolution). Then press **Confirm layout**.
5. Type the **family name**, pick **PNG** (the current vendor) or **PDF**, and press **Confirm format**.
6. Press **Export cards**, then download each file or press **Download all (.zip)**.
7. When you're done, press **Delete photos & start over**.

Photos never leave the computer. Everything runs in the browser and nothing is uploaded or stored.

## Output

| | PNG | PDF |
|---|---|---|
| Files | 1–4 card fronts (+ 1 card back, optional) | same, one page each |
| Size | 750 × 1050 px, 300 DPI, sRGB tagged | 2.5 × 3.5 in page |
| Name | `Sharma_card1_20261027.png` | `Sharma_card1_20261027.pdf` |

The back is the same artwork as the other 53 cards (`assets/card_back.png`), so it is exported once as `{label}_back_{date}`.

## Developer notes

No build step. It's plain HTML + ES modules, with third-party libraries vendored in `vendor/` so it works offline. It has to be served over HTTP (ES modules and the face model can't load from `file://`). `python3 -m http.server` is enough locally, and any static host works too (an internal server, GitHub Pages, etc.).

**Integrating into the 14 Trees dashboard.** The sidebar in `index.html` and `js/shell.js` is a visual stand-in for the real dashboard navigation. Only **Templates → Playing Card template** is wired up; the other links show a "This opens in the main 14 Trees dashboard" message. When integrating, mount the `#view-tool` markup (plus the `card-tpl` template and the `crop-dlg` dialog) as a page under a new **Templates** nav group, and load `js/app.js`. The colours in `css/styles.css` (`:root` variables) were sampled from the dashboard.

| File | Role |
|---|---|
| `js/template.js` | **Card template**: trim size, DPI, photo area, back image, guide sizes. Change DPI or artwork here. |
| `js/render.js` | `renderCardFront()` is the single draw routine used by both the preview and every exporter. That's why preview = export. |
| `js/placement.js` | Auto-placement from face boxes, plus the checks shown under each card. |
| `js/faces.js` | Face detection (`@vladmandic/face-api`, SSD MobileNet v1; model in `models/`). |
| `js/images.js` | File loading, HEIC conversion (`heic2any`, skipped where the browser reads HEIC natively), EXIF rotation, downscaled preview copy. |
| `js/exporters/` | One file per output format plus a registry in `index.js`. |
| `js/naming.js` | `{label}_card{N}_{YYYYMMDD}.{ext}`; the label is stripped to `A–Z a–z 0–9 -`. |
| `js/app.js` | UI, flow gating (layout confirm → format confirm → export). |
| `js/crop.js` | Crop dialog (free / card-shaped / square). Crops are stored normalised and re-applied to the original at export. |
| `js/shell.js` | Stand-in dashboard sidebar and hash routing (`#/templates/playing-card`). |

**Placement model.** Each card stores `{ zoom, cx, cy, fill }`. `zoom = 1` means the photo exactly covers the card, `< 1` shows gaps with the background fill, and `cx, cy` is the photo centre in card-normalised units. Because the model doesn't depend on resolution, the preview runs on a ≤2048 px copy and export re-renders from the **original** file. Aspect ratio is always preserved: there's one scale for both axes and no stretching.

**Auto-placement.** It starts at "fill the card". It shrinks only if the faces (plus a small margin) won't fit inside the 1/8 in safe area, and zooms in gently when the family is tiny in a large scene, but only while print resolution stays ≥ 300 DPI. It centres the face group horizontally and at 40 % height. Tiny background faces (posters, passers-by) are ignored. A card the user has adjusted is never overwritten by auto-placement unless they press Reset. Replacing a photo re-runs it for that card only.

**Adding a format (e.g. TIFF).** Create `js/exporters/tiff.js` exporting `{ id, label, ext, description, exportCard(canvas, meta) → Blob }` and add it to `EXPORTERS` in `js/exporters/index.js`. Nothing else needs to change.

**To confirm with the vendor:** 300 DPI, sRGB, corner radius, and whether they want bleed. Bleed would be a `bleedIn` in `template.js`, with the canvas enlarged in `render.js`.

**Not yet built (from the spec):** AI outpainting (a "Could", later phase). There's also no login, so the "authorised user deletes photos" requirement is met by nothing ever being stored: closing the tab or pressing *Delete photos* discards everything.

---

# Carbon Neutral Card template

Builds the print-ready **Carbon Neutral Gift Card**: a 20 × 3.5 in strip that is accordion folded into 8 panels of 2.5 × 3.5 in, front and back. Open it from **Templates → Carbon Neutral Card template** (`#/templates/carbon-neutral-card`).

## How to use it (backoffice)

1. **Species.** The slots start empty. Pick the 14 species: slots 1–6 go on the front (panels 2–7) and slots 7–14 on the back (panels 1–8, left to right). Type a name or open the list for each slot. The same species may be used twice. Drag the ≡ handle to reorder; slots can move between front and back. Fewer than 14 species? Drag them onto one side (up to 6 fit on the front, up to 8 on the back) and clear the other slots; blank slots print blank.
2. **QR code.** Paste the link for this order from the 14 Trees backoffice dashboard. The QR is drawn in the brown of the page text, inside the marked square on the info panel.
3. **Check and confirm.** Read the notes (empty slots, low resolution species, small QR dots), then press **Confirm layout**.
4. **Export.** Type an order label, pick **PNG** or **PDF** and 300 or 600 DPI, then press export. Download each file or all as a .zip.

Every species card is placed inside its panel with a **0.5 cm gap** on all sides (change it under *Layout settings*). The **fold ticks** are drawn by the tool at each fold, very faint; the strength is also in *Layout settings* (0 % removes them). The coloured guides in the preview never appear in the export.

## Output

| | PNG | PDF |
|---|---|---|
| Files | `{label}_front_{date}.png`, `{label}_back_{date}.png` | one 2-page file, or two files |
| Size | 6000 × 1050 px at 300 DPI (12000 × 2100 at 600 DPI), sRGB, DPI tagged | 20 × 3.5 in page, QR as vector |

No bleed, trim box or safe zone: the file is the finished strip.

## Artwork and species (all in this repository)

| Path | What |
|---|---|
| `assets/carbon-neutral/cover.png` | Front panel 1 (cover). |
| `assets/carbon-neutral/info.png` | Front panel 8 (info text with the empty QR square). |
| `assets/carbon-neutral/species/*.png` | The species cards, 1500 × 2100 px (about 5 : 7). |
| `assets/carbon-neutral/species/manifest.json` | List of species: `id`, `name`, `local`, `botanical`, `frame`, `file`. |

**To add a species permanently:** drop the PNG in `assets/carbon-neutral/species/` and add a line to `manifest.json`. In the browser, **Species library → Add species** adds one for that computer only (stored in the browser, never uploaded).

**To replace the cover or info panel** with a higher-resolution file, overwrite the PNG with one of the same layout (2.5 × 3.5 in, about 5 : 7). If the QR square moves, update `QR_FRAC` at the top of `js/carbon.js` (it is the square's position as a fraction of the PNG). The brown used for the QR is sampled from the info panel text (`INK_AREA`). The supplied panels are 544 × 761 px (about 218 PPI), so they are enlarged at 300 DPI; send larger files when you have them.

The back is cream with the 8 species. Where a species existed in two versions, only the latest is listed (the older files are kept in `assets/carbon-neutral/species/_unused/`).

## Developer notes

`js/carbon.js` is one ES module that builds its own markup into `#view-carbon`, and `css/carbon.css` adds the few extra styles. `renderSide()` is the single drawing routine used by the preview and by both exporters, so the preview matches the export. PNG, PDF (own writer, vector QR) and .zip are built in the browser; the only third-party code is `vendor/qrcode-generator.min.js`. Like the playing card tool it must be served over HTTP (`python3 -m http.server 8642`).
