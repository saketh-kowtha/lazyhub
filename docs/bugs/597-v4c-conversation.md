# Conversation, issue detail and custom pane flash on refresh and failure (#597, lane V4c)

- **Area:** PR comments, issue detail/timeline, custom pane
- **Symptom:** `r` on a custom pane replaced its rows with "Loading …", and a failing re-run emptied the list. A failed revalidate of the PR comments or issue detail replaced the loaded conversation with a full-body "Failed" line. The issue refresh also depended on a `pageLoading` flag that V1 changed to mean "no data yet".
- **Root cause:**
  - `CustomPane` kept its own `loading`/`error`/`items` state: `fetchItems` set `loading` true and, on failure, `items` to `[]`; the body was gated on `!loading && !error`.
  - `PRComments` returned early on `loading` / `error` before looking at the data it already held.
  - `IssueDetail` used `loading`/`pageLoading` for the "refreshing" handshake and the live-update pause. Since V1, `loading === isLoading` is false while data is on screen, so the refresh handshake (`if (pageLoading) return`) would have reset the timeline from the stale cached page.
- **Fix:**
  - All three bodies follow the derived `mode` (`skeleton | pending | data | empty | error`) from `useGh`/`useQuery`. A full-body failure or skeleton shows only when there is no data; otherwise rows stay and one line in the header/status slot says the refresh failed.
  - A fixed-width `↻` cell in each header (a space when idle) shows background activity, so it cannot shift layout. No "refreshing" rows.
  - `IssueDetail` uses `isFetching` for the refresh handshake and the live-update pause, and starts the refetches before it resets the loaded pages.
  - `CustomPane` runs its command through `useQuery` (memory cache only, list freshness 30 s, never written to disk), so `r` keeps rows, a failing re-run keeps them with a notice, and a re-open inside the window runs nothing. The cursor is clamped when a re-run returns fewer rows. The command error line is now `sanitizeRaw`ed.
  - The conversation freshness class (15 s) already applies by fetch function name (V1).
- **Regression test:** `src/features/prs/conversation-flash.test.jsx` (5 of its 8 tests fail on main): FLASH = 0 across manual refresh, failing refresh and background invalidate for all three views, delayed skeleton, and a check that the migrated view files have no `loading ?` branch.
- **Sibling sweep:** PR list/detail (V4a), diff/logs (V4b) and the app shell (V3) are other lanes. Vitals hooks (V0 recorder) are not wired here; add them after #599 lands.
