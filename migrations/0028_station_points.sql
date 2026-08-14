UPDATE reader_credit_accounts
SET currency_label = 'Station Points',
    updated_at = CURRENT_TIMESTAMP
WHERE currency_label IN ('SC Credits', 'SC Reading Credits');

UPDATE admin_content_settings
SET setting_json = json_set(
      setting_json,
      '$.pricing.creditPacks',
      json('[{"credits":100,"label":"100 Station Points","priceAmount":10,"priceCurrency":"USD"}]')
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE setting_key = 'content.pricing-defaults.v1';
