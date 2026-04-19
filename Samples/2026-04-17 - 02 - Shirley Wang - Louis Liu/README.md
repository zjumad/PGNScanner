# Sample: Shirley Wang vs Louis Liu (Round 2)

## Files
- `20260418_234024888_iOS.jpg` — Photo of the handwritten score sheet (rotated 90° CCW)
- `2026-04-17 - 02 - Shirley Wang - Louis Liu.pgn` — Manually corrected PGN (ground truth)

## Game Summary
- 35-move French Defense: Advance Variation, Nimzowitsch System (C02), Black won (0-1)

## Use in Development

### Ill-Written Notation — Correction UI Testing
This sample has **major handwriting errors** in the notation. The PGN file has been manually corrected. Exclude this sample from OCR accuracy benchmarking.

Use it to:
- Test the manual correction workflow (board moves, legal moves panel)
- Analyze the gap between raw OCR output and corrected PGN
- Find opportunities to make the review/correction UI more efficient