/** Real GameView renderer using the existing Mock table's visual vocabulary.
 * Private values are read only from the authorized ephemeral overlay.
 * No Mock state, actions, round number or game rules are imported here.
 */
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(label,action,kind='outline',disabled=false)=>'<button type="button" class="'+kind+'" data-action="'+esc(action)+'" '+(disabled?'disabled':'')+'>'+esc(label)+'</button>';
export const timeText=seconds=>{
 const n=Math.max(0,Math.ceil(seconds||0));
 return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
};
const phaseLabel=phase=>({InitialPeek:'初始查看',PlayerTurn:'玩家回合'}[phase]||phase);
function cardMarkup(card,own,active,s,confirmed,count){
 const peek=active&&own&&!card.face_up&&s.privateCards.has(card.position);
 const face=card.face_up===true||peek;
 const value=card.face_up===true?card.value:peek?s.privateCards.get(card.position):null;
 const selectable=active&&own&&!card.face_up&&!confirmed.has(card.position)&&count<2&&!s.command&&!s.outcomeUnknown;
 return '<button type="button" class="playing-card '+(face?'face-up':'face-down')+(selectable?' selectable':'')+(own&&confirmed.has(card.position)?' peek-confirmed':'')+
  '" '+(selectable?'data-action="realPeek:'+esc(card.position)+'"':'disabled')+
  ' aria-label="第 '+(card.position+1)+' 张牌，'+(face?'牌面 '+esc(value):'背面')+(own&&confirmed.has(card.position)?'，已查看':'')+'">'+
  '<span class="card-corner">'+(face?esc(value):'✦')+'</span><span class="card-center">'+(face?esc(value):'CABO')+
  '</span><span class="card-corner bottom">'+(face?esc(value):'✦')+'</span></button>';
}
export function realGameMarkup(s){
 const g=s.view;
 const toolbar='<div class="real-table-toolbar">'+button('同步状态','realGameRefresh','small quiet')+
  button('返回账号','realGameBack','small quiet')+'</div>';
 if(!g)return '<div class="game-shell real-table"><div class="game-header"><div><span class="eyebrow">真实对局</span><h1>真实 CABO 对局</h1></div>'+toolbar+'</div><section class="paper-card blocked"><h2>验证游戏访问资格</h2><p role="status">'+esc(s.error||'正在读取服务器 GameView…')+'</p>'+button('重试读取','realGameRefresh','primary')+'</section></div>';
 const me=g.players.find(p=>p.account_id===g.viewer_account_id);
 if(!me)return '<section class="paper-card blocked"><h2>无法确认当前玩家</h2>'+button('重新同步','realGameRefresh','primary')+'</section>';
 const initial=g.phase==='InitialPeek',active=initial&&s.peekAllowed;
 const confirmed=new Set(initial?[...me.initial_peek_confirmed_positions,...s.acceptedPositions]:[]);
 const count=confirmed.size;
 const acting=g.active_turn?.acting_account_id;
 // Relative seat order: keep the viewer at the bottom and preserve clockwise order.
 const others=[...g.players].filter(p=>p.account_id!==me.account_id)
  .sort((a,b)=>((a.seat_index-me.seat_index+4)%4)-((b.seat_index-me.seat_index+4)%4));
 const positions=others.length===1?[0]:others.length===2?[2,1]:[2,0,1];
 const cards=(p,own)=>[...p.hand_cards].sort((a,b)=>a.position-b.position)
  .map(c=>cardMarkup(c,own,active,s,own?confirmed:new Set(),count)).join('');
 const mark=p=>initial?(p.initial_peek_completed?'<span class="turn-mark">已结束</span>':''):
  acting===p.account_id?'<span class="turn-mark">'+(p.account_id===me.account_id?'你的回合':'行动中')+'</span>':'';
 const opponents=others.map((p,i)=>'<div class="opponent pos-'+positions[i]+'"><div class="opponent-name"><span class="player-bubble">'+esc(p.username[0]||'?')+'</span><strong>'+esc(p.username)+'</strong>'+mark(p)+'</div><div class="mini-hand">'+cards(p,false)+'</div><small>'+p.hand_cards.length+' 张牌</small></div>').join('');
 let title,description,actions='';
 if(initial){
  if(me.initial_peek_completed){title='等待其他玩家';description='你已结束初始查看，等待其他玩家或共享截止时间。';}
  else if(s.command?.kind==='end'){title='正在确认结束查看';description='等待服务器确认，私人牌值已隐藏。';}
  else if(!active){title='等待服务器同步';description='查看窗口已结束或暂不可用，阶段以服务器为准。';}
  else{title='选择最多两张不同的初始牌';description='已查看 '+count+' / 2 · 剩余 '+Math.max(0,2-count)+' 次 · 共享 45 秒；查看两张不自动结束。';actions=button('结束初始查看','realGameEnd','primary',!!s.command||s.outcomeUnknown);}
 }else{
  title=acting===me.account_id?'你的回合':'等待其他玩家行动';
  const player=g.players.find(p=>p.account_id===acting);
  description='当前行动玩家：'+(player?.username||'待确认')+' · 回合操作暂未开放。';
 }
 if(s.outcomeUnknown)actions+=button('重试原请求','realGameRetry','gold');
 const feedback=s.error?'<p class="real-table-error" role="alert">'+esc(s.error)+'</p>':s.command&&!s.outcomeUnknown?'<p role="status">正在等待服务器确认操作…</p>':'';
 const timer=initial?timeText(s.remainingSeconds):s.turnRemainingSeconds!=null?timeText(s.turnRemainingSeconds):'—';
 return '<div class="game-shell real-table"><div class="game-header"><div><span class="eyebrow">真实对局'+(g.active_turn?' · 回合 '+esc(g.active_turn.turn_number):'')+'</span><h1>'+(initial?'初始查看手牌':'回合进行中')+'</h1></div><div class="game-meta"><span class="phase-chip">'+esc(phaseLabel(g.phase))+'</span><span class="timer" data-real-game-timer role="timer" aria-live="off">⏱ '+esc(timer)+'</span></div></div>'+
  '<div class="table-zone"><div class="game-felt"><div class="felt-outline"></div><div class="top-players">'+opponents+'</div>'+
  '<div class="piles"><div class="pile-slot"><button type="button" class="deck" disabled aria-label="抽牌堆"><span>CABO</span></button><span>抽牌堆 · '+esc(g.draw_pile.card_count)+'</span></div>'+
  '<div class="pile-slot"><button type="button" class="deck discarded" disabled aria-label="弃牌堆顶牌"><span>'+esc(g.discard_pile.top_card_value??'—')+'</span></button><span>弃牌堆 · '+esc(g.discard_pile.card_count)+'</span></div></div>'+
  '<div class="self-seat"><div class="self-name"><span class="player-bubble">你</span><strong>'+esc(me.username)+'</strong>'+mark(me)+'</div><div class="self-hand">'+cards(me,true)+'</div><small>'+me.hand_cards.length+' 张牌</small></div></div></div>'+
  '<section class="action-panel" aria-live="polite"><div><span class="eyebrow">'+(initial?'初始查看':acting===me.account_id?'你的回合':'等待行动')+'</span><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p>'+feedback+'</div><div class="action-buttons">'+actions+'</div></section>'+
  '<div class="real-table-bottom"><span class="connection '+(s.wsConnected?'connected':'disconnected')+'">● '+(s.wsConnected?'已连接':'未连接')+'</span>'+toolbar+'</div></div>';
}
