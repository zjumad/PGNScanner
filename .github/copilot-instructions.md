# Copilot Instructions — PGN Scanner

## What This App Does

PGN Scanner photographs chess score sheets and converts handwritten notation into PGN files. Users upload a photo → a Vision API (Gemini or OpenAI) performs OCR → the app validates each move against chess rules with fuzzy matching → users review/correct in an interactive UI → export as `.pgn`.

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
├── App.tsx                    # Root component, owns all state (GameState), orchestrates the 3-step flow
├── services/
│   ├── visionApi.ts           # OCR via Gemini REST API or OpenAI Chat Completions (vision)
│   ├── chessEngine.ts         # Move validation, fuzzy matching, PGN generation
│   └── types.ts               # Re-exports chessEngine functions (not type definitions)
├── components/
│   ├── ImageUpload.tsx         # File/camera input
│   ├── ApiKeyDialog.tsx        # API key + provider selection
│   ├── MoveList.tsx            # Move table with confidence indicators, inline editing
│   ├── BoardViewer.tsx         # react-chessboard wrapper
│   └── HeaderEditor.tsx        # PGN header fields
└── types/index.ts              # Shared types: GameHeader, RecognizedMove, ValidatedMove, GameState
```

### Data Flow

1. **Upload** → `visionApi.recognizeScoreSheet()` sends image as base64 to the selected API with a detailed system prompt → returns `OcrResult` (header + `RecognizedMove[]`)
2. **Validation** → `chessEngine.validateMoveSequence()` replays moves from the starting position using chess.js. Each OCR string is matched to legal moves via `matchMoveToLegal()` which generates SAN candidates from common OCR substitutions and uses Levenshtein similarity scoring. Validation halts at the first invalid move.
3. **Review** → User navigates moves; board shows FEN at selected position. Double-click a move to correct it → `revalidateFromIndex()` replays the entire game with the correction applied.

### Key Design Decisions

- **State lives in App.tsx** — no state management library; `GameState` (header, validated moves, selected index) is lifted to the root and passed down via props.
- **Validation stops on first invalid move** — once a move can't be matched or applied, the chain breaks. The user must fix it before subsequent moves can validate.
- **OCR fuzzy matching** (`chessEngine.ts`) — `generateSanCandidates()` produces variants for common handwriting confusions (l↔1, O↔0, B↔8, missing/extra `x`, promotion notation). Confidence thresholds: ≥0.8 = medium, ≥0.5 = low, exact match = high.
- **Vision API calls are raw `fetch`** — not using SDKs. The Gemini call hits the REST endpoint directly with the API key as a query parameter; OpenAI uses Bearer auth.

## Conventions

- React functional components with hooks; no class components
- TailwindCSS v4 with Vite plugin (no `tailwind.config.js` — uses `@tailwindcss/vite`)
- TypeScript with strict-ish flags (`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`) but not `strict: true`
- chess.js for all move legality — never manually validate chess rules
- `openai` package is listed as a dependency but not imported; both API providers use raw `fetch`
- Flat ESLint config (`eslint.config.js`) with `typescript-eslint` + React hooks/refresh plugins
