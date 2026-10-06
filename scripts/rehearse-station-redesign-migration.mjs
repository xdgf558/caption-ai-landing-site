import { sqliteRehearsalDatabase, rehearseMigration, localD1Rehearsal, migrationHash } from './helpers/station-redesign-database.mjs';

// Fixed, ephemeral local databases only. There are no --remote, --database,
// credential, environment binding or arbitrary output-path options.
if (process.argv.length !== 2) throw new Error('This rehearsal takes no arguments and cannot target an existing database.');
const sqlite = sqliteRehearsalDatabase();
let sqliteReport;
try { sqliteReport = await rehearseMigration(sqlite.db); }
finally { sqlite.sql.close(); }
const d1Report = await localD1Rehearsal();
console.log(JSON.stringify({
  executedAt: new Date().toISOString(), scope: 'synthetic local SQLite and ephemeral Miniflare D1; no remote state',
  migrationSha256: migrationHash, sqlite: sqliteReport, nativeD1: d1Report,
  excludes: ['production schema', 'real orders or membership', 'R2 object readiness or licenses',
    'HTTP publication or authorization', 'cache invalidation', 'old entry closure'],
}, null, 2));
