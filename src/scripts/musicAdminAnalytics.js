import { request } from './musicAdminClient.js';

// Isolated read-only panel: no journal, identity payload, mutation or play controls.
export function mountMusicAdminAnalytics() {
  const $=id=>document.getElementById(id), dialog=$('analytics-dialog'); if(!dialog) return;
  let epoch=0;
  const today=new Date(); $('analytics-to').value=today.toISOString().slice(0,10);
  $('analytics-from').value=new Date(today.getTime()-6*86400000).toISOString().slice(0,10);
  const names={play_start:'开始收听',qualified_play:'有效收听',play_complete:'自然完成',preview_end:'试听结束',vip_cta_click:'会员入口点击'};
  const reasons={NO_DATA:'此时段暂无可用事件。',MUSIC_PUBLIC_DISABLED:'公开入口未开放。',MUSIC_ANALYTICS_DISABLED:'统计开关未开启。',
    PRIVACY_NOT_CONFIGURED:'隐私配置未就绪。',RETENTION_NOT_CONFIGURED:'保留期任务未配置。',RETENTION_UNREADY:'保留期任务尚未就绪。'};
  async function load() {
    const own=++epoch; $('analytics-refresh').disabled=true; $('analytics-results').replaceChildren();
    $('analytics-notice').textContent='正在读取汇总…';
    try {
      const query=new URLSearchParams({from:$('analytics-from').value,to:$('analytics-to').value});
      const data=await request('/analytics?'+query);
      if(own!==epoch) return;
      $('analytics-notice').textContent=data.available ? '仅包含同意统计且成功送达的事件，不代表全部听众。' : '统计不可用：'+(reasons[data.reason] || '暂时无法核对数据。');
      if(data.available) for(const row of data.metrics) {
        if(!names[row.metric] || !['full','preview'].includes(row.variant) || !Number.isSafeInteger(row.value) || row.value<0) continue;
        const tr=document.createElement('tr');
        for(const text of [names[row.metric],row.variant==='preview' ? '试听' : row.accessKind==='free' ? '免费完整版' : row.accessKind==='vip' ? 'VIP 策略完整版' : '完整版（历史策略未知）',String(row.value)]) {
          const td=document.createElement('td');td.textContent=text;tr.append(td);
        }
        $('analytics-results').append(tr);
      }
      $('analytics-table').hidden=!data.available;
    } catch { if(own===epoch) { $('analytics-table').hidden=true; $('analytics-notice').textContent='统计暂不可用，请检查日期范围或登录状态后重试。'; } }
    finally { if(own===epoch) $('analytics-refresh').disabled=false; }
  }
  $('analytics-open').addEventListener('click',()=>{dialog.showModal();void load();});
  $('analytics-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{epoch++;$('analytics-refresh').disabled=false;});
  $('analytics-form').addEventListener('submit',event=>{event.preventDefault();void load();});
}
