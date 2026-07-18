UPDATE signal_sources
SET source_type = 'rss',
    endpoint_url = 'https://openai.com/news/rss.xml',
    homepage_url = 'https://openai.com/news/',
    is_enabled = 1,
    requires_api_key = 0,
    config_json = '{"adapter":"rss"}',
    notes = 'Official OpenAI News RSS feed. No API key required.',
    updated_by = 'migration-0022',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'openai-news';

UPDATE signal_sources
SET source_type = 'page',
    endpoint_url = 'https://www.anthropic.com/news',
    homepage_url = 'https://www.anthropic.com/news',
    is_enabled = 1,
    requires_api_key = 0,
    config_json = '{"adapter":"anthropic_news"}',
    notes = 'Official Anthropic News page. The adapter only accepts article links under /news/.',
    updated_by = 'migration-0022',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'anthropic-news';

UPDATE signal_sources
SET source_type = 'api',
    endpoint_url = 'https://api.stlouisfed.org/fred/series/observations',
    homepage_url = 'https://fred.stlouisfed.org/',
    is_enabled = 0,
    fetch_interval_minutes = 360,
    max_items_per_run = 5,
    requires_api_key = 1,
    config_json = '{"adapter":"fred","secretBinding":"FRED_API_KEY","series":[{"id":"CPIAUCSL","label":"US Consumer Price Index","unit":"index"},{"id":"UNRATE","label":"US unemployment rate","unit":"percent"},{"id":"PAYEMS","label":"US nonfarm payroll employment","unit":"thousand persons"},{"id":"FEDFUNDS","label":"Effective federal funds rate","unit":"percent"},{"id":"DGS10","label":"10-year US Treasury yield","unit":"percent"}]}',
    notes = 'Uses the free FRED API. Configure the FRED_API_KEY Worker secret, then enable this source.',
    updated_by = 'migration-0022',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'fred-api';
