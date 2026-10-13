import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { AdminNode, adminScriptFixture } from './helpers/station-admin-dom.mjs';

const source = await readFile(new URL('../src/pages/admin-v2/services/index.astro',import.meta.url),'utf8');
const serviceCode = source.slice(source.indexOf('    const serviceUi ='),source.indexOf('    const gameLifecycleLabel =')) + source.slice(source.indexOf('    const loadAccounts ='),source.indexOf('    const currentAnalyticsWindowDays ='));
class Node extends AdminNode {
  get firstElementChild(){return this.firstChild;}
  set innerHTML(value){this.html=value;this.replaceChildren();}
  get innerHTML(){return this.html || '';}
  querySelector(selector){if(selector==='button[type="submit"]')return this.submit ||= new Node('button');return super.querySelector(selector);}
}
const order = (id,status='finished') => ({id,orderToken:'ORDER-'+id,orderType:'credit-pack',status,accountEmail:'reader'+id+'@example.com',priceAmount:10,priceCurrency:'USD'});
const account = id => ({id,email:'reader'+id+'@example.com',status:'active',creditAccount:{balanceCredits:10},stats:{orderCount:1}});
function fixture(request){
  const nodes = new Map(), $ = id => {if(!nodes.has(id)){const n=new Node();n.id=id.slice(1);nodes.set(id,n);}return nodes.get(id);};
  const ordersList=$('#orders-list'),accountsList=$('#accounts-list'),orderDetail=$('#order-detail'),accountDetail=$('#account-detail');
  new Node().append(ordersList,orderDetail);new Node().append(accountsList,accountDetail);
  $('#service-chevron').content={cloneNode:()=>new Node('svg')};
  const state={orders:[],accounts:[],selectedOrderToken:'',selectedAccountId:0},calls=[],statuses=[], confirmations=[];
  const fields=['orderStatus','orderType','orderEmail','orderSeries','accountEmail','accountStatus'];
  const context=vm.createContext({$,state,document:{createElement:tag=>new Node(tag)},window:{confirm:message=>{confirmations.push(message);return false;}},elements:{ordersList,accountsList,orderDetail,accountDetail,filters:Object.fromEntries(fields.map(f=>[f,new Node('input')]))},
    location:{hash:'#commerce'},switchTab:async()=>{},apiJson:async(path,options)=>{calls.push({path,options});return request(path,options);},setStatus:(...s)=>statuses.push(s),renderEmpty:(node,text)=>{const p=new Node('p');p.textContent=text;node.replaceChildren(p);},escapeHtml:v=>String(v??'').replaceAll('<','&lt;').replaceAll('"','&quot;'),statusTone:s=>s==='finished'?'success':'neutral',formatMoney:(v,c)=>v+' '+c,formatDate:v=>v||'',formatCredits:v=>String(v),orderTitle:o=>o.orderToken||'#'+o.id,loadAuditLogs:async()=>{},URLSearchParams,console});
  vm.runInContext(serviceCode,context);return {context,$,state,calls,statuses,confirmations,run:code=>vm.runInContext(code,context)};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}

