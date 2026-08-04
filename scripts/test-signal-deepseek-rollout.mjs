import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const read = (path) => readFileSync(join(root, path), 'utf8');
const migrations = [
  'migrations/0007_backend_content_platform.sql',
  'migrations/0019_signal_automation.sql',
  'migrations/0020_signal_collection.sql',
  'migrations/0021_signal_candidate_triage.sql',
  'migrations/0022_signal_source_adapters.sql',
  'migrations/0023_signal_candidate_deduplication.sql',
  'migrations/0024_signal_operations.sql',
  'migrations/0025_signal_model_rollout.sql'
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
    return this.db.query(bindSql(this.sql, this.params))[0] || null;
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
    return output ? JSON.parse(output) : [];
  }
}

const candidateRows = [
  {
    category: 'ai',
    id: 'rollout-openai',
    sourceId: 'openai-news',
    summary: 'OpenAI published a model and API safety update with release notes covering deployment guidance, evaluation details, and documented behavior changes for developers.',
    title: 'OpenAI publishes a model and API safety update',
    url: 'https://openai.com/news/rollout-test'
  },
  {
    category: 'economy',
    id: 'rollout-fed',
    sourceId: 'federal-reserve-press',
    summary: 'The Federal Reserve published an economic policy update with the policy decision, current conditions, and details that frame how future economic data will be assessed.',
    title: 'Federal Reserve publishes an economic policy update',
    url: 'https://www.federalreserve.gov/newsevents/pressreleases/rollout-test.htm'
  },
  {
    category: 'tech',
    id: 'rollout-github',
    sourceId: 'github-changelog',
    summary: 'GitHub released a developer workflow update with documented changes to project setup, review automation, integration steps, and maintenance tasks for engineering teams.',
    title: 'GitHub updates developer workflows',
    url: 'https://github.blog/changelog/rollout-test/'
  }
];

const draftPayload = {
  category: 'ai',
  description: '今天關注模型政策、經濟判斷與開發工具的三項變化。',
  items: [
    {
      candidateId: 'rollout-openai',
      headline: 'OpenAI 更新模型與 API 安全資訊',
      noise: '公告尚未提供外部團隊長期使用後的可靠性與成本資料。',
      signal: '一手安全與介面資訊可協助開發團隊重新評估模型導入計畫。',
      summary: 'OpenAI 發布模型、API 與安全相關更新。'
    },
    {
      candidateId: 'rollout-fed',
      headline: '聯準會發布經濟政策更新',
      noise: '單次公告不足以確認長期利率方向，仍需結合後續資料。',
      signal: '官方政策說明可能改變市場對資金成本與政策路徑的判斷。',
      summary: '聯準會發布一項經濟政策更新。'
    },
    {
      candidateId: 'rollout-github',
      headline: 'GitHub 調整開發工作流程',
      noise: '公告尚未說明不同規模團隊採用後的維護成本與效率差異。',
      signal: '工作流程更新可能降低開發團隊整合工具時的操作成本。',
      summary: 'GitHub 發布一項開發工作流程更新。'
    }
  ],
  title: '模型、政策與開發工具動向'
};

const directory = mkdtempSync(join(tmpdir(), 'signal-deepseek-rollout-'));
const databasePath = join(directory, 'signal.sqlite');
const migrate = spawnSync('sqlite3', [databasePath], {
  encoding: 'utf8',
  input: migrations.map(read).join('\n')
});
assert.equal(migrate.status, 0, migrate.stderr);

