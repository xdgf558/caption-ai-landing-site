const endpoint = '/admin/api/readers/membership-refund-reviews';
const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = value => value ? `${value.replace('T', ' ').replace(/Z$/, '')} UTC` : '无';
const duration = seconds => `${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
const messages = {
  REVIEW_STALE: '会员或审核记录已变化，请重新载入核对。',
  REVIEW_ALREADY_DECIDED: '此记录已经审核，请重新载入查看结果。',
  REDEMPTION_NOT_REVOKABLE: '所选兑换已无可撤销期限，请重新核对。',
  REFUND_CREDIT_BUDGET_EXCEEDED: '所选兑换积分超过该笔已冲正积分。',
  INVALID_REVIEW: '请填写审核依据、确认编号并选择有效兑换。',
  REVIEW_UNAVAILABLE: '审核服务暂不可用，请检查迁移或稍后重新载入。'
};
let current = null;
let dirty = false;
let busy = false;
let generation = 0;
let next = null;
const status = (text, failed = false) => { $('#refund-status').textContent = text; $('#refund-status').dataset.error = String(failed); };
async function api(query = '', payload) {
  const response = await fetch(endpoint + query, {
    method: payload ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: payload ? { 'Content-Type': 'application/json' } : {},
    ...(payload ? { body: JSON.stringify(payload) } : {})
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(messages[data.code] || `请求失败（${response.status}），请重新载入核对。`);
  return data;
}
function mayLeave() { return !busy && (!dirty || window.confirm('放弃尚未提交的审核内容？')); }
function lock(value) {
  busy = value;
  document.querySelectorAll('#refund-filter, #refund-refresh, #refund-next, .refund-entry').forEach(el => { el.disabled = value; });
}
async function loadList(before) {
  if (!mayLeave()) return;
  dirty = false;
  current = null;
  const request = ++generation;
  lock(true);
  $('#refund-detail').innerHTML = '<p>尚未选择记录。</p>';
  $('#refund-list').innerHTML = '<p>正在读取记录。</p>';
  $('#refund-next').hidden = true;
  try {
    const params = new URLSearchParams({ status: $('#refund-filter').value });
    if (before) params.set('before', String(before));
    const data = await api(`?${params}`);
    if (request !== generation) return;
    next = data.next;
    $('#refund-next').hidden = !next;
    $('#refund-list').innerHTML = data.reviews.length ? data.reviews.map(row => `
      <button type="button" class="refund-entry" data-review-id="${row.id}">
        <strong>#${row.id} · ${escape(row.email)}</strong>
        <small>${escape(row.credits_delta)} Station Points · ${escape(date(row.created_at))}</small>
        <small>${row.decision ? (row.decision === 'keep' ? '已保留 VIP' : '已撤销对应期限') : '待审核'}</small>
      </button>`).join('') : '<p>暂无记录。</p>';
    status(`已载入 ${data.reviews.length} 条记录。`);
  } catch (error) { $('#refund-list').innerHTML = '<p>记录暂不可用。</p>'; status(error.message, true); }
  finally { if (request === generation) lock(false); }
}
async function loadDetail(id) {
  if (!mayLeave()) return;
  dirty = false;
  const request = ++generation;
  lock(true);
  $('#refund-detail').innerHTML = '<p>正在读取审核详情。</p>';
  try {
    const data = await api(`?id=${id}`);
    if (request !== generation) return;
    current = data;
    renderDetail();
    document.querySelectorAll('.refund-entry').forEach(el => { el.setAttribute('aria-current', String(Number(el.dataset.reviewId) === id)); });
    status(data.review ? '已载入审核结果。' : '待人工核对。');
  } catch (error) { current = null; status(error.message, true); }
  finally { if (request === generation) lock(false); }
}
function renderDetail() {
  const d = current;
  $('#refund-detail').innerHTML = `
    <h2>审核 #${d.id}</h2>
    <dl class="refund-facts">
      <dt>账户</dt><dd>${escape(d.account?.email)} · #${escape(d.account?.id)}</dd>
      <dt>充值来源</dt><dd>${escape(d.reversal.source_ref)}</dd>
      <dt>充值 / 冲正</dt><dd>${escape(d.topup?.credits_delta ?? 0)} / ${escape(d.reversal.credits_delta)} Station Points</dd>
      <dt>冲正时间</dt><dd>${escape(date(d.reversal.created_at))}</dd>
      <dt>当前 VIP 到期</dt><dd>${escape(date(d.membership?.expires_at))}</dd>
    </dl>
    <p class="refund-note">${escape(d.reversal.note)}</p>
    ${d.review ? `<h3>已${d.review.decision === 'keep' ? '保留 VIP' : '撤销对应期限'}</h3>
      <dl class="refund-facts"><dt>审核人</dt><dd>${escape(d.review.actor)}</dd>
      <dt>审核时间</dt><dd>${escape(date(d.review.reviewedAt))}</dd>
      <dt>审核依据</dt><dd>${escape(d.review.reason)}</dd>
      <dt>原到期时间</dt><dd>${escape(date(d.review.before?.expires_at))}</dd>
      <dt>处理后到期</dt><dd>${escape(date(d.review.afterExpiresAt))}</dd></dl>` : `
    <form id="refund-form">
      <fieldset><legend>审核结果</legend>
        <label class="refund-choice"><input type="radio" name="decision" value="keep" checked />确认无需撤销 VIP</label>
        <label class="refund-choice"><input type="radio" name="decision" value="revoke" ${!d.candidates.length ? 'disabled' : ''} />撤销所选兑换的未使用期限</label>
      </fieldset>
      <fieldset><legend>可核对的 VIP 兑换</legend>
        ${d.candidates.length ? d.candidates.map(c => `<label class="refund-choice">
          <input type="checkbox" name="redemption" value="${c.ledgerId}" disabled />
          <span>#${c.ledgerId} · ${c.costCredits} 点 · 剩余 ${duration(c.remainingSeconds)}
          <small>兑换：${escape(date(c.createdAt))}</small>
          <small>当前分配期限：${escape(date(c.effectiveStart))} 至 ${escape(date(c.effectiveEnd))}</small></span>
        </label>`).join('') : '<p>没有可安全撤销的未使用兑换期限。历史记录或关联不明的记录可继续保留待审核。</p>'}
      </fieldset>
      <p id="refund-preview" aria-live="polite"></p>
      <label class="refund-field">审核依据<textarea name="reason" required minlength="10" maxlength="1000"></textarea></label>
      <label class="refund-field">确认审核编号<input name="confirmation" required inputmode="numeric" autocomplete="off" pattern="${d.id}" /></label>
      <label class="refund-choice"><input name="acknowledged" type="checkbox" required />已核对资金与兑换关联；本次不退款、不调整积分，也不撤销其他权益。</label>
      <button id="refund-submit" type="button">确认提交审核</button>
    </form>`}`;
  const form = $('#refund-form');
  if (!form) return;
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => { dirty = true; updatePreview(); });
  $('#refund-submit').addEventListener('click', submit);
  updatePreview();
}
function updatePreview() {
  const form = $('#refund-form');
  const revoke = form.elements.decision.value === 'revoke';
  form.querySelectorAll('[name="redemption"]').forEach(el => { el.disabled = !revoke; if (!revoke) el.checked = false; });
  const selected = [...form.querySelectorAll('[name="redemption"]:checked')].map(el => Number(el.value));
  const choices = current.candidates.filter(c => selected.includes(c.ledgerId));
  const seconds = choices.reduce((sum, c) => sum + c.remainingSeconds, 0);
  const cost = choices.reduce((sum, c) => sum + c.costCredits, 0);
  const expiry = current.membership?.expires_at?.replace(' ', 'T');
  const after = seconds ? new Date(Date.parse(expiry.endsWith('Z') ? expiry : `${expiry}Z`) - seconds * 1000).toISOString() : current.membership?.expires_at;
  $('#refund-preview').textContent = revoke
    ? `关联兑换 ${cost} 点；预计撤销 ${duration(seconds)}，到期时间 ${date(after)}。实际仅撤销提交时尚未使用的期限。`
    : '保留现有 VIP 期限，不修改积分余额。';
  $('#refund-submit').disabled = revoke && (!choices.length || cost > Math.max(0, -current.reversal.credits_delta));
}
async function submit() {
  const form = $('#refund-form');
  if (busy || !form.reportValidity()) return;
  const payload = { id: current.id, version: current.version, decision: form.elements.decision.value,
    reason: form.elements.reason.value, confirmation: form.elements.confirmation.value,
    redemptionIds: [...form.querySelectorAll('[name="redemption"]:checked')].map(el => Number(el.value)) };
  lock(true);
  form.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });
  try {
    const data = await api('', payload);
    dirty = false;
    current.review = data.review;
    if (current.membership) current.membership.expires_at = data.review.afterExpiresAt;
    renderDetail();
    status('审核已保存，会员处理结果与审计记录已一起提交。');
  } catch (error) {
    // Never refresh the version or silently retry an uncertain financial decision.
    form.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });
    dirty = false;
    status(`${error.message} 本次结果需重新载入核对；不会自动再次提交。`, true);
  } finally { lock(false); }
}
$('#refund-list').addEventListener('click', event => {
  const button = event.target.closest('[data-review-id]');
  if (button) loadDetail(Number(button.dataset.reviewId));
});
$('#refund-refresh').addEventListener('click', () => current ? loadDetail(current.id) : loadList());
$('#refund-next').addEventListener('click', () => loadList(next));
let filter = $('#refund-filter').value;
$('#refund-filter').addEventListener('change', () => {
  if (!mayLeave()) { $('#refund-filter').value = filter; return; }
  dirty = false;
  filter = $('#refund-filter').value;
  loadList();
});
window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
loadList();
