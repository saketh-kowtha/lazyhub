# Job: ci-triage (daily, builder)

Look at the CI and nightly runs that failed in the last 24 hours on `main` and on scheduled workflows
(`gh run list --status failure --created ">=$(date -v-1d +%Y-%m-%d)"`). For each distinct failure:

1. Classify it with evidence from the log: **regression** (name the suspect commit), **flaky** (passes
   on rerun or is timing-dependent), **environment** (runner, network, registry) or **dependency**.
2. Search for an existing open issue first (`gh issue list --search "<test name> in:title,body"`). If
   one exists, add a comment with the new run link and stop.
3. Otherwise open one issue: title `[CI] <test or job>: <symptom>`. The body gives the run link, the
   failing step, the error excerpt (with anything secret-looking redacted), the classification, and a
   suggested next step. Labels: `bug` and `triage`. Never add `agent:ready`; the maintainer decides.

Don't open more than 5 issues per run. Don't fix anything in this job.
