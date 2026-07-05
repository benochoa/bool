# bool — Agent Guidelines

## Project Overview

Social app built with Expo SDK 54, expo-router 6 (file-based routing), React Native 0.81, React 19, TypeScript. No backend yet — all content is mock data bundled with the app.

- `app/_layout.tsx` — root stack; `app/(tabs)/_layout.tsx` — bottom tab bar
- `app/(tabs)/` — screens: `index` (explore), `home`, `chats`, `group`, `received`
- `components/` — shared UI. `individualPost.tsx` / `groupPost.tsx` render feed posts; `themed-text` / `themed-view` handle light/dark theming
- `components/*Registry.ts` — static registries mapping string keys (e.g. `Data/Groups/Group-1`) to `import`/`require`d JSON and images. Metro only bundles static imports, so **new Data entries must also be added to the matching registry file**
- `Data/` — mock content: `People/<Name>/{Images,Text}` and `Groups/Group-<N>/{Images,Text}` with `name.json`, `qa.json`, and (groups only) `members.json`
- `hooks/`, `constants/` — color scheme + theme helpers

## Commands

- `npm start` — expo dev server (`npm run android` / `ios` / `web` for a specific platform)
- `npm run lint` — expo lint (ESLint 9, eslint-config-expo)
- No test runner is configured; verify changes by running the app

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## Working Style (Karpathy guidelines)

Full version with examples: `.claude/skills/karpathy-guidelines/SKILL.md`. Bias toward caution over speed; for trivial fixes use judgment.

1. **Think before coding** — state assumptions explicitly; if multiple interpretations exist, present them instead of picking silently; push back if a simpler approach exists; if confused, stop and ask.
2. **Simplicity first** — minimum code that solves the problem. No speculative features, abstractions for single-use code, unrequested configurability, or error handling for impossible scenarios.
3. **Surgical changes** — touch only what the task requires. Don't reformat, refactor, or "improve" adjacent code; match existing style. Remove only orphans your own change created; mention (don't delete) pre-existing dead code.
4. **Goal-driven execution** — turn tasks into verifiable success criteria before starting ("fix the bug" → "reproduce it, then make the repro pass"), state a brief step → verify plan for multi-step work, and loop until verified.
