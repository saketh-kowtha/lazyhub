# Views reload on revalidate: unstable identity, unbatched commits, `loading` blanking (#597, lane V1)

- **Area:** app (src/data query layer, `useGh`, `QueryBoundary`)
- **Symptom:** a refetch of data already on screen repainted the view: rows were new objects every time (memoisation useless), a manual refresh set `loading` and unmigrated panes drew a skeleton over their rows, and one fetch result committed several times.
- **Root cause:**
  - `useQuery` kept `data`, `loading`, `error` and `isStale` in four `useState`s. Ink 4.4.1 creates its React root with `reconciler.createContainer(rootNode, 0 /* LegacyRoot */, ...)` and exports no `batchedUpdates`, so setters called from an async callback are not batched: every one commits and `rootNode.onRender` runs (leading-edge throttle, so the first commit of a burst is written at once as an intermediate frame). RISK 4 of the decision doc is confirmed.
  - `fetch()` stored the raw response, so a refetch returned a new array and new row objects even when nothing changed.
  - `loading` was true for any non-background `fetchData(force)`, including `r` on a view that already had data.
  - Cache and invalidation notifications ran synchronously, one per call.
- **Fix:**
  - `src/data/structuralShare.js` `replaceEqualDeep`: merge a result into the cached value, unchanged subtrees keep identity, arrays of rows with a unique `id`/`node_id`/`number` match by id (a moved row keeps identity). Applied in `client.fetch`, `setQueryData`, `updateQueryData`, `mutate` and page 1 of `useInfiniteQuery`.
  - One state object per hook with a single merged `setState` per event (`useBag`); an unchanged patch returns the same state object.
  - `src/data/notifier.js`: data watchers and invalidation revalidations are queued and flushed once per microtask. `client.watch(key, fn)` lets a mounted query follow `setQueryData`/`updateQueryData` (the cache patch API for optimistic writes; the existing `invalidate(prefix)` and `useMutation` seam are unchanged).
  - `src/data/renderMode.js`: derived `mode` (`skeleton | pending | data | empty | error`) with a 150 ms skeleton delay. `useQuery`/`useInfiniteQuery` return `isLoading`, `isFetching`, `mode`, `skeletonDue`; `QueryBoundary` renders from the mode. `keepPreviousData` (opt-in) keeps the last key's rows, flagged `isPlaceholderData`.
  - `src/data/freshness.js`: classes list/detail 30 s, conversation 15 s, notifications 15 s, immutable `Infinity`; `useGh` picks the class by fetch function name (`freshness:` option or `ttl:` override it). Nothing is mapped to `immutable` yet: `listPRFilesPage` and the diff/log reads are keyed by PR number, not head SHA or run attempt, so V4b opts them in once their keys carry it.
  - GC: entries nobody watches are kept at least 5 minutes (`gcMs`), then dropped by a lazy sweep run from cache writes (no timer). The existing entry/byte LRU caps still apply, so RSS is bounded as before.
- **`loading` mapping for unmigrated views:** `loading === isLoading` (no data yet and a request in flight). It is no longer true when data is on screen and a refetch runs; the in-body "refreshing" blank is gone for every caller without a code change. Views that want a background indicator read `isFetching`. `QueryBoundary` now shows its skeleton only after 150 ms and a failure under rows as one line (`cause  [r] retry`).
- **Regression test:** `src/data/queryClient.semantics.test.jsx` (19 of its 22 tests fail on main).
- **Sibling sweep:** `useGh` and `useInfiniteQuery` share the same semantics; panes using `useGh` directly (PR/issue lists, detail, comments, branches, actions, notifications) need no change. View migrations stay with V4a/b/c; the lint ban on `loading ?` in view bodies belongs to them.
