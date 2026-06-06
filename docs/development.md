# Development guide

Everything needed to run, test, change and release the app.

## Contents

- [Requirements](#requirements)
- [Setup](#setup)
- [Scripts](#scripts)
- [Project layout](#project-layout)
- [Tests and evaluation](#tests-and-evaluation)
- [Screenshots](#screenshots)
- [Git workflow](#git-workflow)
- [Releasing](#releasing)

---

## Requirements

| | Required | Notes |
|---|---|---|
| Windows 10 or 11 | For VideoPsalm | Everything else also runs on macOS and Linux |
| Node.js 18+ | Yes | CI uses Node 22 |
| Python 3.9 to 3.11 | Yes | For speech-to-text. Newer versions can lack wheels for some packages. |
| About 3 GB disk | Yes | PyTorch (about 2 GB) plus a Whisper model |
| LM Studio | Optional | For paraphrase detection. Mistral 7B Instruct works well. |
| NVIDIA GPU | Optional | Faster transcription. CPU is fine with `small`. |

## Setup

```bash
npm install
```

```bash
pip install -r python/requirements.txt
```

```bash
npm run setup-bible
```

The last step downloads the public-domain KJV and writes `bible-data/kjv.db`. It is not stored in git.

`.npmrc` sets `legacy-peer-deps`. electron-vite 5 declares a peer range of vite 5 to 7, while this project builds with vite 8, which works. Remove it once electron-vite supports vite 8.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app with hot reload |
| `npm run build` | Production build into `out/` |
| `npm test` | Regression checks for detection, lookup and LLM parsing |
| `npm run eval` | Precision, recall, F1 and latency on the labelled set |
| `npm run screenshots` | Rebuilds, then captures the UI into `docs/design/hifi/` |
| `npm run setup-bible` | Builds the KJV database |
| `npm run dist:win` | Windows release zip in `dist-electron/` (unsigned) |

## Project layout

```text
src/
  main/                     Electron main process (see architecture.md)
  preload/index.js          The only API the UI can call
  renderer/src/
    App.jsx                 State, IPC listeners, keyboard shortcuts
    index.css               Design tokens (see design.md)
    components/             TopBar, SettingsPanel, Panel, TranscriptPanel, SuggestionPanel,
                            ScriptureCard, ManualSearch, OnScreenPanel, StatusBar, Icon
python/                     Whisper worker, VideoPsalm bridge, device listing
scripts/
  selftest.js               npm test
  evaluate.js, eval-set.json  npm run eval
  capture-screenshots.js    npm run screenshots
  screenshot-preload.js     Replays a recorded session for screenshots
  fixtures/sample-session.json
  electron-stub.js          Lets main-process modules run under plain Node
  setup-bible-db.js         npm run setup-bible
docs/                       Design, architecture, user and development guides
.github/workflows/ci.yml    Tests, evaluation and build on every push
```

## Tests and evaluation

`npm test` runs 41 checks on the pure parts that carry the most risk: book names, extraction, confidence levels, the heard phrase, parsing of cut-off LLM output, range capping, and transcript-to-verse lookups. Lookup checks are skipped if the database has not been built.

`npm run eval` scores the regex path on [`scripts/eval-set.json`](../scripts/eval-set.json), 62 hand-labelled utterances including known-hard cases and ordinary speech that looks like a reference. It prints Markdown tables that are pasted into the README as they are.

Both run in CI on every push to `main` and `develop`.

## Screenshots

The app has no demo mode. Screenshots come from a harness that replays a recorded session through the real renderer:

```bash
npm run screenshots
```

Options, passed after `--`:

| Option | Meaning |
|---|---|
| `--out <dir>` | Where to save (default `docs/design/hifi`) |
| `--size 1100x700` | Window size (default `1400x860`). `1100x700` is the app's minimum. |
| `--only 1,2,3` | Capture only these numbered shots |

The low-fidelity wireframes in `docs/design/lofi/` are plain SVG files drawn to the same 1400 by 860 frame, with the same content as the recorded session, so they can be compared with the captures region by region.

## Git workflow

The repository follows **Git Flow**:

| Branch | Purpose |
|---|---|
| `develop` | Integration branch and the GitHub default |
| `main` | Released versions only, each tagged (`v1.0.0`, `v1.1.0`) |
| `feature/*` | New work, branched from `develop` |
| `bugfix/*` | Fixes during development |
| `release/*` | Version bump and final checks before merging to `main` |

Branches are merged with `--no-ff` so each feature stays visible in the history.

Commit messages are **one line** in [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) form, with no body or footer:

```text
feat: add on screen panel and status bar
fix: shorten the lookup placeholder for narrow windows
docs: add low fidelity layout wireframe and operator flow
```

Types used: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`, `chore`.

## Releasing

1. Branch `release/x.y.z` from `develop`.
2. Bump `version` in `package.json` and commit `chore: bump version to x.y.z`.
3. Merge into `main` with `--no-ff` and tag `vx.y.z`.
4. Merge the release branch back into `develop` and delete it.
5. Push `main`, `develop` and the tag.
6. `npm run dist:win` builds the Windows zip.
