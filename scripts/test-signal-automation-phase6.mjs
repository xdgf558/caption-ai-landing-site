import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import worker, { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migrationFiles = [
  'migrations/0007_backend_content_platform.sql',
  'migrations/0019_signal_automation.sql',
  'migrations/0020_signal_collection.sql',
  'migrations/0021_signal_candidate_triage.sql',
  'migrations/0022_signal_source_adapters.sql',
  'migrations/0023_signal_candidate_deduplication.sql',
  'migrations/0024_signal_operations.sql',
  'migrations/0026_archive_paused_signal_sources.sql'
];

const sqlLiteral = (value) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replaceAll("'", "''")}'`;
};

const bindSql = (sql, params) => {
  let index = 0;
  const bound = sql.replaceAll('?', () => {
    assert.ok(index < params.length, `Missing SQLite parameter for ${sql}`);
    return sqlLiteral(params[index++]);
  });
  assert.equal(index, params.length, `Unused SQLite parameters for ${sql}`);
  return bound;
};

class SqliteD1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new SqliteD1Statement(this.db, this.sql, params);
  }

  async first() {
    const rows = this.db.query(bindSql(this.sql, this.params));
    return rows[0] || null;
  }

  async all() {
    return { results: this.db.query(bindSql(this.sql, this.params)) };
  }

  async run() {
    const sql = bindSql(this.sql, this.params);
    if (/\bRETURNING\b/i.test(sql)) {
      const rows = this.db.query(sql);
      return { meta: { changes: rows.length }, results: rows, success: true };
    }
    const rows = this.db.query(`${sql};\nSELECT changes() AS changes;`);
    return { meta: { changes: Number(rows.at(-1)?.changes || 0) }, success: true };
  }
}

class SqliteD1 {
  constructor(path) {
    this.path = path;
  }

  prepare(sql) {
    return new SqliteD1Statement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  query(sql) {
    const result = spawnSync('sqlite3', [this.path], {
      encoding: 'utf8',
      input: `.bail on\n.mode json\nPRAGMA foreign_keys=ON;\n${sql}\n`
    });
    if (result.status !== 0) throw new Error(result.stderr.trim() || 'SQLite command failed.');
    const output = result.stdout.trim();
    if (!output) return [];
    try {
      return JSON.parse(output);
    } catch (error) {
      throw new Error(`Unable to parse SQLite output: ${output}`, { cause: error });
    }
  }
}

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'signal-automation-phase6-'));
const sqlitePath = join(sqliteDirectory, 'signal.sqlite');
const migrate = spawnSync('sqlite3', [sqlitePath], {
  encoding: 'utf8',
  input: migrationFiles.map(read).join('\n')
});
assert.equal(migrate.status, 0, migrate.stderr);

const prePhase6SqlitePath = join(sqliteDirectory, 'signal-pre-phase6.sqlite');
const migratePrePhase6 = spawnSync('sqlite3', [prePhase6SqlitePath], {
  encoding: 'utf8',
  input: migrationFiles.slice(0, -2).map(read).join('\n')
});
assert.equal(migratePrePhase6.status, 0, migratePrePhase6.stderr);

