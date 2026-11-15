# Review Alpha tour: find the work, inspect the evidence, see why CI is red, return to the queue.
# Read-only throughout. Fixture data only (acme/rocket); nothing here is a safety verdict.
Output docs/demo/out/tour.gif
Output docs/demo/out/tour.mp4
Set Width 1500
Set Height 860
Source docs/demo/tapes/_settings.tape

Type "lazyhub"
Enter
Wait+Screen@30s /#142/
Sleep 1s
Screenshot docs/demo/out/tour-focus.png

# 1. Identify the work: the review queue says why each PR needs attention.
Type "gq"
Wait+Screen@30s /#141/
Sleep 1500ms
Type "j"
Sleep 2500ms
Screenshot docs/demo/out/tour-queue.png
Sleep 1s

# 2. Inspect the evidence: facts, sources, freshness, and what is unknown.
Enter
Wait+Screen@30s /Evidence/
Sleep 2500ms
Screenshot docs/demo/out/tour-evidence.png
Type "j"
Sleep 500ms
Type "j"
Sleep 500ms
Type "j"
Sleep 1500ms

# 3. Why is CI red? Open the PR, then the log excerpt matched to changed lines.
Enter
Sleep 2500ms
Screenshot docs/demo/out/tour-detail.png
Type "f"
Wait+Screen@30s /dedupe/
Sleep 3s
Screenshot docs/demo/out/tour-whyred.png
Sleep 1s
Escape
Sleep 1s

# 4. Other open PRs that touch the same files.
Type "K"
Sleep 3s
Screenshot docs/demo/out/tour-collisions.png
Sleep 1s
Escape
Sleep 1s

# 5. Back to the queue with the row kept.
Escape
Sleep 2500ms
Screenshot docs/demo/out/tour-back.png
Sleep 1500ms
