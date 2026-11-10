# A cursor move re-renders every visible row; ticks and clocks reach list rows (#597, lane V5)

- **Area:** app (list rows, list controller, spinner, relative times)
- **Symptom:** `j`/`k` in the Notifications pane rendered all 20 visible `ListRow`s (ROW-RENDER 20 for a 20-row window in a 300-row list) instead of the old and new selected row; the controller's `handleKey` changed identity on every cursor move, so nothing built on it could be memoised.
- **Root cause:**
  - Notifications built its `ListRow`s inline in the pane body, so every pane render rebuilt every row.
  - `useListController` closed over `cursor`, `items` and `count` in `handleKey`/`moveTo`/`jumpTop`/`jumpBottom`, and sliced a new `visibleItems` array on every render.
  - `Spinner` ran a private 100 ms interval per instance, and each relative-time row formatted `timeago` at render with nothing to refresh it.
- **Fix:**
  - `src/ui/ListRow.jsx` is `React.memo`; the memo boundary is the row component that owns the cells. Notifications gets `NotificationRow` (primitive props plus the row's own item). A `setRowRenderProbe(fn)` hook counts `ListRow` renders (off by default) for ROW-RENDER; V0/V6 can use it.
  - `src/hooks/useListController.js`: `handleKey`, `moveTo`, `jumpTop`, `jumpBottom` read the latest cursor/items from a ref and keep one identity for the life of the hook; `visibleItems` is memoised on `items`/`scrollOffset`/`height`.
  - `src/ui/animation.js`: one animation slot. The first claimant animates (tick `TICK_MS` = 120 ms), every other `Spinner`/`ActivityIndicator` draws a static frame, and the timer runs only while somebody animates. The frame state lives in the store, so a tick re-renders only the owning leaf.
  - `src/components/ActivityIndicator.jsx`: fixed-width cell (always `width` columns, blank when idle) for the header/status line. API: `<ActivityIndicator active={query.isFetching} width={2} label="" />`. V4a/b/c adopt it in place of "refreshing..." rows.
  - `src/ui/clock.js`: one minute-granularity clock (`useMinuteClock()`), a single timer for all subscribers, started on first subscribe and cleared on last. Only row components that show a relative time (Notifications, Actions, Issues) subscribe.
- **Not done here:** `StatusBar` keeps its own 10 s "refreshed Ns ago" tick (second granularity by design, not a relative time on data); PR list rows (V4a) still format `shortAge` without subscribing; wiring the indicator into the header is left to the view lanes.
- **Regression tests:** `src/ui/row-isolation.test.jsx` (j/k <= 2 `ListRow` renders in a 300-row list: 20 on main; 0 renders while a spinner and indicator tick), `src/ui/animation.test.jsx` (one animated element, tick >= 120 ms, fixed width, one clock timer), `src/hooks/useListController.test.jsx` (callback and window identity).
