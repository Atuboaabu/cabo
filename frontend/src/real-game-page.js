/** Public GameView + ephemeral InitialPeek overlay renderer. */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function realGameMarkup(s){
 const g=s.view;
 const header='<section class="real-game-head"><div><span class="eyebrow">REAL GAME · FASTAPI</span><h1>真实 CABO 对局</h1><p class="hint">GameSession '+esc(s.gameId||'')+'</p></div><div class="button-row"><button type="button" class="outline" data-action="realGameRefresh">同步状态</button><button type="button" class="outline" data-action="realGameBack">返回账号</button></div></section>';
 if(!g)return header+'<article class="paper-card"><h2>验证游戏访问资格</h2><p role="status">'+esc(s.error||'正在读取服务器 GameView…')+'</p><button type="button" class="outline" data-action="realGameRefresh">重试读取</button></article>';
 const me=g.players.find(p=>p.account_id===g.viewer_account_id);
 const initial=g.phase==='InitialPeek',active=initial&&s.peekAllowed;
 const cards=p=>'<div class="real-game-hand">'+p.hand_cards.map(card=>{
  const own=p.account_id===g.viewer_account_id;
  const confirmed=initial&&own&&me.initial_peek_confirmed_positions.includes(card.position);
  const privateValue=active&&own?s.privateCards.get(card.position):undefined;
  const value=card.face_up?card.value:privateValue;
  const canPeek=active&&own&&!card.face_up&&!confirmed&&!s.acceptedPositions.has(card.position)&&me.initial_peek_confirmed_positions.length<2&&!s.command&&!s.outcomeUnknown;
  return '<button type="button" class="real-game-card '+(value===undefined?'is-hidden':'is-visible')+'" '+(canPeek?'data-action="realPeek:'+card.position+'"':'disabled')+
   ' aria-label="位置 '+(card.position+1)+(confirmed?'，已查看':'')+'"><strong>'+
   (value===undefined?'♤':esc(value))+'</strong><small>位置 '+(card.position+1)+(confirmed?' · 已查看':'')+'</small></button>';
 }).join('')+'</div>';
 const players=[...g.players].sort((a,b)=>a.seat_index-b.seat_index).map(p=>
  '<article class="paper-card real-game-player"><h3>'+esc(p.username)+' · 座位 '+esc(p.seat_index)+
  (p.account_id===g.viewer_account_id?'（你）':'')+'</h3>'+cards(p)+
  (initial?'<p class="hint">'+(p.initial_peek_completed?'已结束初始查看':'正在初始查看')+'</p>':'')+'</article>').join('');
 const status=initial?'<article class="paper-card"><h2>初始查看 · 共享倒计时 '+esc(s.remainingSeconds??0)+' 秒</h2>'+
  '<p>已确认 '+esc(me.initial_peek_confirmed_positions.length)+' / 2 个位置，剩余 '+esc(2-me.initial_peek_confirmed_positions.length)+' 次；每个位置只能查看一次。</p>'+
  (me.initial_peek_completed?'<p role="status">你已结束查看，等待其他玩家或截止时间。</p>':s.command?.kind==='end'?'<p role="status">正在确认结束查看。</p>':
    active?'<button type="button" class="primary" data-action="realGameEnd" '+(s.command?'disabled':'')+'>主动结束 InitialPeek</button>':
    '<p role="status">查看窗口已结束，等待服务器推进阶段。</p>')+'</article>':
  '<article class="paper-card"><h2>PlayerTurn · 正常回合</h2>'+
  '<p>行动玩家：'+esc(g.players.find(p=>p.account_id===g.active_turn?.acting_account_id)?.username||'待确认')+'</p>'+
  '<p>回合编号：'+esc(g.active_turn?.turn_number??'—')+' · 截止：'+esc(g.active_turn?.deadline_at??'—')+'</p>'+
  '<p class="hint">正常回合 Command 尚未接入，当前仅展示服务端公开状态。</p></article>';
 const feedback=(s.error?'<p class="real-room-feedback" data-tone="error" role="alert">'+esc(s.error)+'</p>':'')+
  (s.outcomeUnknown?'<button class="primary" type="button" data-action="realGameRetry">以原 request_id 重试当前操作</button>':'')+
  (s.command&&!s.outcomeUnknown?'<p role="status">正在等待服务器确认操作…</p>':'');
 return header+feedback+status+'<section class="real-game-players">'+players+'</section>'+
  '<article class="paper-card"><h3>公共牌堆</h3><p>抽牌堆：'+esc(g.draw_pile.card_count)+' 张 · 弃牌堆：'+esc(g.discard_pile.card_count)+
  ' 张 · 顶牌：'+esc(g.discard_pile.top_card_value??'无')+'</p>'+
  '<p class="hint">Revision '+esc(g.state_revision)+' · WebSocket '+(s.wsConnected?'已连接':'未连接（HTTP 同步可用）')+'</p></article>';
}
