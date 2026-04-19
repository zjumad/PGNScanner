# Sample: Seojoon Oh vs Louis Liu (Round 4)

## Files
- `20260419_171841314_iOS.jpg` — Photo of the handwritten score sheet (rotated 90° CCW)
- `2026-03-28 - 04 - Seojoon Oh - Louis Liu.pgn` — Manually corrected PGN (ground truth)

## Game Summary
- 45-move French Defense: Advance Variation (C02), Draw (1/2-1/2)
- Positional endgame with knight vs bishop

## Use in Development

### OCR Accuracy Testing
- Medium-length game with a drawn result — tests recognition of "1/2-1/2" result notation
- Heavy endgame maneuvering with repeated piece moves (good test for disambiguation)

### Handwriting Challenges
- Score sheet photographed sideways — tests orientation detection
- Endgame moves may include repetitive notation patterns
