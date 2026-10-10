import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createStationRouteRuntime } from './station-route-runtime.mjs';
import { reportBindings, reportMigrationGroups } from './station-report-fixture.mjs';
import { catLifeSaveHarness } from './cat-life-save-harness.mjs';
import { migrationFlags } from '../../src/redesign/routeMigrationPaths.js';
import { createCampaign } from '../../src/redesign/campaignStore.js';
import { runStationReportRetention } from '../../src/redesign/reportsSchedule.js';
import { runStationEventRetention } from '../../src/redesign/analyticsStore.js';

const fixtureHeaders = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Content-Type-Options': 'nosniff' };
const scenarios = ['missing', 'valid', 'corrupt', 'future', 'unavailable', 'identity-error', 'boot-failure', 'never-ready'];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };

// Instrumentation is added ONLY by this loopback server. It never changes the
// deployed page. Values are laboratory observations, not field Web Vitals.
const metricsScript = `(function(){
  var sample={lcpMs:null,lcpElement:null,cls:0,unsupported:[],atMs:0,resources:[],userAgent:navigator.userAgent,viewport:{}};
  ['largest-contentful-paint','layout-shift'].forEach(function(type){try{new PerformanceObserver(function(list){list.getEntries().forEach(function(entry){if(type==='largest-contentful-paint'){sample.lcpMs=entry.startTime;var el=entry.element;sample.lcpElement=el?{tag:el.tagName,className:el.className,path:el.currentSrc?new URL(el.currentSrc,location.href).pathname:null,size:entry.size}:null;}else if(!entry.hadRecentInput)sample.cls+=entry.value;});}).observe({type:type,buffered:true});}catch(e){sample.unsupported.push(type);}});
  function write(){var node=document.querySelector('[data-t21-metrics]');if(!node)return;sample.atMs=performance.now();sample.viewport={width:innerWidth,height:innerHeight,dpr:devicePixelRatio,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};sample.resources=performance.getEntriesByType('resource').map(function(r){var u=new URL(r.name,location.href);return {path:u.pathname,type:r.initiatorType,durationMs:r.duration,transferBytes:r.transferSize};});node.textContent=JSON.stringify(sample);}
  document.addEventListener('DOMContentLoaded',write);window.addEventListener('load',write);window.setInterval(write,500);
})();`;
const banner = '<aside style="padding:8px 18px;background:#f1f0fa;color:#465271;font:12px/1.6 system-ui" data-t21-fixture>T21 本机验收 · 合成音乐/视频，临时 D1/R2，游戏原有运行端 · 主推和真实发行资料仍待确定 · 不代表生产或真机通过</aside><output hidden data-t21-metrics></output>';