try {
  const db = new SqliteD1(sqlitePath);
  const schema = db.query(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'signal_automation_runtime') AS runtime_table,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'signal_automation_alerts') AS alerts_table,
      (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_signal_automation_alerts_status_severity') AS alerts_index,
      (SELECT COUNT(*) FROM pragma_table_info('signal_collection_runs') WHERE name = 'previous_run_id') AS previous_run_column,
      (SELECT COUNT(*) FROM signal_automation_runtime WHERE id = 'signal-collection' AND last_cron_status = 'never') AS runtime_seed;
  `)[0];
  assert.deepEqual(schema, {
    alerts_index: 1,
    alerts_table: 1,
    previous_run_column: 1,
    runtime_seed: 1,
    runtime_table: 1
  });

  assert.throws(
    () => db.query(`
      INSERT INTO signal_automation_alerts (id, dedupe_key, alert_type, severity, title, message)
      VALUES ('bad-alert', 'bad-alert', 'queue_failure', 'emergency', 'Bad', 'Bad');
    `),
    /CHECK constraint failed/i
  );

  const baseEnv = { WAITLIST_DB: db };
  const firstAlert = await hooks.openSignalAutomationAlert(baseEnv, {
    alertType: 'queue_failure',
    dedupeKey: 'test:dedupe',
    severity: 'warning',
    title: 'Queue warning',
    message: 'First occurrence'
  });
  const repeatedAlert = await hooks.openSignalAutomationAlert(baseEnv, {
    alertType: 'queue_failure',
    dedupeKey: 'test:dedupe',
    severity: 'warning',
    title: 'Queue warning',
    message: 'Second occurrence'
  });
  assert.equal(firstAlert.id, repeatedAlert.id);
  assert.equal(repeatedAlert.occurrenceCount, 2);

  const resolveResponse = await hooks.handleAdminManageSignalOperations(
    new Request('http://localhost/admin/api/signal/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'resolve_alert', alertId: firstAlert.id })
    }),
    baseEnv
  );
  assert.equal(resolveResponse.status, 200);
  assert.equal((await resolveResponse.json()).alert.status, 'resolved');

  db.query(`
    INSERT INTO signal_collection_runs (
      id, trigger_type, status, requested_source_ids_json, source_count,
      processed_source_count, failed_count, created_by
    ) VALUES ('failed-run', 'scheduled', 'failed', '["github-changelog"]', 1, 1, 1, 'signal-cron');
    INSERT INTO signal_collection_tasks (
      id, run_id, source_id, status, attempts, last_error, finished_at
    ) VALUES ('failed-task', 'failed-run', 'github-changelog', 'failed', 3, 'Source unavailable', CURRENT_TIMESTAMP);
  `);
  const queuedMessages = [];
  const retryEnv = {
    SIGNAL_COLLECTION_QUEUE: { sendBatch: async (messages) => queuedMessages.push(...messages) },
    WAITLIST_DB: db
  };
  const retryResponse = await hooks.handleAdminManageSignalOperations(
    new Request('http://localhost/admin/api/signal/operations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'retry_run', runId: 'failed-run' })
    }),
    retryEnv
  );
  assert.equal(retryResponse.status, 200);
  const retryPayload = await retryResponse.json();
  assert.equal(retryPayload.run.triggerType, 'retry');
  assert.equal(retryPayload.run.previousRunId, 'failed-run');
  assert.deepEqual(retryPayload.run.requestedSourceIds, ['github-changelog']);
  assert.equal(queuedMessages.length, 1);
  assert.equal(queuedMessages[0].body.sourceId, 'github-changelog');
  assert.equal(db.query("SELECT COUNT(*) AS count FROM admin_audit_logs WHERE action = 'signal_collection_retry';")[0].count, 1);

  await hooks.openSignalAutomationAlert(retryEnv, {
    alertType: 'run_failed',
    dedupeKey: 'run:failed-run:failure',
    severity: 'warning',
    title: 'Previous run failed',
    message: 'Retry should resolve this alert.',
    runId: 'failed-run'
  });
  const retryTask = db.query(
    `SELECT * FROM signal_collection_tasks WHERE run_id = ${sqlLiteral(retryPayload.run.id)} LIMIT 1;`
  )[0];
  const retrySource = db.query("SELECT * FROM signal_sources WHERE id = 'github-changelog';")[0];
  const completedRetryRun = await hooks.completeSignalCollectionTask(
    db,
    retrySource,
    retryTask,
    { etag: '', httpStatus: 304, items: [], lastModified: '', notModified: true },
    { acceptedCount: 0, duplicateCount: 0 },
    { env: retryEnv }
  );
  assert.equal(completedRetryRun.status, 'completed');
  assert.equal(completedRetryRun.previous_run_id, 'failed-run');
  const resolvedPreviousRunAlert = db.query(
    "SELECT status, resolved_by FROM signal_automation_alerts WHERE dedupe_key = 'run:failed-run:failure';"
  )[0];
  assert.deepEqual(resolvedPreviousRunAlert, { resolved_by: 'signal-queue', status: 'resolved' });

  db.query(`
    UPDATE signal_sources SET is_enabled = 0;
    UPDATE signal_automation_runtime
    SET last_cron_started_at = datetime('now', '-7 hours'), last_cron_status = 'skipped';
  `);
  const emailMessages = [];
  const scheduleEnv = {
    ADMIN_ALLOWED_EMAILS: 'alerts@example.com',
    EMAIL: { send: async (message) => emailMessages.push(message) },
    SIGNAL_COLLECTION_QUEUE: { sendBatch: async () => assert.fail('No disabled source should be queued') },
    WAITLIST_DB: db
  };
  const scheduleResult = await hooks.handleSignalCollectionSchedule(scheduleEnv, {
    cron: '17 * * * *',
    scheduledTime: Date.now()
  });
  assert.equal(scheduleResult.queued, 0);
  assert.equal(scheduleResult.operationsReady, true);
  const runtime = db.query("SELECT * FROM signal_automation_runtime WHERE id = 'signal-collection';")[0];
  assert.equal(runtime.last_cron_status, 'skipped');
  const schedulerGap = db.query("SELECT * FROM signal_automation_alerts WHERE dedupe_key = 'scheduler:gap';")[0];
  assert.equal(schedulerGap.severity, 'critical');
  assert.equal(emailMessages.length, 1);

  db.query(`
    UPDATE signal_sources SET is_enabled = 1 WHERE id = 'github-changelog';
    INSERT INTO signal_collection_runs (
      id, trigger_type, status, requested_source_ids_json, source_count, processed_source_count, created_by
    ) VALUES ('dlq-run', 'scheduled', 'queued', '["github-changelog"]', 1, 0, 'signal-cron');
    INSERT INTO signal_collection_tasks (id, run_id, source_id, status)
    VALUES ('dlq-task', 'dlq-run', 'github-changelog', 'queued');
  `);
  let dlqAcked = false;
  let dlqRetried = false;
  await hooks.handleSignalCollectionDeadLetterQueue(
    {
      queue: 'station-cat-signal-collection-dlq',
      messages: [
        {
          attempts: 4,
          body: { version: 1, runId: 'dlq-run', sourceId: 'github-changelog' },
          ack: () => { dlqAcked = true; },
          retry: () => { dlqRetried = true; }
        }
      ]
    },
    scheduleEnv
  );
  assert.equal(dlqAcked, true);
  assert.equal(dlqRetried, false);
  assert.equal(db.query("SELECT status FROM signal_collection_tasks WHERE id = 'dlq-task';")[0].status, 'failed');
  assert.equal(db.query("SELECT status FROM signal_collection_runs WHERE id = 'dlq-run';")[0].status, 'failed');
  assert.equal(
    db.query("SELECT COUNT(*) AS count FROM signal_automation_alerts WHERE alert_type = 'dead_letter' AND status = 'open';")[0].count,
    1
  );

  let primaryRetried = false;
  let primaryAcked = false;
  await hooks.handleSignalCollectionQueue(
    {
      queue: 'station-cat-signal-collection',
      messages: [
        {
          attempts: 1,
          body: { version: 1, runId: '', sourceId: '' },
          ack: () => { primaryAcked = true; },
          retry: () => { primaryRetried = true; }
        }
      ]
    },
    baseEnv
  );
  assert.equal(primaryRetried, true);
  assert.equal(primaryAcked, false);

  const operationsResponse = await hooks.handleAdminGetSignalOperations(
    new Request('http://localhost/admin/api/signal/operations'),
    scheduleEnv
  );
  assert.equal(operationsResponse.status, 200);
  const operationsPayload = await operationsResponse.json();
  assert.equal(operationsPayload.setupRequired, false);
  assert.ok(['critical', 'degraded'].includes(operationsPayload.health.state));
  assert.ok(operationsPayload.alerts.some((alert) => alert.alertType === 'dead_letter'));

  const setupResponse = await hooks.handleAdminGetSignalOperations(
    new Request('http://localhost/admin/api/signal/operations'),
    { WAITLIST_DB: new SqliteD1(prePhase6SqlitePath) }
  );
  assert.equal(setupResponse.status, 200);
  assert.deepEqual(await setupResponse.json(), {
    code: 'SIGNAL_OPERATIONS_NOT_READY',
    message: '先应用 migrations/0024_signal_operations.sql，再查看自动化运行状态。',
    migration: '0024_signal_operations.sql',
    ok: true,
    setupRequired: true
  });

  const protectedEnv = {
    ADMIN_ALLOWED_EMAILS: 'admin@example.com',
    CF_ACCESS_AUD: 'test-audience',
    CF_ACCESS_TEAM_DOMAIN: 'stationcat.cloudflareaccess.com'
  };
  for (const method of ['GET', 'POST']) {
    const response = await worker.fetch(
      new Request('https://wwwstationcat.org/admin/api/signal/operations', { method }),
      protectedEnv,
      {}
    );
    assert.equal(response.status, 401, `${method} Signal operations route must require Cloudflare Access`);
  }
} finally {
  rmSync(sqliteDirectory, { force: true, recursive: true });
}

const migration = read('migrations/0024_signal_operations.sql');
assert.match(migration, /CREATE TABLE IF NOT EXISTS signal_automation_runtime/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS signal_automation_alerts/);
assert.match(migration, /ADD COLUMN previous_run_id TEXT/);
assert.match(migration, /UNIQUE/);

const workerSource = read('src/worker.js');
assert.match(workerSource, /\/admin\/api\/signal\/operations/);
assert.match(workerSource, /handleSignalCollectionDeadLetterQueue/);
assert.match(workerSource, /signalAutomationLog\('info', 'cron_completed'/);
assert.match(workerSource, /triggerType: 'retry'/);
assert.match(workerSource, /source\.consecutive_failures, 0\) > 0/);
assert.match(workerSource, /syncSignalRetrySuccessAlert\(options\.env, run\)/);

const adminSource = read('src/pages/admin-v2/index.astro');
assert.match(adminSource, /Automation phase 6/);
assert.match(adminSource, /id="signal-operations-health"/);
assert.match(adminSource, /id="signal-alerts-list"/);
assert.match(adminSource, /重试失败来源/);
assert.match(adminSource, /标记已处理/);

const wrangler = read('wrangler.toml');
assert.match(wrangler, /crons = \["17 \* \* \* \*"\]/);
assert.match(wrangler, /dead_letter_queue = "station-cat-signal-collection-dlq"/);
assert.match(wrangler, /queue = "station-cat-signal-collection-dlq"/);
assert.match(wrangler, /\[observability\][\s\S]*enabled = true/);

console.log('Signal automation phase 6 operations, heartbeat, retry, DLQ, migration, and Admin checks passed.');
