import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const baseMigrationPaths = [
  'migrations/0019_signal_automation.sql',
  'migrations/0020_signal_collection.sql',
  'migrations/0021_signal_candidate_triage.sql',
  'migrations/0022_signal_source_adapters.sql'
];
const laterMigrationPaths = [
  'migrations/0023_signal_candidate_deduplication.sql',
  'migrations/0024_signal_operations.sql',
  'migrations/0025_signal_model_rollout.sql'
];
const archivalMigration = read('migrations/0026_archive_paused_signal_sources.sql');
const workerSource = read('src/worker.js');

assert.match(archivalMigration, /ALTER TABLE signal_sources ADD COLUMN archived_at TEXT/);
assert.match(archivalMigration, /WHERE id IN \('fred-api', 'arxiv-ai-recent'\)/);
assert.match(archivalMigration, /UPDATE signal_automation_alerts/);
assert.match(workerSource, /FROM signal_sources\s+WHERE archived_at IS NULL\s+ORDER BY/);
assert.match(workerSource, /const filters = \['is_enabled = 1', 'archived_at IS NULL'\]/);
assert.match(
  workerSource,
  /FROM signal_sources\s+WHERE archived_at IS NULL\s+AND \(consecutive_failures > 0 OR last_error <> ''\)/
);

const sqliteDirectory = mkdtempSync(join(tmpdir(), 'signal-source-archival-'));
const sqlitePath = join(sqliteDirectory, 'signal.sqlite');
const runSqlite = (input) => spawnSync('sqlite3', [sqlitePath], { encoding: 'utf8', input });

try {
  const baseMigration = runSqlite(baseMigrationPaths.map(read).join('\n'));
  assert.equal(baseMigration.status, 0, baseMigration.stderr);

  const historySeed = runSqlite(`
    INSERT INTO signal_collection_runs (id, trigger_type, status, source_count, processed_source_count)
    VALUES ('archival-run', 'scheduled', 'completed', 1, 1);
    INSERT INTO signal_collection_tasks (id, run_id, source_id, status, attempts)
    VALUES ('archival-task', 'archival-run', 'arxiv-ai-recent', 'completed', 1);
    INSERT INTO signal_candidates (
      id, source_id, run_id, canonical_url, title, content_hash
    ) VALUES (
      'archival-candidate', 'arxiv-ai-recent', 'archival-run',
      'https://arxiv.org/abs/2607.00001', 'Archived paper', 'archival-hash'
    );
  `);
  assert.equal(historySeed.status, 0, historySeed.stderr);

  const laterMigration = runSqlite(laterMigrationPaths.map(read).join('\n'));
  assert.equal(laterMigration.status, 0, laterMigration.stderr);

  const alertSeed = runSqlite(`
    INSERT INTO signal_automation_alerts (
      id, dedupe_key, alert_type, severity, status, title, message, source_id
    ) VALUES (
      'archival-alert', 'source:arxiv-ai-recent:test', 'source_failures',
      'warning', 'open', 'Source failed', 'Timeout', 'arxiv-ai-recent'
    );
  `);
  assert.equal(alertSeed.status, 0, alertSeed.stderr);

  const migrate = runSqlite(archivalMigration);
  assert.equal(migrate.status, 0, migrate.stderr);

  const verification = runSqlite(`
    SELECT
      (SELECT COUNT(*) FROM signal_sources WHERE archived_at IS NULL)
      || '|' || (SELECT COUNT(*) FROM signal_sources WHERE archived_at IS NOT NULL)
      || '|' || (SELECT COUNT(*) FROM signal_sources WHERE is_enabled = 1 AND archived_at IS NULL)
      || '|' || (SELECT COUNT(*) FROM signal_candidates WHERE source_id = 'arxiv-ai-recent')
      || '|' || (SELECT COUNT(*) FROM signal_collection_tasks WHERE source_id = 'arxiv-ai-recent')
      || '|' || (SELECT COUNT(*) FROM signal_candidate_occurrences WHERE source_id = 'arxiv-ai-recent')
      || '|' || (SELECT status FROM signal_automation_alerts WHERE id = 'archival-alert')
      || '|' || (SELECT COUNT(*) FROM signal_sources
                   WHERE id IN ('fred-api', 'arxiv-ai-recent')
                     AND is_enabled = 0
                     AND archived_at IS NOT NULL);
  `);
  assert.equal(verification.status, 0, verification.stderr);
  assert.equal(verification.stdout.trim(), '6|2|6|1|1|1|resolved|2');
} finally {
  rmSync(sqliteDirectory, { force: true, recursive: true });
}

console.log('Signal source archival migration and history-preservation checks passed.');