export async function createStationCorePreview({ port = 4221, network = 'loopback' } = {}) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || !['loopback', 'mobile-lab'].includes(network)) throw new Error('Invalid local preview configuration');
  const origin = 'http://127.0.0.1:' + port;
  const localBindings = { ...reportBindings, ...Object.fromEntries(migrationFlags.map(key => [key, 'true'])), STATION_SEARCH_INDEXING_ENABLED: 'false', STATION_CAMPAIGNS_ENABLED: 'true' };
  const runtime = await createStationRouteRuntime({ videoCases: true, bindings: localBindings });
  try {
    // Apply later compatible versions in order, after the legacy rows have gone
    // through 0012 backfill. Do not replay old migrations over the newer schema.
    for (const group of reportMigrationGroups().filter(item => /^001[3-8]_/.test(item.name))) {
      for (let i = 0; i < group.statements.length; i += 20) await runtime.db.batch(group.statements.slice(i, i + 20).map(sql => runtime.db.prepare(sql)));
      await runtime.db.prepare('INSERT INTO d1_migrations(name,applied_at) VALUES(?,?)').bind(group.name, new Date().toISOString()).run();
    }
    await createCampaign({ db: runtime.db, bucket: runtime.bucket }, runtime.content.tracks[1].id, { id: 't21-synthetic-campaign', source: 'douyin', medium: 'short_video', clipId: runtime.content.clip.id, locale: 'zh-Hant', legacySources: [], status: 'active', reason: 'T21 合成验收' }, { actorId: 't21-local-fixture@example.test', key: randomUUID() });
    await runtime.db.prepare("UPDATE station_home_configs SET status='draft'").run();
    await runStationEventRetention({ ...localBindings, MUSIC_DB: runtime.db });
    await runStationReportRetention({ ...localBindings, MUSIC_DB: runtime.db });
  } catch (error) { await runtime.close(); throw error; }
  const save = catLifeSaveHarness().game.state.game; save.player.gold = 87; save.meta.scT12Fixture = 'agent-preview-only';
  let control = await readFile(new URL('../fixtures/station-games/control.js', import.meta.url), 'utf8');
  const labelPattern = /var labels = \{[^\n]+\};/g;
  if ([...control.matchAll(labelPattern)].length !== 1) { await runtime.close(); throw new Error('Review the shared fixture control before use'); }
  control = control.replace(labelPattern, 'var labels = ' + JSON.stringify({ missing: '新游客', valid: '有效存档', corrupt: '损坏存档', future: '未来版本', unavailable: '模拟存储不可访问', 'identity-error': '账号核对失败', 'boot-failure': '模拟引擎加载失败', 'never-ready': '模拟没有就绪确认' }) + ';');
  const records = [], profile = network === 'mobile-lab' ? { latencyMs: 150, bytesPerSecondPerResponse: 200000, cpuThrottle: false, sharedLinkSimulation: false } : { latencyMs: 0, bytesPerSecondPerResponse: null, cpuThrottle: false, sharedLinkSimulation: false };
  let statisticsFailure = false, closed = false;
  const server = http.createServer(async (incoming, outgoing) => {
    const started = Date.now(); let path;
    try {
      if (!['GET', 'HEAD', 'POST'].includes(incoming.method) || incoming.headers.host !== '127.0.0.1:' + port || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) throw new Error('Local request rejected');
      const url = new URL(incoming.url, origin); path = url.pathname;
      if (url.origin !== origin || /^(?:\/admin|\/__fixture\/.*\/|\/fixture-)/.test(path)) throw new Error('Excluded route');
      const selected = /(?:^|;\s*)scT21Scenario=([a-z-]+)/.exec(incoming.headers.cookie || '')?.[1], scenario = scenarios.includes(selected) ? selected : 'missing';
      let response;
      if (path === '/__fixture/select' && incoming.method === 'GET') {
        const next = url.searchParams.get('scenario'); response = new Response(scenarios.includes(next) ? 'Selected disposable save fixture' : 'Unknown fixture', { status: scenarios.includes(next) ? 200 : 400, headers: scenarios.includes(next) ? { 'Set-Cookie': 'scT21Scenario=' + next + '; Path=/; SameSite=Strict; HttpOnly' } : {} });
      } else if (path === '/__fixture/statistics-failure' && incoming.method === 'GET') {
        statisticsFailure = url.searchParams.get('enabled') === '1'; response = Response.json({ statisticsFailure });
      } else if (path === '/__fixture/options.js' && incoming.method !== 'POST') {
        response = new Response('window.scT12Options=' + JSON.stringify({ scenario: ['boot-failure','never-ready'].includes(scenario) ? 'valid' : scenario, save }) + ';', { headers: { 'Content-Type': types['.js'] } });
      } else if (path === '/__fixture/control.js' && incoming.method !== 'POST') response = new Response(control, { headers: { 'Content-Type': types['.js'] } });
      else if (path === '/__fixture/observations' && incoming.method !== 'POST') {
        response = Response.json({ production: false, network, profile, statisticsFailure, media: runtime.content.mediaProof,
          migrationLedger: (await runtime.db.prepare('SELECT name FROM d1_migrations ORDER BY name').all()).results.map(row => row.name),
          events: (await runtime.db.prepare('SELECT event_name AS name,COUNT(*) AS count FROM station_analytics_events GROUP BY event_name ORDER BY event_name').all()).results, records });
      } else if (incoming.method === 'POST' && (path !== '/api/station/events' || incoming.headers.origin !== origin || incoming.headers['x-requested-with'] !== 'StationCatEvents')) throw new Error('Only local synthetic events may write');
      else if (['/api/readers/session', '/api/readers/game-saves/cat-life'].includes(path)) response = Response.json(scenario === 'identity-error' ? { ok: false } : path.endsWith('/session') ? { ok: true, authenticated: false } : { ok: true, save: null }, { status: scenario === 'identity-error' ? 503 : 200 });
      else if (statisticsFailure && path === '/api/station/events') response = Response.json({ ok: false, code: 'SYNTHETIC_STATISTICS_FAILURE' }, { status: 503 });
      else if (scenario === 'boot-failure' && path === '/games/cat-life/src/js/main.js') response = new Response('Intentional local game boot failure', { status: 503 });
      else if (scenario === 'never-ready' && path === '/games/cat-life/host-bridge.js') response = new Response('// Local fixture withholds ready acknowledgement', { headers: { 'Content-Type': types['.js'] } });
      else {
        const headers = new Headers({ 'CF-Connecting-IP': '192.0.2.121' });
        // Only transport fields are forwarded. Real cookies, Access credentials,
        // fixture rollout headers and user identity never leave this server.
        for (const key of ['accept','range','if-none-match','content-type','origin','x-requested-with']) if (incoming.headers[key]) headers.set(key, incoming.headers[key]);
        response = await runtime.mf.dispatchFetch(url, { method: incoming.method, headers, redirect: 'manual', ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
      }
      const html = incoming.method === 'GET' && response.headers.get('Content-Type')?.includes('text/html');
      if (html) {
        const headers = new Headers(response.headers); for (const key of ['Content-Length','ETag','Content-Encoding']) headers.delete(key);
        const gameControl = /\/games(?:\/cat-life-game)?\/$/.test(path) || path === '/games/cat-life/';
        response = new Response((await response.text()).replace('</head>', '<script>' + metricsScript + '</script>' + (gameControl ? '<script src="/__fixture/options.js"></script><script src="/__fixture/control.js"></script>' : '') + '</head>').replace(/(<body[^>]*>)/, '$1' + banner), { status: response.status, headers });
      }
      if (profile.latencyMs) await new Promise(resolveDelay => setTimeout(resolveDelay, profile.latencyMs));
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), ...fixtureHeaders });
      let bytes = 0;
      if (incoming.method !== 'HEAD' && response.body) {
        const reader = response.body.getReader();
        try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length;
          if (profile.bytesPerSecondPerResponse) await new Promise(resolveDelay => setTimeout(resolveDelay, value.length * 1000 / profile.bytesPerSecondPerResponse));
          if (outgoing.destroyed) { await reader.cancel(); break; }
          if (!outgoing.write(value)) await new Promise(resolveDrain => { outgoing.once('drain', resolveDrain); outgoing.once('close', resolveDrain); });
        } } finally { reader.releaseLock(); }
      } else await response.body?.cancel();
      outgoing.end(); records.push({ method: incoming.method, path, variant: ['preview','full'].includes(url.searchParams.get('variant')) ? url.searchParams.get('variant') : null, status: response.status, bytes, elapsedMs: Date.now() - started });
      if (records.length > 1500) records.shift();
    } catch { if (!outgoing.headersSent) { outgoing.writeHead(403, fixtureHeaders); outgoing.end('Outside the isolated T21 preview.'); } else outgoing.destroy(); }
  });
  try { await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolveListen); }); }
  catch (error) { await runtime.close(); throw error; }
  return { origin, runtime, profile, async close() { if (closed) return; closed = true; server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); await runtime.close(); } };
}
