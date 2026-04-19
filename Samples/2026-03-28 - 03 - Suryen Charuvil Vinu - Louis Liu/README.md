# Sample: Suryen Charuvil Vinu vs Louis Liu (Round 3)

## Files
- `20260419_171851059_iOS.jpg` — Photo of the handwritten score sheet, page 1 (moves 1–30)
- `20260419_171859295_iOS.jpg` — Photo of the handwritten score sheet, page 2 (moves 31–60)
- `2026-03-28 - 03 - Suryen Charuvil Vinu - Louis Liu.pgn` — Manually corrected PGN (ground truth)

## Game Summary
- 51-move French Defense: Advance Variation (C02), White won (1-0)
- Long tactical game with multiple pawn promotions in the endgame

## Use in Development

### Multi-Image Upload Testing
This is the only sample with a **2-sided score sheet** (two images). Use it to test:
- Multi-image upload and sequential OCR processing
- Page carousel navigation between images
- Move merging across pages (moves 1–30 from page 1, 31–51 from page 2)

### Handwriting Challenges
- Long game (51 moves) spanning both sides of the sheet
- Late-game notation may be rushed or less legible
- Tests the app's handling of promotion notation (f8=Q, g8=Q)
