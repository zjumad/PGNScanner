# Copilot Instructions — PGN Scanner

## What This App Does

PGN Scanner is a cross-platform app that photographs chess score sheets and converts handwritten notation into PGN files. Users upload a photo → a Vision API (Gemini or OpenAI) performs OCR → the app validates each move against chess rules with fuzzy matching → users review/correct in an interactive UI → export as `.pgn`.

### Target Platforms

1. Web (Mobile layout) — **current focus**
2. Web (Desktop layout)
3. iOS for iPhone
4. iOS for iPad
5. Android

When designing architecture and code structure, keep cross-platform portability in mind. Services and logic should remain platform-agnostic; only UI components are platform-specific.

## Build & Run

All commands run from `web/`:

```bash
npm install
npm run dev          # Dev server at http://localhost:5173
npm run build        # TypeScript check + Vite production build
npm run lint         # ESLint (flat config, TS + React rules)
```

No test framework is configured.

## Architecture

```
web/src/
├── App.tsx                    # Root component, owns all state (GameState), orchestrates the 4-step flow
├── services/
│   ├── visionApi.ts           # OCR via Gemini REST API (built-in API key from env)
│   ├── chessEngine.ts         # Move validation, fuzzy matching, PGN generation
│   └── types.ts               # Re-exports chessEngine functions (not type definitions)
├── components/
│   ├── ImageUpload.tsx         # Multi-file upload with previews and page badges
│   ├── MoveList.tsx            # Move table with confidence indicators, inline editing
│   ├── BoardViewer.tsx         # react-chessboard wrapper
│   ├── LegalMovesPanel.tsx     # Legal moves display with piece-type filtering and smart suggestions
│   └── HeaderEditor.tsx        # PGN header fields
└── types/index.ts              # Shared types: GameHeader, RecognizedMove, ValidatedMove, GameState
```

### Data Flow

1. **Upload** → User selects one or more images. `ImageUpload` supports multi-file selection, drag-and-drop, and camera capture.
2. **Processing** → Each image is OCR'd via `visionApi.recognizeScoreSheet()` (Gemini REST API). For multi-image uploads, `mergeOcrResults()` combines results by move number (higher confidence wins for overlapping half-moves).
3. **Validation** → `chessEngine.validateMoveSequence()` replays moves from the starting position using chess.js. Each OCR string is matched to legal moves via `matchMoveToLegal()` which generates SAN candidates from common OCR substitutions and uses Levenshtein similarity scoring. Validation halts at the first invalid move; remaining OCR moves are appended as speculative entries via `buildSpeculativeTail()`.
4. **Review** → Two tabs: **Board** (chessboard + navigation showing "n.White"/"n.Black" + legal moves + per-row move table [White 20% | Sheet Crop 60% | Black 20%] showing 3 rounds at a time with auto-centering + PGN preview + export) and **Game Info** (header editor + export PGN). Click a move to select; click again to open edit popover. Navigation starts at round 1 (no "start" position). Correct a move → `revalidateFromIndex()` replays the entire game with the correction applied, then rebuilds the speculative tail. Correction summary bar shows counts by confidence level; next/prev error nav jumps to moves needing attention. Smart suggestions (💡) appear in the Legal Moves Panel when a move needs attention. Image rotation (CW/CCW) and page carousel controls are in the Sheet column header. A move position indicator shows the selected move's grid location.
5. **Export** → User exports the reviewed game as a `.pgn` file via `chessEngine.generatePgn()` (speculative moves excluded).

### Sample Data

The `Samples/` folder contains reference inputs and expected outputs organized into three categories:
- **Empty Score Sheets** — blank templates for UI reference and prompt tuning
- **Well-written notation** — clean handwriting with verified PGN ground truth, for OCR accuracy testing
- **Ill-written notation** — handwriting with major errors and manually corrected PGN, for analyzing correction workflows

Each game subfolder has a `.jpg` image, a `.pgn` ground truth file, and a `README.md` describing its use.

### Key Design Decisions

- **State lives in App.tsx** — no state management library; `GameState` (header, validated moves, selected index) is lifted to the root and passed down via props.
- **Validation stops on first invalid move** — once a move can't be matched or applied, the chain breaks. Remaining raw OCR moves are shown as speculative (gray, no board position). The user must fix the error before subsequent moves can validate.
- **Speculative moves** — `MatchType` includes `'speculative'` for unvalidated tail entries. These have no real FEN or legal alternatives; board interaction is disabled when they're selected.
- **Undo/redo** — correction, insertion, and deletion operations push game state snapshots onto an undo stack (refs, not state). Ctrl+Z / Ctrl+Shift+Z restore previous states. Stacks are cleared on "New Scan".
- **Multi-image upload** — `ImageUpload` accepts multiple files. Each is OCR'd independently, then `mergeOcrResults()` combines them by move number (per half-move, higher confidence wins). `GameState.imageUrls` is an array; `imageRotations` is per-page.
- **Image rotation** — CSS-only rotation (0/90/180°/270°) per page, applied to per-row cropped background images. Does not affect OCR.
- **Per-row image crop** — Each move row shows a CSS-cropped slice of the score sheet image corresponding to that move number. Uses `background-size` and `background-position` to crop a single row's worth of the score sheet.
- **3-row visible window** — The move list shows ~3 rows at a time (120px scroll container). Selected move auto-centers via `scrollIntoView({ block: 'center' })`.
- **Single-click edit** — Clicking an unselected move selects it. Clicking an already-selected move opens the edit popover (no double-click needed).
- **Smart suggestions** — `getSmartSuggestions()` tries each legal move and checks if the next raw OCR move matches in the resulting position. Shown as 💡 suggestions pinned at top of LegalMovesPanel. Only triggers for forced/fuzzy/invalid/speculative moves.
- **Raw OCR export** — `generateRawOcrCsv()` in chessEngine.ts exports CSV format (no UI button; available programmatically for quality tracking).
- **OCR fuzzy matching** (`chessEngine.ts`) — `generateSanCandidates()` produces variants for common handwriting confusions (l↔1, O↔0, B↔8, missing/extra `x`, promotion notation). Confidence thresholds: ≥0.8 = medium, ≥0.5 = low, exact match = high.
- **Vision API calls are raw `fetch`** — not using SDKs. The Gemini API key is built-in via `VITE_GEMINI_API_KEY` environment variable (stored in `web/.env`, gitignored). No user-facing API key configuration.

## Conventions

- React functional components with hooks; no class components
- TailwindCSS v4 with Vite plugin (no `tailwind.config.js` — uses `@tailwindcss/vite`)
- TypeScript with strict-ish flags (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`) but not `strict: true`
- chess.js for all move legality — never manually validate chess rules
- `openai` package is listed as a dependency but not imported; both API providers use raw `fetch`
- Flat ESLint config (`eslint.config.js`) with `typescript-eslint` + React hooks/refresh plugins
