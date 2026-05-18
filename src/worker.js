const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const cleanText = (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength);

const cleanPlatform = (value) => {
  const platform = String(value || '').trim().toLowerCase();
  return platform === 'android' ? 'android' : 'ios';
};

const getSetting = (db, product, platform) =>
  db
    .prepare(
      `SELECT product, platform, public_link, capacity, distributed_count, is_active, updated_at
       FROM waitlist_settings
       WHERE product = ? AND platform = ?`
    )
    .bind(product, platform)
    .first();

const ensureSetting = async (db, product, platform) => {
  await db
    .prepare(`INSERT OR IGNORE INTO waitlist_settings (product, platform) VALUES (?, ?)`)
    .bind(product, platform)
    .run();
  return getSetting(db, product, platform);
};

const upsertEntry = async (db, data, request) => {
  const userAgent = cleanText(request.headers.get('user-agent'), 300);
  await db
    .prepare(
      `INSERT INTO waitlist_entries (
        product, platform, locale, email, normalized_email, source, landing_path,
        utm_source, utm_medium, utm_campaign, utm_content, user_agent
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product, platform, normalized_email) DO UPDATE SET
        email = excluded.email,
        locale = excluded.locale,
        source = excluded.source,
        landing_path = excluded.landing_path,
        utm_source = excluded.utm_source,
        utm_medium = excluded.utm_medium,
        utm_campaign = excluded.utm_campaign,
        utm_content = excluded.utm_content,
        user_agent = excluded.user_agent,
        updated_at = CURRENT_TIMESTAMP`
    )
    .bind(
      data.product,
      data.platform,
      data.locale,
      data.email,
      data.normalizedEmail,
      data.source,
      data.landingPath,
      data.utmSource,
      data.utmMedium,
      data.utmCampaign,
      data.utmContent,
      userAgent
    )
    .run();

  return db
    .prepare(
      `SELECT id, invite_status, invite_url
       FROM waitlist_entries
       WHERE product = ? AND platform = ? AND normalized_email = ?`
    )
    .bind(data.product, data.platform, data.normalizedEmail)
    .first();
};

const handleWaitlistSubmit = async (request, env) => {
  if (!env.WAITLIST_DB) {
    return json({ ok: false, message: 'Waitlist database is not configured.' }, { status: 500 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(payload.email);
  if (!isEmail(normalizedEmail)) {
    return json({ ok: false, message: 'Please enter a valid email address.' }, { status: 400 });
  }

  const data = {
    product: cleanText(payload.product || 'snapcopy', 80) || 'snapcopy',
    platform: cleanPlatform(payload.platform),
    locale: cleanText(payload.locale, 20),
    email: cleanText(payload.email, 254),
    normalizedEmail,
    source: cleanText(payload.source, 120),
    landingPath: cleanText(payload.landing_path, 300),
    utmSource: cleanText(payload.utm_source, 120),
    utmMedium: cleanText(payload.utm_medium, 120),
    utmCampaign: cleanText(payload.utm_campaign, 120),
    utmContent: cleanText(payload.utm_content, 120)
  };

  const db = env.WAITLIST_DB;
  await ensureSetting(db, data.product, data.platform);
  const entry = await upsertEntry(db, data, request);
  const setting = await getSetting(db, data.product, data.platform);

  if (entry?.invite_status === 'delivered' && entry.invite_url) {
    return json({
      ok: true,
      status: 'invite',
      message: 'You are already on the test list. Here is your invite link again.',
      publicLink: entry.invite_url,
      capacity: setting?.capacity ?? 0,
      distributedCount: setting?.distributed_count ?? 0
    });
  }

  const canDistribute =
    setting &&
    Number(setting.is_active) === 1 &&
    String(setting.public_link || '').startsWith('https://testflight.apple.com/join/') &&
    Number(setting.capacity) > 0 &&
    data.platform === 'ios';

  if (canDistribute) {
    const allocation = await db
      .prepare(
        `UPDATE waitlist_settings
         SET distributed_count = distributed_count + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE product = ?
           AND platform = ?
           AND is_active = 1
           AND public_link <> ''
           AND distributed_count < capacity
         RETURNING public_link, capacity, distributed_count`
      )
      .bind(data.product, data.platform)
      .first();

    if (allocation?.public_link) {
      await db
        .prepare(
          `UPDATE waitlist_entries
           SET invite_status = 'delivered',
               invite_url = ?,
               invite_delivered_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(allocation.public_link, entry.id)
        .run();

      return json({
        ok: true,
        status: 'invite',
        message: 'Your test slot is ready. Open the TestFlight link below.',
        publicLink: allocation.public_link,
        capacity: allocation.capacity,
        distributedCount: allocation.distributed_count
      });
    }
  }

  return json({
    ok: true,
    status: 'waitlisted',
    message:
      data.platform === 'ios'
        ? 'Your test request was received. The current TestFlight round is full or not open yet.'
        : 'You are on the Android updates list.',
    capacity: setting?.capacity ?? 0,
    distributedCount: setting?.distributed_count ?? 0
  });
};

const handleGetSettings = async (env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Waitlist database is not configured.' }, { status: 500 });

  await ensureSetting(db, 'snapcopy', 'ios');
  await ensureSetting(db, 'snapcopy', 'android');

  const settings = await db
    .prepare(
      `SELECT product, platform, public_link, capacity, distributed_count, is_active, updated_at
       FROM waitlist_settings
       WHERE product = 'snapcopy'
       ORDER BY platform DESC`
    )
    .all();

  const counts = await db
    .prepare(
      `SELECT platform,
              COUNT(*) AS total,
              SUM(CASE WHEN invite_status = 'delivered' THEN 1 ELSE 0 END) AS delivered
       FROM waitlist_entries
       WHERE product = 'snapcopy'
       GROUP BY platform`
    )
    .all();

  return json({ ok: true, settings: settings.results || [], counts: counts.results || [] });
};

const handleUpdateSettings = async (request, env) => {
  const db = env.WAITLIST_DB;
  if (!db) return json({ ok: false, message: 'Waitlist database is not configured.' }, { status: 500 });

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid request body.' }, { status: 400 });
  }

  const platform = cleanPlatform(payload.platform);
  const publicLink = cleanText(payload.publicLink, 500);
  const capacity = Math.max(0, Math.min(10000, Number.parseInt(payload.capacity, 10) || 0));
  const isActive = payload.isActive ? 1 : 0;
  const resetCount = Boolean(payload.resetCount);

  if (platform === 'ios' && publicLink && !publicLink.startsWith('https://testflight.apple.com/join/')) {
    return json({ ok: false, message: 'TestFlight link must start with https://testflight.apple.com/join/' }, { status: 400 });
  }

  await ensureSetting(db, 'snapcopy', platform);

  if (resetCount) {
    await db
      .prepare(
        `UPDATE waitlist_settings
         SET public_link = ?, capacity = ?, distributed_count = 0, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE product = 'snapcopy' AND platform = ?`
      )
      .bind(publicLink, capacity, isActive, platform)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE waitlist_settings
         SET public_link = ?, capacity = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE product = 'snapcopy' AND platform = ?`
      )
      .bind(publicLink, capacity, isActive, platform)
      .run();
  }

  return handleGetSettings(env);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/api/waitlist') {
      return handleWaitlistSubmit(request, env);
    }

    if (url.pathname === '/admin/api/waitlist/settings') {
      if (request.method === 'GET') return handleGetSettings(env);
      if (request.method === 'POST') return handleUpdateSettings(request, env);
      return json({ ok: false, message: 'Method not allowed.' }, { status: 405 });
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  }
};
