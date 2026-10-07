(function () {
  // Executed only by the loopback preview. This origin is disposable.
  var options = window.scT12Options, marker = 'scT12OwnedOriginV1', loaded = 'scT12LoadedScenarioV1';
  var nativeStorage = window.localStorage;
  var owned = nativeStorage.getItem(marker) === 'agent-preview-only';
  var keys = ['catGameSaveV1', 'catGameSaveV1:member:7', 'catGameSaveV1:member:17', 'catGameMemberAccountV1', 'catGameGuestSaveClaimV1', 'catGameCloudSyncV1'];
  if (!owned) {
    var existing = Object.keys(nativeStorage).some(function (key) { return /^catGame(?:Save|Member|Guest|Cloud|Local)/.test(key); });
    if (!existing) { nativeStorage.setItem(marker, 'agent-preview-only'); owned = true; }
  }
  function seed(scenario) {
    if (!owned) throw new Error('Existing storage will not be replaced');
    keys.forEach(function (key) { nativeStorage.removeItem(key); });
    var raw = null, key = scenario === 'member-corrupt' ? 'catGameSaveV1:member:7' : 'catGameSaveV1';
    if (scenario === 'valid') raw = JSON.stringify(options.save);
    if (scenario === 'corrupt' || scenario === 'member-corrupt') raw = ' {broken T12 original\n ';
    if (scenario === 'future') raw = JSON.stringify(Object.assign({}, options.save, { schemaVersion: 4, futureOnly: 'preserve-original' }));
    if (scenario === 'legacy-empty') raw = JSON.stringify({ version: '1.0.0', meta: { createdAt: '2025-01-01T00:00:00.000Z' }, player: { name: 'Legacy Player', coins: 42 }, cats: [], inventory: {}, settings: { language: 'en', musicVolume: 55 } });
    if (raw !== null) nativeStorage.setItem(key, raw);
    if (scenario === 'member-corrupt') nativeStorage.setItem('catGameMemberAccountV1', '7');
    if (scenario === 'cached-session-error') { nativeStorage.setItem('catGameMemberAccountV1', '17'); nativeStorage.setItem('catGameSaveV1:member:17', ' {cached member original\n '); }
    nativeStorage.setItem('scT12BackupBaselineV1', JSON.stringify(Object.keys(nativeStorage).filter(function (key) { return key.indexOf(':recovery:') >= 0; })));
    nativeStorage.setItem(loaded, scenario);
  }
  if (owned && nativeStorage.getItem(loaded) !== options.scenario) seed(options.scenario);
  if (options.scenario === 'unavailable' && owned) Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { throw new DOMException('Simulated storage denial in disposable fixture', 'SecurityError'); } });
  window.addEventListener('DOMContentLoaded', function () {
    var panel = document.createElement('aside'); panel.className = 'sc-t12-fixture'; panel.setAttribute('data-t12-fixture', options.scenario);
    panel.style.cssText = 'margin:16px auto;padding:16px;max-width:1180px;border:1px dashed #7990b1;border-radius:12px;background:#f4f7ff;color:#243e60;font:13px/1.8 system-ui';
    var text = document.createElement('p'); text.textContent = 'T12 本地隔离夹具 · 实际旧游戏截图；D1/R2、账号与存储异常为测试配置。这一端口的游戏进度仅供验收，切换状态会重置夹具槽位。'; panel.append(text);
    var labels = { missing: '新游客', valid: '有效存档', corrupt: '损坏存档', future: '未来版本', unavailable: '模拟存储不可访问', 'identity-error': '账号核对失败', 'member-corrupt': '损坏会员槽位', 'legacy-empty': '旧版空猫列表（42 金币）', 'cached-session-error': '缓存账号但会话失败' };
    Object.keys(labels).forEach(function (scenario) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = labels[scenario]; button.disabled = !owned; button.setAttribute('data-fixture-scenario', scenario);
      button.style.cssText = 'margin:4px;padding:8px 12px;min-height:44px;border:1px solid #bdcbe0;background:white;color:#234e70;border-radius:8px;cursor:pointer';
      if (scenario === options.scenario) button.setAttribute('aria-pressed', 'true');
      button.addEventListener('click', async function () {
        button.disabled = true;
        try { seed(scenario); var response = await fetch('/__fixture/select?scenario=' + encodeURIComponent(scenario), { cache: 'no-store' }); if (!response.ok) throw new Error(); window.location.href = '/games/cat-life-game/'; }
        catch (error) { text.textContent = '夹具切换失败，已有数据未获替换授权。'; button.disabled = false; }
      }); panel.append(button);
    });
    if (owned && /^\/games\/cat-life\/$/.test(window.location.pathname) && options.scenario === 'valid') {
      var external = document.createElement('button'); external.type = 'button'; external.textContent = '模拟外部改档并重载（923 金币）';
      external.style.cssText = 'margin:4px;padding:8px 12px;min-height:44px;border:1px solid #bdcbe0;background:white;color:#234e70;border-radius:8px;cursor:pointer';
      external.addEventListener('click', function () { var changed = JSON.parse(JSON.stringify(options.save)); changed.player.gold = 923; nativeStorage.setItem('catGameSaveV1', JSON.stringify(changed)); window.location.reload(); });
      panel.append(external);
    }
    var directory = document.createElement('a'); directory.href = '/games/'; directory.textContent = '游戏目录'; directory.style.cssText = 'display:inline-flex;align-items:center;min-height:44px;margin:4px 12px'; panel.append(directory);
    var preservation = document.createElement('p'); preservation.setAttribute('data-fixture-preservation', '');
    function check() {
      var scenario = options.scenario, key = scenario === 'member-corrupt' ? 'catGameSaveV1:member:7' : scenario === 'cached-session-error' ? 'catGameSaveV1:member:17' : 'catGameSaveV1';
      var raw = nativeStorage.getItem(key), original = scenario === 'corrupt' || scenario === 'member-corrupt' ? ' {broken T12 original\n ' : scenario === 'future' ? JSON.stringify(Object.assign({}, options.save, { schemaVersion: 4, futureOnly: 'preserve-original' })) : scenario === 'cached-session-error' ? ' {cached member original\n ' : null;
      var baseline = JSON.parse(nativeStorage.getItem('scT12BackupBaselineV1') || '[]');
      var backedUp = original !== null && Object.keys(nativeStorage).some(function (candidate) { return candidate.startsWith(key + ':recovery:') && baseline.indexOf(candidate) < 0 && nativeStorage.getItem(candidate) === original; });
      preservation.dataset.backedUp = String(backedUp);
      preservation.textContent = !owned ? '此端口已有数据，夹具拒绝替换。' : original !== null ? '异常存档原文保留：' + (raw === original ? '是（当前槽位）' : backedUp ? '是（明确恢复前的原文副本）' : '否') : '仅检查当前隔离夹具：' + labels[scenario];
      preservation.dataset.preserved = original !== null ? String(raw === original || backedUp) : 'not-applicable';
    }
    check(); panel.append(preservation); document.body.append(panel); window.setInterval(check, 1000);
  });
})();
