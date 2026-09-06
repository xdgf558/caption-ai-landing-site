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
- Initial implementation added two Playwright regression cases without running the CLI suite. In the PR #102 review follow-up, both cases were strengthened and run five times each: 10/10 passed. They explicitly call `CatGameApp.render()` while expanded and perform `page.reload()` from an expanded state, verifying the collapsed default after re-entering the version page.
- No production account, cloud save, Worker, database or deployment was changed.
- Root design-qa.md remains the prior memories review; this record does not overwrite it.

PR #102 P3 follow-up: English uses `Changes: {{count}}` to avoid incorrect singular grammar; the content-pack publishing checklist now requires archiving all three locales into `releaseHistory` before replacing the current notes. Full npm test, project build, syntax and diff checks passed again. The separately reported baseline one-second rerender interaction-test issue was not modified as part of these fixes.
