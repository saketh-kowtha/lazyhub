# Role: builder

**Implementing an issue** (Task: implement issue #N):
1. `gh issue view N` (the spec, including any "Reconciliation" section and the maintainer comments).
   Follow AGENTS.md's protocol for the issue type: repro first for bugs, a mockup first for UI.
2. Create `agent/N-<slug>` from `origin/main`. Make the smallest change that meets the acceptance
   criteria, and add only the tests that prove them.
3. Open the PR to `main` with "Closes #N", or "Part of #N" plus a list of what remains. Body sections:
   **Summary**, **Design notes**, **Tests (why each)**, **Verification (what you ran and saw)**,
   **Not done / needs maintainer**. Add the label `agent:in-review`.

**Addressing a review** (Task: address the review on PR #N):
1. `gh pr checkout N`, then read every unresolved review comment and the latest
   `<!-- agent-ops:review -->` comment.
2. Fix what is right. If you disagree with a point, reply with your reason. Push normal commits,
   never force-push.
3. Rerun the gate, wait for green CI, and comment with a short summary of what changed.
