# bool — Agent Guidelines

## Project Overview

Social matchmaking app for **groups** (not individuals): a group swipes on other groups; mutual interest → a match → a group chat. Built with Expo SDK 54, expo-router 6 (file-based routing), React Native 0.81, React 19, TypeScript. Backend is **Supabase** (Postgres + Auth + Storage + RPC).

**The matching funnel:** a member swipes ✓ on another group in **For You** → creates a `pending` `group_suggestion` → the group leader reviews it in **Pending** and Sends it (`sent`) → the target group sees it in **Received** and approves (`matched`) → both groups get a **Chat**. Pending and Received show only the stages still waiting on someone; once a suggestion is `matched` it leaves both and lives in Chats.

- `app/_layout.tsx` — root stack (login gate); `app/(tabs)/_layout.tsx` — bottom tabs, wraps everything in `CurrentGroupProvider`, and gates on profile completion
- `app/(tabs)/` — `index` (Explore: For You/Pending sub-tabs), `received`, `groups`, `chats`, `profile`
- `components/` — `groupPost` / `individualPost` (full read+edit cards), `groupPostPreview` (photo tile), `chatThread`, `settings`, `history`, `ui/icon-symbol` (SF Symbols → MaterialIcons)
- `lib/` — one small single-purpose Supabase fetcher per file (see conventions); plus `sendMessage`, `canonicalPair`, `supabaseClient` (at repo root)
- `hooks/` — `use-current-group` (which group you're acting as), `use-session`, `use-color-scheme`
- `constants/theme.ts` — `Type` scale, `Palette`, `FontFamily` (Manrope), `Colors`
- `assets/symbols/` — custom SVG icons (`CheckMark`, `XMark`, `PaperPlane`) via `react-native-svg`; `assets/fonts/` — vendored Manrope `.ttf`s

## Backend (Supabase) & data conventions

- **Schema lives in the Supabase dashboard, NOT in the repo** (no migration files). Tables: `profiles`, `groups` (has `status` active|dissolved), `memberships` (has `status` active|kicked|left|group_dissolved + `status_at`), `group_suggestions` (status pending|sent|matched), `messages`, `chat_reads` (per user per chat `last_read_at`, keyed by the canonical group pair — drives the unread styling in Chats), `questions`. Storage buckets: `people`, `groups`. RPCs: `get_chat_previews`, `get_unread_chat_count`, `delete_my_account`, `dissolve_group`.
- **Schema-before-code ordering is a real footgun:** if code selects/filters a column that doesn't exist yet, every such query errors and the app breaks. When a change needs both SQL and code, the SQL must be run in the dashboard **before the app reloads**. Always hand the user the SQL and say "run this first."
- **Images:** resized + JPEG-compressed client-side (`expo-image-manipulator`) before upload; deterministic paths (`{id}/img1.jpg`, `profile.jpg`); the final public URL (with a `?v=timestamp` cache-buster) is written onto the row (`image_urls`, `profile_pic_url`) so reads **never call `storage.list()`**. Render with `expo-image` (disk-cached). Upload bytes via `arrayBuffer`, never RN `blob` (blobs upload 0 bytes).
- **Fetchers** favor one PostgREST round trip: use FK embeds (e.g. `profiles:suggested_by(...)`, `groups!target_group_id(...)`) over N+1 loops.

## Naming conventions (established, keep consistent)

- **"current" = the group you're acting as** (`currentGroupId`, `useCurrentGroup`). **"active" = membership status** (`status='active'`, `fetchMyActiveGroupIds`). Keep these two senses distinct — do not reintroduce "active group" for the acting-as concept.
- Membership fetchers: `fetchMyActiveGroupIds` (my current groups) vs `fetchMyPastGroups` (groups I'm no longer in, with how and when each ended — for History) vs `fetchActiveGroupIds` (every active group app-wide, for For You — excludes dissolved).
- Only `status='active'` members define a group — filter membership reads accordingly (`fetchGroup`, `fetchAllGroupMembers`, `fetchMyActiveGroupIds`).

## Commands

- `npm start` — expo dev server (`npm run android` / `ios` / `web`); `npx expo start --tunnel` to test on a phone off the same network; `-c` clears cache (needed after adding a native module)
- `npm run lint` — expo lint (ESLint 9). Verify types with `npx tsc --noEmit`. Two lint warnings in `index.tsx`/`login.tsx` are pre-existing and unrelated.
- No test runner; verify by running the app.

## Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing any code.

## Working Style (Karpathy guidelines)

Full version with examples: `.claude/skills/karpathy-guidelines/SKILL.md`. Bias toward caution over speed; for trivial fixes use judgment.

1. **Think before coding** — state assumptions explicitly; if multiple interpretations exist, present them instead of picking silently; push back if a simpler approach exists; if confused, stop and ask.
2. **Simplicity first** — minimum code that solves the problem. No speculative features, abstractions for single-use code, unrequested configurability, or error handling for impossible scenarios.
3. **Surgical changes** — touch only what the task requires. Don't reformat, refactor, or "improve" adjacent code; match existing style. Remove only orphans your own change created; mention (don't delete) pre-existing dead code.
4. **Goal-driven execution** — turn tasks into verifiable success criteria before starting ("fix the bug" → "reproduce it, then make the repro pass"), state a brief step → verify plan for multi-step work, and loop until verified.
