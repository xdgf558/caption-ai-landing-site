import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Isolated SQL adapter with fault injection. Never a production binding or migration runner.
export function musicTestDatabase() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for (const name of ['0001_music_foundation.sql', '0002_music_publication.sql', '0003_music_uploads.sql', '0004_music_cleanup.sql', '0005_music_rate_limits.sql', '0006_music_analytics.sql']) {
    sql.exec(readFileSync(new URL(`../../migrations-music/${name}`, import.meta.url), 'utf8'));
  }
  const state = { fail: null, skip: null, lose: false, beforeWrite: null };
  class Statement {
    constructor(query, params = []) { Object.assign(this, { query, params, statement: query }); }
    bind(...params) { assert.ok(params.length <= 100); return new Statement(this.query, params); }
    async all() { return { success: true, results: sql.prepare(this.query).all(...this.params) }; }
    async first() { return sql.prepare(this.query).get(...this.params) ?? null; }
    async run() { return { success: true, meta: sql.prepare(this.query).run(...this.params) }; }
  }
  const db = { prepare: query => new Statement(query),
    withSession(mode) { assert.equal(mode, 'first-primary'); return db; },
    async batch(statements) {
      const write = statements.some(s => !/^SELECT/.test(s.query));
      if (write && state.beforeWrite) { const fn = state.beforeWrite; state.beforeWrite = null; await fn(); }
      sql.exec('BEGIN');
      let results;
      try {
        results = statements.map(s => {
          if (write && state.fail?.test(s.query)) throw new Error('private injected SQL failure');
          if (write && state.skip?.test(s.query)) {
            sql.prepare('UPDATE music_tracks SET edit_version=edit_version WHERE id=?').run('absent');
            return { success: true, results: [] };
          }
          return { success: true, results: sql.prepare(s.query).all(...s.params) };
        });
        sql.exec('COMMIT');
      } catch (e) { sql.exec('ROLLBACK'); throw e; }
      if (write && state.lose) { state.lose = false; throw new Error('lost commit acknowledgement'); }
      return results;
    }
  };
  const dump = () => Object.fromEntries(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({ name }) => [name, sql.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()]));
  return { db, sql, state, dump };
}
