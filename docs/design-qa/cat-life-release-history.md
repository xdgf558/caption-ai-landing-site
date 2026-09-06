# Version notes: current update and folded history

Source: the user's screenshot of the existing v1.25.0 version page. This is a scoped interaction change, not a screen redesign. Product Design guidance kept the existing paper cards, colors and typography; native details/summary supplies the disclosure control without new visual assets.

Target source version: 1.25.1. Not deployed in this task.

Current notes contain only two changes for this patch. The original eleven notes are retained under their actual releases: 1.25.0 (3), 1.24.0 (3), 1.23.0 (4), 1.22.2 (1), in all three languages. All history starts collapsed; independent expansion is view-only and retained during in-session rerenders. A full reload resets history to collapsed.

Verified:

- Full npm test, including four new release-history tests, passed.
- Production build, JS syntax and diff checks passed.
- Chrome local UI: latest-only default, history expansion by click, keyboard Space collapse, and keeping an expanded entry after acknowledging the release (a full rerender).
- Desktop screenshot inspected: no redesign outside the release content, readable separate history rows.
- 390px Chrome viewport: DOM width 375 <= viewport 390, history click expanded the expected v1.24.0 content. Viewport restored afterward.

Limits:

- Chrome's mobile screenshot capture timed out; mobile checks were DOM/interaction checks, not screenshot QA.
- Two Playwright browser regression cases were added for 390/1280px, but the CLI suite was not run in this task. They remain for CI or a separately authorized browser-test run.
- No production account, cloud save, Worker, database or deployment was changed.
- Root design-qa.md remains the prior memories review; this record does not overwrite it.
