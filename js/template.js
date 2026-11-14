// Card template definition. Everything about the physical card lives here so
// the rest of the tool never hard-codes sizes. To change DPI or swap the back
// artwork, edit this file only.

export const TEMPLATE = {
  name: '14 Trees – Carbon Neutral Deck (family card)',

  // Trim size in inches (portrait). Vendor handles die-cut corners and cutting.
  widthIn: 2.5,
  heightIn: 3.5,

  // Output resolution. 300 DPI → 750 × 1050 px. (Proposed; confirm with vendor.)
  dpi: 300,

  // Photo area in normalised card coordinates (0–1). The family photo is
  // full-bleed on the front, so it covers the whole card.
  photoArea: { x: 0, y: 0, w: 1, h: 1 },

  // Fixed back design shared with the other 53 cards in the deck.
  backImage: 'assets/card_back.png',

  // Guides drawn on the preview only (never exported).
  guides: {
    // Approximate die-cut corner radius, for a visual hint only.
    cornerRadiusIn: 0.125,
    // Keep faces inside this margin so the cutter never clips them.
    safeMarginIn: 0.125,
  },

  // Where the group of faces should sit vertically, as a fraction of the
  // photo-area height (centre of the face group). Slightly above middle reads
  // naturally for portraits.
  faceTargetY: 0.4,

  // Below this effective resolution the photo will look soft when printed.
  minEffectiveDpi: 150,
};

export const cardPx = (t = TEMPLATE) => ({
  w: Math.round(t.widthIn * t.dpi),
  h: Math.round(t.heightIn * t.dpi),
});