test('orders expand inline, collapse and reopen without duplicate detail requests',async()=>{
 const f=fixture(async path=>path.includes('/orders?')?{orders:[order(1),order(2)]}:{order:order(1),fulfillment:{complete:true},events:[]});
 await f.run('loadOrders()');await f.run("loadOrderDetail('ORDER-1')");const detail=f.$('#order-detail');assert.equal(detail.parentElement.dataset.recordKey,'ORDER-1');assert.equal(detail.hidden,false);assert.match(detail.innerHTML,/暂无支付回调记录/);assert.doesNotMatch(detail.innerHTML,/积分到账|会员授权/);
 await f.run("loadOrderDetail('ORDER-1')");assert.equal(detail.hidden,true);await f.run("loadOrderDetail('ORDER-1')");assert.equal(detail.hidden,false);assert.equal(f.calls.filter(c=>c.path.includes('/order?')).length,1);
});
test('late order detail cannot replace the newer selected order or reopen a collapsed row',async()=>{
 const a=deferred(),b=deferred();const f=fixture(path=>path.includes('/orders?')?{orders:[order(1),order(2)]}:path.includes('ORDER-1')?a.promise:b.promise);
 await f.run('loadOrders()');const first=f.run("loadOrderDetail('ORDER-1')"),second=f.run("loadOrderDetail('ORDER-2')");b.resolve({order:order(2)});await second;a.resolve({order:order(1)});await first;assert.match(f.$('#order-detail').innerHTML,/ORDER-2/);assert.doesNotMatch(f.$('#order-detail').innerHTML,/ORDER-1/);
 const c=deferred(),g=fixture(path=>path.includes('/orders?')?{orders:[order(1)]}:c.promise);await g.run('loadOrders()');const pending=g.run("loadOrderDetail('ORDER-1')");await g.run("loadOrderDetail('ORDER-1')");c.resolve({order:order(1)});await pending;assert.equal(g.$('#order-detail').hidden,true);assert.equal(g.$('#order-detail').dataset.loaded,'');
});
test('summary filter is local, backend filters are preserved, and latest list response wins',async()=>{
 const a=deferred(),b=deferred();let count=0;const f=fixture(()=>++count===1?a.promise:b.promise);const first=f.run('loadOrders()');f.run("elements.filters.orderEmail.value='reader2@example.com';elements.filters.orderStatus.value='failed';elements.filters.orderType.value='credit-pack';elements.filters.orderSeries.value='past-series'");const second=f.run('loadOrders()');b.resolve({orders:[order(2,'failed')]});await second;a.resolve({orders:[order(1)]});await first;assert.equal(f.state.orders[0].id,2);const params=new URL(f.calls[1].path,'https://test').searchParams;assert.equal(params.get('limit'),'80');assert.equal(params.get('email'),'reader2@example.com');assert.equal(params.get('status'),'failed');assert.equal(params.get('orderType'),'credit-pack');assert.equal(params.get('series'),'past-series');
 f.$('#orders-search').value='ORDER-2';f.run('renderOrders()');assert.equal(f.$('#orders-list').children[0].dataset.recordKey,'ORDER-2');f.$('#orders-search').value='absent';f.run('renderOrders()');assert.match(f.$('#commerce-count').textContent,/显示 0 笔/);assert.equal(f.calls.length,2);
});
test('failed or mismatched detail stays non-editable and is retryable by reopening',async()=>{
 let fail=true;const f=fixture(path=>path.includes('/orders?')?{orders:[order(1)]}:fail?Promise.reject(new Error('503')):{order:order(1)});await f.run('loadOrders()');await assert.rejects(f.run("loadOrderDetail('ORDER-1')"),/503/);assert.match(f.$('#order-detail').innerHTML,/失败/);fail=false;await f.run("loadOrderDetail('ORDER-1')");await f.run("loadOrderDetail('ORDER-1')");assert.equal(f.$('#order-detail').dataset.loaded,'ORDER-1');
 const g=fixture(path=>path.includes('/accounts?')?{accounts:[account(1)]}:{account:account(2)});await g.run('loadAccounts()');await assert.rejects(g.run('loadAccountDetail(1)'),/不一致/);assert.equal(g.$('#account-detail').dataset.loaded,'');
});
test('account refresh preserves the same live detail node and unsaved form, including temporary filtering',async()=>{
 let visible=true;const f=fixture(path=>path.includes('/accounts?')?{accounts:visible?[account(1)]:[]}:{account:account(1)});await f.run('loadAccounts()');await f.run('loadAccountDetail(1)');const form=new Node('form');form.value='unsaved';f.$('#account-detail').append(form);await f.$('#credit-adjust-form').fire('input');
 await f.run('loadAccounts()');assert.equal(form.parentElement,f.$('#account-detail'));assert.equal(form.value,'unsaved');visible=false;await f.run('loadAccounts()');assert.equal(f.$('#account-detail').hidden,true);visible=true;await f.run('loadAccounts()');assert.equal(f.$('#account-detail').hidden,false);assert.equal(form.parentElement,f.$('#account-detail'));assert.equal(f.run('serviceUi.accountDirty'),true);
});
test('switching accounts requires discarding unsaved form and never sends a write',async()=>{
 const f=fixture(path=>path.includes('/accounts?')?{accounts:[account(1),account(2)]}:{account:account(Number(new URL(path,'https://test').searchParams.get('id')))});await f.run('loadAccounts()');await f.run('loadAccountDetail(1)');await f.$('#credit-adjust-form').fire('input');await f.run('loadAccountDetail(2)');assert.equal(f.state.selectedAccountId,1);assert.equal(f.confirmations.length,1);assert.equal(f.calls.filter(c=>c.path.includes('/account?')).length,1);
 f.run('window.confirm=()=>true');await f.run('loadAccountDetail(2)');assert.equal(f.state.selectedAccountId,2);assert.equal(f.run('serviceUi.accountDirty'),false);assert(f.calls.every(c=>!c.options?.method));
});
test('account detail race does not show another account and an in-flight adjustment blocks double submits',async()=>{
 const a=deferred(),post=deferred();const f=fixture((path,opts)=>opts?.method==='POST'?post.promise:path.includes('/accounts?')?{accounts:[account(1),account(2)]}:path.endsWith('id=1')?a.promise:{account:account(2)});
 await f.run('loadAccounts()');const first=f.run('loadAccountDetail(1)');await f.run('loadAccountDetail(2)');a.resolve({account:account(1)});await first;assert.match(f.$('#account-detail').innerHTML,/reader2/);assert.doesNotMatch(f.$('#account-detail').innerHTML,/reader1/);
 f.$('#credit-adjust-delta').value='3';f.$('#credit-adjust-note').value='Local fixture verification';const submit=f.run('adjustCredits({preventDefault(){}},{id:2})');await f.run('adjustCredits({preventDefault(){}},{id:2})');await f.run('loadAccountDetail(1)');assert.equal(f.state.selectedAccountId,2);assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);const body=JSON.parse(f.calls.find(c=>c.options?.method==='POST').options.body);assert.equal(body.accountId,2);assert.equal(body.creditsDelta,3);assert.equal(body.note,'Local fixture verification');post.resolve({account:account(2)});await submit;assert.equal(f.run('serviceUi.accountBusy'),false);
});
test('settings groups keep all destinations and use read-only service flags',async()=>{
 const f=await adminScriptFixture('adminStationContent.js',{search:'?view=settings',request:async()=>({ok:true,actorId:'fixture-admin',role:'publisher',schedulesEnabled:false,campaignsEnabled:true})});
 const panel=f.node('work-static');assert.deepEqual(panel.children.map(s=>s.children[0].textContent),['作品与素材','发行与展示','账号与交易','服务状态']);
 const links=panel.children.flatMap(s=>s.children).filter(n=>n.tagName==='A');assert.equal(links.length,11);assert(links.some(n=>n.href==='/admin/music/'));assert(links.some(n=>n.href==='/admin-v2/services/#accounts'));assert(links.some(n=>n.href==='/admin/membership-refunds/'));
 const states=panel.children.at(-1).children.filter(n=>n.className==='settings-status-row');assert.deepEqual(states.map(n=>n.children[1].textContent),['已启用','未启用','已启用']);assert(states.every(n=>n.children[1].tagName==='SPAN'));
});

 test('explicit refresh updates an open detail but preserves pending account inputs',async()=>{
 let calls=0;const f=fixture(path=>path.includes('/orders?')?{orders:[order(1)]}:{order:{...order(1),providerStatus:'version-'+(++calls)}});await f.run('loadOrders()');await f.run("loadOrderDetail('ORDER-1')");await f.run('refreshServiceWorkspace()');assert.match(f.$('#order-detail').innerHTML,/version-2/);
 let readCount=0;const g=fixture(path=>path.includes('/accounts?')?{accounts:[account(1)]}:(readCount++,{account:account(1)}));g.run("location.hash='#accounts'");await g.run('loadAccounts()');await g.run('loadAccountDetail(1)');await g.$('#credit-adjust-form').fire('input');await g.run('refreshServiceWorkspace()');assert.equal(readCount,1);assert.equal(g.run('serviceUi.accountDirty'),true);
 });
