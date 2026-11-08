# PR list: smart Enter (#314)

Enter on an open PR row goes to the most useful place and says why. First match wins.

```
 #412  Retry in webhook sender      @alice   ✗ 1/3     Enter -> failed check log
 #409  Add pagination               @bob     ✓         Enter -> Files changed   (scope: reviewing)
 #401  Rename config keys           @carol   ▲         Enter -> Merge row: "✗ Has conflicts"
 #398  Docs fix                     @dave    ✓         Enter -> Conversation

 toast on open:  CI failing (1 check): opened the failed check log
```

Closed and merged PRs, and drafts in the reviewing scope, open Conversation. `d`, `c` (checks, in detail) and Esc still reach every other place.
