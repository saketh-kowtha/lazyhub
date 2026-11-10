# PR list and PR detail repaint on filter change and on a failed revalidate (#597, lane V4a)

- **Area:** prs (src/features/prs/list.jsx, list-view.jsx, list-dialog-view.jsx, detail.jsx)
- **Symptom:** changing the PR filter, scope, author, search or sort swapped the rows for a skeleton (or a false "No closed pull requests" state) until the new page landed; a failed revalidate of the PR detail replaced the whole PR with a full-body error; the list header drew a `⟳` that appeared and disappeared (a layout shift) and the detail view had a `refreshing…` row.
- **Root cause:** both views branched on `loading` / `error` themselves (`if (loading) skeleton`, `if (error) full-body`, `loading && items.length === 0`) and the list hand-rolled cursor, scroll, `gg`/`G` and shrink handling. A new query key had no data, so the body fell to the skeleton.
- **Fix:**
  - The PR list reads its first page with `keepPreviousData: true`; while the rows are another key's (`isPlaceholderData`) they are shown as they are (not re-filtered by the new state set), write keys and paging are held, and the cursor goes to the top once the new rows land. A placeholder with no rows is treated as a load, not as an empty result.
  - List body is `<QueryBoundary>` (skeleton after 150 ms, rows under errors with one retry line, empty only from a settled empty result); the paging line is its `footer`.
  - Cursor, scroll window, `gg`/`G`/`j`/`k` and selection memory (the cursor follows its PR number across a refetch) come from `useListController`. The saved cursor is restored once rows exist and kept in pane state.
  - PR detail chooses its body with `deriveRenderMode` (skeleton, pending, error only when there is no PR); the `refreshing…` row is gone, and an error under a PR becomes a one-line notice in the existing state line.
  - Background activity is one fixed-width cell (`FetchCell`, 1 column, always rendered) in the list header and the detail state line. It is a local stand-in until V5's indicator is on main.
  - `list-dialog-view` takes `jumpTop` instead of `setCursor`/`setScrollOffset`.
- **FLASH before / after** (in-process, real `useGh`, `src/features/prs/flash.test.jsx`; a flash is a frame after the first data frame that holds no row):
  - revalidate / invalidate with a slow refetch: list 0 -> 0, detail 0 -> 0 (V1 already stopped `loading` from being true with data on screen)
  - manual refresh `r`: list 0 -> 0, detail 0 -> 0
  - error during revalidate: list 0 -> 0 (rows kept; the retry line is now inside the boundary), detail 1 -> 0 (the PR was replaced by the error)
  - filter / key change (list): 1 -> 0 (the rows were replaced)
- **Not changed:** R3 seeding, R4 prefetch, smart Enter opt-in (#602), R7 key ownership, the checks-mode fall-through fix (#596), the "Loading description and reviews..." row of a list-seeded (`partial`) detail, which is a gap in the seed and not a refetch indicator.
- **Left for later lanes:** swap `FetchCell` for V5's indicator; the list restores the saved cursor but not the exact saved scroll offset (`useListController` has no initial-position input; V5 owns it).
- **Regression tests:** `src/features/prs/flash.test.jsx` (2 of its 7 tests fail on main: filter change, detail error), `src/features/prs/no-loading-branch.test.js`.
