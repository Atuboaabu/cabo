/** Real Game projection: never infer face-down card values. No Mock state. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function realGameMarkup(controller,account,endConfirm=false){
 const s=controller.state,g=s.view;
 const seconds=Math.ceil(controller.remainingMs()/1000);
 const owner=g?.players.find(p=>p.account_id===account?.id);
 const canSeePrivate=g?.phase==='InitialPeek'&&!owner?.initial_peek_completed&&
   controller.remainingMs()>0;
 const error=s.error?'<p role="alert" class="real-room-feedback" data-tone="error">'+esc(s.error)+'</p>':'';
 const header='<section class="section-heading"><div><span class="eyebrow">REAL GAME · FASTAPI</span><h1>真实 CABO 游戏</h1></div><div class="button-row"><button class="outline" type="button" data-action="realGameRefresh" '+(s.pending?'disabled':'')+'>同步 GameView</button><button class="outline" type="button" data-action="realGameBack">返回真实房间</button><button class="danger" type="button" data-action="realLogout">退出登录</button></div></section>';
 const retry=s.pendingCommand?'<article class="paper-card"><p role="status">命令结果尚未确认。原 request_id 已保留，不会生成新的请求编号。</p><button class="outline" type="button" data-action="realGameRetry" '+(s.pending?'disabled':'')+'>使用原 request_id 重试核实</button></article>':'';
 if(!g)return '<section class="dashboard real-game-page">'+header+error+retry+'<article class="paper-card"><h2>正在验证 GameView</h2><p>访问资格与房间关系必须由 FastAPI 确认。</p></article></section>';
 const players=[...g.players].sort((a,b)=>a.seat_index-b.seat_index);
 const summary='<article class="paper-card"><div class="data-line"><span>GameSession ID</span><code>'+esc(g.id)+'</code></div>'
  +'<div class="data-line"><span>阶段</span><strong>'+esc(g.phase)+'</strong></div>'
  +'<div class="data-line"><span>Revision</span><strong>'+esc(g.state_revision)+'</strong></div>'
  +'<div class="data-line"><span>抽牌堆</span><strong>'+esc(g.draw_pile.card_count)+' 张</strong></div>'
  +'<div class="data-line"><span>弃牌堆</span><strong>'+esc(g.discard_pile.card_count)+' 张，顶部 '+(g.discard_pile.top_card_value===null?'无':esc(g.discard_pile.top_card_value))+'</strong></div></article>';
 const memberCards=players.map(p=>{
  const own=p.account_id===account?.id;
  const cards=p.hand_cards.map(c=>{
   const privateValue=own&&canSeePrivate?s.privateCards[c.position]:undefined;
   const value=c.face_up?c.value:privateValue;
   const text='位置 '+esc(c.position)+' · '+(value===undefined?'背面':esc(value));
   const enabled=own&&!c.face_up&&controller.validPeekPosition(c.position);
   return enabled?'<button class="real-game-card" type="button" data-action="realGamePeek:'+esc(c.position)+'">'+text+'</button>':
    '<span class="real-game-card" aria-label="牌位 '+esc(c.position)+'">'+text+'</span>';
  }).join('');
  const progress=own&&g.phase==='InitialPeek'
   ?'<p class="hint">已确认位置：'+esc(p.initial_peek_confirmed_positions.join(', ')||'无')+'；剩余查看次数：'+esc(s.privateRemaining===null?Math.max(0,2-p.initial_peek_confirmed_positions.length):s.privateRemaining)+'</p>':'';
  return '<article class="paper-card"><h3>'+esc(p.username)+(own?' · 你':'')+' · 座位 '+esc(p.seat_index)+'</h3><p class="hint">'+(p.initial_peek_completed?'InitialPeek 已结束':'InitialPeek 未结束')+'</p><div class="real-game-cards">'+cards+'</div>'+progress+'</article>';
 }).join('');
 let stage='';
 if(g.phase==='InitialPeek'){
  stage='<article class="paper-card"><h2>InitialPeek · 共享初始查看</h2><p>共享窗口剩余时间：<strong id="real-game-countdown">'+esc(seconds)+' 秒</strong></p>'+
   (seconds<=0?'<p role="status">初始查看已截止，正在等待服务器 Timeout Worker 确认阶段转换。</p>':
    owner?.initial_peek_completed?'<p role="status">你已完成 InitialPeek，等待其他玩家或截止时间。</p>':
    '<p>最多查看两张不同的本人初始牌；查看两张后仍需主动 End。</p><button type="button" class="primary" data-action="realGameEnd" '+(controller.canComplete()?'':'disabled')+'>主动结束 InitialPeek</button>')+'</article>';
 }else if(g.phase==='PlayerTurn'){
  const t=g.active_turn,acting=g.players.find(p=>p.account_id===t.acting_account_id)?.username||t.acting_account_id;
  stage='<article class="paper-card"><h2>PlayerTurn · 只读展示</h2>'
   +'<div class="data-line"><span>当前行动玩家</span><strong>'+esc(acting)+'</strong></div>'
   +'<div class="data-line"><span>Turn Number</span><strong>'+esc(t.turn_number)+'</strong></div>'
   +'<div class="data-line"><span>Turn Deadline</span><strong>'+esc(t.deadline_at)+'</strong></div>'
   +'<p>真实 Draw、Replace、Discard、能力牌及 CABO Command 尚未接入。</p></article>';
 }
 const dialog=endConfirm?'<div class="veil"><section class="modal" role="dialog" aria-modal="true"><h2>提前结束初始查看？</h2><p>主动结束后私人数字立即清除；剩余机会会作废，倒计时不会暂停。</p><div class="button-row"><button class="outline" type="button" data-action="realGameEndCancel">取消</button><button class="danger" type="button" data-action="realGameEndApprove">确认结束</button></div></section></div>':'';
 return '<section class="dashboard real-game-page">'+header+error+retry+summary+
  '<section class="real-game-players">'+memberCards+'</section>'+stage+dialog+'</section>';
}
