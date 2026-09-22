# R2 CI follow-up — 2026-09-22

The failed website run [35740587942](https://github.com/xdgf558/caption-ai-landing-site/actions/runs/35740587942) tested `595f739`. Its complete failed-step log was retained locally; SHA-256: `36c5be35f61b51ffe546e828e5e9da47424a455815ab9747aa23b2c78aecf263`.

The failure was in `scripts/test-deletion-lifecycle.mjs`, not a form-policy assertion. Node reported `testTimeoutFailure` at the file's first line after 120,031 ms, with a 120,000 ms budget. The first three sequential persistent-D1 cases had passed in 7,985, 30,568 and 42,129 ms respectively. The fourth had not completed before the file budget expired; later lifecycle cases and subsequent CI steps were not verified by that run.

The lifecycle command now keeps receipt-codec tests on their existing 120-second file budget and gives the nine sequential persistent-D1 scenarios a separate ten-minute file budget. Each lifecycle case still has its own 120-second limit; setup is bounded to 60 seconds and cleanup to 30 seconds. Case start/end diagnostics report only fixed test names and durations, so a future timeout identifies the active scenario. No assertions, executor queries, migrations, production routes, deletion leases or authentication replay windows are changed.

Local Node 24.15.0 / Miniflare reran all nine lifecycle cases and three receipt-codec cases: 12 passed, zero failures or skips, 69.838 seconds. The longest local lifecycle case was 15.570 seconds. These local timings explain neither the exact CI scheduler load nor a production timeout; the original CI evidence and the bounded full rerun are assessed separately.

The paired iOS failure is different: its media step stopped during stable-Xcode test compilation, before the AVPlayer fixture started. See iOS PR #10 for the actor-initializer compatibility fix and evidence. Neither failure justifies changing the reviewed form Origin rules or product startup flow.

The latest PR checks must complete the full website workflow, including lifecycle, R2, deletion inventory, build, browser and package checks. Earlier local HTTPS acceptance does not replace these checks. The original failures remain part of the evidence, and neither PR is merged or production-deployed by this follow-up.
