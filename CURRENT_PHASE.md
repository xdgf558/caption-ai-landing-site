# Current Phase

Novel reading module phase 7E-B: frontend checkout consumes backend pricing rules.

Current task: make reader-facing gates, tip buttons, reading-credit unlocks, and NOWPayments checkout resolve pricing from backend D1 rules first.

Pricing resolution order:

1. `content_pricing_rules`
2. `content_entries.pricing_json`
3. Generated legacy `novelPaymentConfig`
4. Environment defaults

Out of scope for 7E-B: full order/account/entitlement management UI, old Markdown admin removal, and bulk static content migration.
