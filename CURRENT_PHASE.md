# Current Phase

Novel reading module phase 7F: order, account, credit, entitlement, and audit management in Admin 2.0.

Current task: make Admin 2.0 the operating center for commerce support work.

7F adds:

1. Fuller order filters, order detail, IPN event inspection, and paid-order fulfillment retry.
2. Reader account list/detail views with credit balance, ledger, orders, and entitlements.
3. Manual credit adjustment and entitlement grant/revoke audit logs.
4. Admin 2.0-first routing for new commerce operations.

Product direction:

- New admin features should be built in `/admin-v2/`.
- The old `/admin/` GitHub-token Markdown editor stays only for compatibility during migration.
- Old Markdown authoring should be removed after Stage 7G migrates legacy content into D1/R2.

Out of scope for 7F: legacy Markdown bulk migration, old admin removal, and cover image upload. Cover upload is tracked as a later 7H media-management option.