try {
  const db = new SqliteD1(databasePath);
  assert.deepEqual(
    db.query("SELECT id, rollout_mode, deepseek_model, last_smoke_status FROM signal_model_rollout;")[0],
    {
      deepseek_model: 'deepseek-v4-pro',
      id: 'signal-brief',
      last_smoke_status: 'never',
      rollout_mode: 'off'
    }
  );
  assert.throws(
    () => db.query("UPDATE signal_model_rollout SET rollout_mode = 'automatic' WHERE id = 'signal-brief';"),
    /CHECK constraint failed/i
  );
  assert.throws(
    () => db.query("UPDATE signal_model_rollout SET deepseek_model = 'untrusted-model' WHERE id = 'signal-brief';"),
    /CHECK constraint failed/i
  );

  for (const candidate of candidateRows) {
    db.query(`
      INSERT INTO signal_candidates (
        id, source_id, canonical_url, title, summary, category, status, content_hash
      ) VALUES (
        ${sqlLiteral(candidate.id)}, ${sqlLiteral(candidate.sourceId)}, ${sqlLiteral(candidate.url)},
        ${sqlLiteral(candidate.title)}, ${sqlLiteral(candidate.summary)}, ${sqlLiteral(candidate.category)},
        'shortlisted', ${sqlLiteral(`hash-${candidate.id}`)}
      );
    `);
  }

  const disabledEnv = {
    AI: { run: async () => ({ response: draftPayload }) },
    DEEPSEEK_API_KEY: 'test-secret',
    SIGNAL_BRIEF_DEEPSEEK_ENABLED: '0',
    WAITLIST_DB: db
  };
  const disabledStatus = await hooks.handleAdminGetSignalBriefModelRollout(
    new Request('http://localhost/admin/api/signal/model-rollout'),
    disabledEnv
  );
  assert.equal(disabledStatus.status, 200);
  const disabledPayload = await disabledStatus.json();
  assert.equal(disabledPayload.rollout.masterGateEnabled, false);
  assert.equal(disabledPayload.rollout.canSmoke, false);
  assert.equal(disabledPayload.rollout.liveEffective, false);

  const prematureEnable = await hooks.handleAdminManageSignalBriefModelRollout(
    new Request('http://localhost/admin/api/signal/model-rollout', {
      body: JSON.stringify({ action: 'set_mode', confirmation: 'ENABLE_DEEPSEEK_PRIMARY', mode: 'live' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    }),
    disabledEnv
  );
  assert.equal(prematureEnable.status, 409);
  assert.equal((await prematureEnable.json()).code, 'SIGNAL_MODEL_NOT_READY_FOR_LIVE');

  const originalFetch = globalThis.fetch;
  let deepSeekCalls = 0;
  globalThis.fetch = async () => {
    deepSeekCalls += 1;
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draftPayload), role: 'assistant' } }],
        id: 'rollout-smoke',
        model: 'deepseek-v4-pro',
        usage: { completion_tokens: 600, prompt_tokens: 900, total_tokens: 1500 }
      }),
      { status: 200 }
    );
  };
  try {
    const liveEnv = { ...disabledEnv, SIGNAL_BRIEF_DEEPSEEK_ENABLED: '1' };
    const smokeResponse = await hooks.handleAdminManageSignalBriefModelRollout(
      new Request('http://localhost/admin/api/signal/model-rollout', {
        body: JSON.stringify({
          action: 'smoke_test',
          briefDate: '2026-07-22',
          candidateIds: candidateRows.map((candidate) => candidate.id),
          category: 'auto'
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      }),
      liveEnv
    );
    assert.equal(smokeResponse.status, 200);
    const smokePayload = await smokeResponse.json();
    assert.equal(smokePayload.preview.provider, 'deepseek');
    assert.equal(smokePayload.rollout.canEnableLive, true);
    assert.equal(smokePayload.rollout.lastSmoke.status, 'passed');
    assert.equal(db.query('SELECT COUNT(*) AS count FROM content_entries;')[0].count, 0);
    assert.equal(db.query("SELECT COUNT(*) AS count FROM admin_audit_logs WHERE action = 'signal_model_rollout_smoke_passed';")[0].count, 1);

    const enableResponse = await hooks.handleAdminManageSignalBriefModelRollout(
      new Request('http://localhost/admin/api/signal/model-rollout', {
        body: JSON.stringify({ action: 'set_mode', confirmation: 'ENABLE_DEEPSEEK_PRIMARY', mode: 'live' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      }),
      liveEnv
    );
    assert.equal(enableResponse.status, 200);
    assert.equal((await enableResponse.json()).rollout.liveEffective, true);

    const disableResponse = await hooks.handleAdminManageSignalBriefModelRollout(
      new Request('http://localhost/admin/api/signal/model-rollout', {
        body: JSON.stringify({ action: 'set_mode', mode: 'off' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      }),
      liveEnv
    );
    assert.equal(disableResponse.status, 200);
    assert.equal((await disableResponse.json()).rollout.liveEffective, false);

    db.query("UPDATE signal_model_rollout SET last_smoke_at = datetime('now', '-25 hours') WHERE id = 'signal-brief';");
    const staleEnable = await hooks.handleAdminManageSignalBriefModelRollout(
      new Request('http://localhost/admin/api/signal/model-rollout', {
        body: JSON.stringify({ action: 'set_mode', confirmation: 'ENABLE_DEEPSEEK_PRIMARY', mode: 'live' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      }),
      liveEnv
    );
    assert.equal(staleEnable.status, 409);
    assert.equal((await staleEnable.json()).code, 'SIGNAL_MODEL_NOT_READY_FOR_LIVE');
    assert.equal(deepSeekCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const adminPage = read('src/pages/admin-v2/index.astro');
  const workerSource = read('src/worker.js');
  assert.match(adminPage, /id="signal-model-rollout-title"/);
  assert.match(adminPage, /测试所选候选/);
  assert.match(adminPage, /只返回预览，不创建简报、不发布内容/);
  assert.match(workerSource, /SIGNAL_MODEL_ROLLOUT_NOT_READY/);
  assert.match(workerSource, /ENABLE_DEEPSEEK_PRIMARY/);
  assert.match(workerSource, /resolveSignalBriefModelRollout/);
  assert.match(workerSource, /Signal brief model rollout check failed closed/);
} finally {
  rmSync(directory, { force: true, recursive: true });
}

console.log('Signal DeepSeek controlled-rollout tests passed.');
