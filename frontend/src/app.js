import { gateway } from './mock.js';
import { assertCompatible, formatRemaining } from './adapter.js';
import { passwordsMatch } from './registration.js';

const root=document.querySelector('#app');
let view,screen='auth',authMode='login',notice='',busy=false,selected=[],modal=null,request=0;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(label,action,kind='outline',disabled=false)=>'<button type="button" class="'+kind+'" data-action="'+esc(action)+'" '+(disabled||busy?'disabled':'')+'>'+esc(label)+'</button>';
const actions=()=>new Set(view.game?.legalActions||[]);
const nav=x=>{screen=x;selected=[];render();};
function shell(inner,cls=''){
 const room=view.room, account=view.account;
 return '<div class="app-shell"><header class="topbar"><div class="brand"><span class="brand-icon">♤</span>cabo'+(room?'<span class="room-chip">房间 '+esc(room.id)+'</span>':'')+'</div><div class="top-actions"><span class="mock-tag">◈ MOCK · 受限演示</span>'+(account?btn('当前房间','lobby','small quiet')+btn('设置','settings','small quiet')+btn('退出','logout','small quiet'):'')+'<span class="connection '+esc(view.connection)+'">● '+({connected:'已连接',disconnected:'已断线','taken-over':'连接已被接管'}[view.connection]||'未连接')+'</span></div></header>'+(notice?'<div class="notice" role="status">'+esc(notice)+btn('×','dismiss','close')+'</div>':'')+'<main class="main '+cls+'">'+inner+'</main>'+(account?'<aside class="qa-strip" aria-label="Mock 场景"><strong>演示场景</strong>'+['disconnect','reconnect','takeover','reclaim','expireSession'].map((a,i)=>btn(['断线','重连','新设备接管','重新接管','会话过期'][i],a,'small outline')).join('')+'</aside>':'')+'<footer class="footer">一张圆桌，一起 CABO。</footer>'+(modal?'<div class="veil"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><h2 id="modal-title">'+esc(modal.title)+'</h2><p>'+esc(modal.message)+'</p><div class="button-row">'+btn('取消','cancelModal')+btn('确认','confirmModal',modal.danger?'danger':'primary')+'</div></section></div>':'')+'</div>';
}
function authentication(){
 const config={
  login:['入座，开始这一局','欢迎回到 CABO。','登录'],
  register:['加入 CABO 圆桌','设置账号，和朋友一起开局。','验证并注册'],
  forgot:['找回账号访问','仅已验证邮箱可用于邮箱恢复。','发送恢复邮件'],
  verify:['验证邮箱','验证你的邮箱地址。','发送验证邮件'],
  reset:['重置密码','请设置新的密码。','提交重置']
 };
 const [heading,subtitle,submit]=config[authMode];
 const registration=authMode==='register';
 const email=authMode!=='reset'?'<label>邮箱<input type="email" name="email" required autocomplete="email" placeholder="输入可接收邮件的邮箱地址"></label>':'';
 const password=['login','register','reset'].includes(authMode)?'<label>密码<input type="password" name="password" required autocomplete="'+(authMode==='login'?'current-password':'new-password')+'" placeholder="输入密码"></label>':'';
 const confirmation=registration?'<label>确认密码<input type="password" name="confirmPassword" required autocomplete="new-password" placeholder="再次输入密码" aria-describedby="password-confirmation-hint"></label>':'';
 const code=registration?'<div class="registration-verification"><label for="registration-code">验证码</label><div class="code-row"><input id="registration-code" name="code" inputmode="numeric" pattern="[0-9]+" autocomplete="one-time-code" required placeholder="输入验证码" aria-describedby="registration-code-status"><button type="button" class="outline" data-action="requestRegistrationCode">发送验证码</button></div><p class="hint" id="registration-code-status" role="status" aria-live="polite"></p></div>':'';
 const nickname=registration?'<label>游戏昵称<input type="text" name="nickname" required autocomplete="nickname" placeholder="设置在游戏中显示的昵称"></label>':'';
 const authLinks=authMode==='login'
  ?[['register','注册账号'],['forgot','忘记密码？']]
  :[['login','返回登录']];
 const loginDemo=authMode==='login'?'<div class="demo-entry">'+btn('进入本地 Mock 演示','enterDemo','outline full')+'</div>':'';
 return shell('<section class="auth-stage"><div class="felt-table" aria-hidden="true"><div class="table-line"></div><div class="ornamental-deck">♠<small>CABO</small></div></div><div class="auth-panel"><div class="ornament">♧　♤　♧</div><h1 class="auth-logo">cabo</h1><div class="rule"></div><h2>'+heading+'</h2><p class="subtitle">'+subtitle+'</p><form id="auth-form">'+(authMode==='reset'?'<label>恢复凭据<input name="token" required autocomplete="off"></label>':email)+nickname+password+confirmation+code+'<button class="primary full" type="submit" '+(busy?'disabled':'')+'>'+submit+'</button></form>'+loginDemo+'<div class="auth-bottom">'+authLinks.map(([mode,label])=>'<a href="#'+mode+'" data-auth="'+mode+'">'+label+'</a>').join(' · ')+'</div></div></section>','auth-main');
}
function dashboard(){
 if(!view.room)return shell('<section class="dashboard"><div class="intro"><span class="eyebrow">THE CABO CLUB</span><h1>今晚，围坐一桌。</h1><p>创建圆桌或输入房间编号。每个账号同时最多属于一个 Room。</p></div><div class="lobby-grid"><article class="paper-card"><div class="card-symbol">♤</div><h2>创建房间</h2><p>成为 Host，邀请最多三位朋友。</p>'+btn('创建新房间','createRoom','primary full')+'</article><article class="paper-card"><div class="card-symbol">♧</div><h2>加入房间</h2><p>输入朋友提供的编号。</p><form id="join-form"><label>房间编号<input name="code" required placeholder="例如 042"></label><button type="submit" class="primary full">加入房间</button></form></article></div></section>','dashboard-main');
 const r=view.room,me=r.members.find(m=>m.id==='demo-me'),host=!!me?.host,playing=r.state==='Playing';
 if(r.state==='Closed')return shell('<section class="blocked paper-card"><h1>房间已关闭</h1><p>Room Closed 不再接纳成员。</p>'+btn('返回大厅','clearClosed','primary')+'</section>');
 return shell('<section class="lobby-page"><div class="section-heading"><div><span class="eyebrow">ROOM · '+esc(r.id)+'</span><h1>'+(playing?'游戏进行中':'围桌等候朋友')+'</h1><p>'+(playing?'普通 Leave 不合法，返回已授权游戏。':'2–4 名玩家可以开局；非 Host 需要 Ready。')+'</p></div><span class="status-pill">'+r.state+'</span></div><div class="lobby-layout"><div class="paper-card seats"><div class="card-title"><h2>房间成员</h2><span>'+r.members.length+' / 4</span></div><div class="member-list">'+r.members.map((m,i)=>'<div class="member"><div class="avatar">'+esc(m.name[0])+'</div><div><strong>'+esc(m.name)+'</strong><small>座位 '+(i+1)+' · ID '+esc(m.id)+'</small></div><div class="member-meta">'+(m.host?'<span class="gold-chip">HOST</span>':'<span class="'+(m.ready?'ready':'unready')+'">'+(m.ready?'✓ 已准备':'○ 未准备')+'</span>')+(host&&!m.host?btn('移除','kick:'+m.id,'small outline'):'')+'</div></div>').join('')+'</div>'+(!playing&&host?btn('载入演示对手','addDemoMembers','outline full'):'')+'</div><div class="paper-card lobby-aside"><div class="card-symbol">♠</div><h2>'+(playing?'返回当前游戏':'准备好了吗？')+'</h2><p>Host Start 需要 2–4 名玩家，且所有非 Host 已 Ready。</p>'+(playing?btn('返回当前游戏','game','primary full'):host?btn('开始游戏','start','primary full',r.members.length<2||r.members.some(m=>!m.host&&!m.ready)):btn(me?.ready?'取消准备':'我已准备','toggleReady','primary full'))+(!playing?btn('离开房间','leave','outline full')+(host?btn('解散房间','disband','danger full'):''):'')+'</div></div></section>','lobby-main');
}
function card(c,i,owner,selectable){
 const own=owner==='demo-me',privateReveal=own&&view.privateResult?.purpose==='initial'&&view.privateResult.position===i;
 const face=c.faceUp||privateReveal,v=c.faceUp?c.value:privateReveal?view.privateResult.value:null;
 return '<button type="button" class="playing-card '+(face?'face-up':'face-down')+(own&&selected.includes(i)?' selected':'')+'" data-action="'+(selectable?'card:'+i:'noop')+'" '+(selectable?'':'disabled')+' aria-label="第 '+(i+1)+' 张牌，'+(face?'牌面 '+v:'背面')+'"><span class="card-corner">'+(face?esc(v):'✦')+'</span><span class="card-center">'+(face?esc(v):'CABO')+'</span><span class="card-corner bottom">'+(face?esc(v):'✦')+'</span></button>';
}
function results(g){
 if(g.state==='Aborted')return '<section class="result-card"><h1>本局已中止</h1><p>原因：'+esc(g.result?.reason)+'。活动轮次无分数、无赢家。</p>'+btn('返回 Lobby','lobby','primary')+'</section>';
 return '<section class="result-card"><h1>这一局，圆满落幕</h1><p><strong>以下为非权威示意成绩</strong>，并非完整 CABO 裁决。</p><div class="scoreboard">'+g.result.scores.map(s=>'<div><span>'+esc(g.players.find(p=>p.id===s.id)?.name||s.id)+'</span><b>'+s.score+'</b></div>').join('')+'</div>'+btn('返回 Lobby','lobby','primary')+'</section>';
}
function controls(g){
 const legal=actions(),has=a=>legal.has(a);
 if(g.phase==='InitialReveal')return '<div><span class="eyebrow">INITIAL REVEAL</span><h2>选择最多两张不同的初始牌</h2><p>已查看 '+g.revealCount+' / 2 · 共享 45 秒；查看两张不自动结束。</p></div><div class="action-buttons">'+btn('结束初始查看','endReveal','primary',!has('endReveal'))+'</div>';
 if(g.turnStep==='waiting')return '<div><span class="eyebrow">等待其他玩家</span><h2>'+(g.phase==='FinalTurns'?'FinalTurns 已开启':'等待服务器权威 View')+'</h2><p>'+(g.finalOrder.length?'剩余顺序：'+esc(g.finalOrder.join(' → ')):'本 Mock 不模拟其他玩家实时行动。')+'</p></div>'+btn('查看示意结算','completeDemoGame');
 if(g.turnStep==='action')return '<div><span class="eyebrow">YOUR TURN</span><h2>选择行动</h2><p>选择抽牌来源或在正常回合起点呼叫 CABO。</p></div><div class="action-buttons">'+btn('从抽牌堆抽牌','draw','primary',!has('draw'))+btn('取弃牌堆顶牌','takeDiscard','outline',!has('takeDiscard'))+btn('呼叫 CABO','cabo','gold',!has('cabo'))+'</div>';
 if(g.turnStep==='card')return '<div><span class="eyebrow">CARD DECISION</span><h2>当前牌 '+esc(g.drawnValue)+'</h2><p>'+(g.drawnSource==='discard'?'弃牌堆取牌只能 Replace。':'可弃掉、单牌 Replace 或使用合法能力。')+' 选中自己一张牌。</p></div><div class="action-buttons">'+btn('确认替换','replace','primary',!has('replace')||selected.length!==1)+btn('弃掉抽到的牌','discard','outline',!has('discard'))+btn('使用能力','ability','gold',!has('ability'))+'</div>';
 if(g.turnStep==='ability')return '<div><span class="eyebrow">ABILITY</span><h2>特殊能力</h2><p>能力原截止：<strong id="ability-timer" data-deadline="'+esc(g.abilityDeadline)+'">'+formatRemaining(g.abilityDeadline)+'</strong>。秘密目标和 Swap 需正式服务器授权。</p></div><div class="action-buttons">'+btn('选择目标（受限）','targetAbility','outline',!has('targetAbility'))+btn('结束能力','endAbility','primary',!has('endAbility'))+btn('撤销本次能力弃牌','undoAbility','outline',!has('undoAbility'))+'</div>';
 return '<p>等待权威同步，受限 Mock 不模拟复杂超时裁决。</p>';
}
function game(){
 if(!view.game||!view.room)return dashboard();
 const g=view.game,self=g.players.find(p=>p.id==='demo-me'),opponents=g.players.filter(p=>p.id!=='demo-me'),legal=actions();
 return shell('<div class="game-shell"><div class="game-header"><div><span class="eyebrow">GAME · ROUND '+g.round+'</span><h1>'+esc(g.state==='Completed'?'最终成绩':g.state==='Aborted'?'游戏已中止':g.phase==='InitialReveal'?'初始查看手牌':g.phase==='FinalTurns'?'最后行动阶段':'回合进行中')+'</h1></div><div class="game-meta"><span class="phase-chip">'+esc(g.phase)+'</span><span class="timer" id="timer" data-deadline="'+(g.deadline||'')+'">⏱ '+formatRemaining(g.deadline)+'</span></div></div>'+(['Completed','Aborted'].includes(g.state)?results(g):'<div class="table-zone"><div class="game-felt"><div class="felt-outline"></div><div class="top-players">'+opponents.map((p,i)=>'<div class="opponent pos-'+i+'"><div class="opponent-name"><span class="player-bubble">'+esc(p.name[0])+'</span><strong>'+esc(p.name)+'</strong>'+(g.actingPlayerId===p.id?'<span class="turn-mark">行动中</span>':'')+'</div><div class="mini-hand">'+p.hand.map((c,j)=>card(c,j,p.id,false)).join('')+'</div><small>'+p.hand.length+' 张牌</small></div>').join('')+'</div><div class="piles"><div class="pile-slot"><button data-action="draw" class="deck '+(legal.has('draw')?'interactive':'')+'" '+(!legal.has('draw')?'disabled':'')+'><span>CABO</span></button><span>抽牌堆 · '+g.drawCount+'</span></div><div class="pile-slot"><button data-action="takeDiscard" class="deck discarded '+(legal.has('takeDiscard')?'interactive':'')+'" '+(!legal.has('takeDiscard')?'disabled':'')+'><span>'+esc(g.discardTop??'—')+'</span></button><span>弃牌堆 · 顶牌</span></div></div><div class="self-seat"><div class="self-name"><span class="player-bubble">你</span><strong>'+esc(self?.name)+'</strong>'+(g.actingPlayerId==='demo-me'?'<span class="turn-mark">你的回合</span>':'')+'</div><div class="self-hand">'+self.hand.map((c,i)=>card(c,i,'demo-me',g.phase==='InitialReveal'?legal.has('reveal')&&g.revealCount<2:legal.has('replace'))).join('')+'</div><small>'+self.hand.length+' 张牌</small></div></div></div><section class="action-panel" aria-live="polite">'+controls(g)+'</section>')+'</div>','game-main');
}
function settings(){
 if(view.room?.state==='Playing')return shell('<section class="paper-card blocked"><h1>你正在游戏中</h1><p>普通展示名、邮箱、改密及注销均被限制。必要的安全恢复不受阻止。</p>'+btn('返回当前游戏','game','primary')+btn('退出当前会话','logout')+'</section>');
 const a=view.account;
 return shell('<section class="settings-page"><div class="section-heading"><h1>账号设置</h1></div><div class="settings-grid"><article class="paper-card"><h2>账号信息</h2><div class="data-line"><span>展示名</span><strong>'+esc(a.name)+'</strong></div><div class="data-line"><span>邮箱</span><strong>'+esc(a.email)+'</strong></div><div class="data-line"><span>验证</span><strong>'+(a.verified?'已验证':'未验证（仍可参与游戏）')+'</strong></div><form id="name-form"><label>展示名<input name="name" required value="'+esc(a.name)+'"></label><button class="primary full">保存展示名</button></form></article><article class="paper-card"><h2>账号安全</h2><p>敏感变更需要服务器重新认证及邮箱验证。</p>'+btn('修改邮箱','changeEmail','outline full')+btn('修改密码','changePassword','outline full')+btn('发送验证邮件','requestVerification','outline full')+'<div class="rule"></div><h3>注销账号</h3><p>必须先独立完成合法 Leave，再另行提交注销。</p>'+(view.room?btn('前往 Room 先 Leave','lobby','outline full'):'')+btn('申请注销','deleteAccount','danger full',!!view.room&&view.room.state!=='Closed')+'</article></div></section>','settings-main');
}
function render(){
 view=assertCompatible(gateway.snapshot());
 if(!view.account)screen='auth';
 if(screen==='game'&&!view.game)screen='lobby';
 root.innerHTML=screen==='auth'?authentication():screen==='game'?game():screen==='settings'?settings():dashboard();
}
function confirm(title,message,command,payload={},danger=false){modal={title,message,command,payload,danger};render();}
async function send(command,payload={}){
 if(busy)return;
 busy=true;render();
 try{
  const result=await gateway.send(command,payload,'ui-'+(++request));
  notice=(result.status==='Accepted'?'✓ ':'✕ ')+result.message+(result.code?' · '+result.code:'');
  if(result.status==='Accepted'){
   if(['enterDemo','login'].includes(command))screen='lobby';
   if(['start','reclaim','completeDemoGame'].includes(command))screen='game';
   if(['createRoom','joinRoom','leave','disband','clearClosed'].includes(command))screen='lobby';
   if(['logout','expireSession'].includes(command))screen='auth';
   selected=[];
  }
 }catch(e){notice='操作结果不确定，请同步权威 View：'+e.message;}
 finally{busy=false;render();}
}
root.addEventListener('click',e=>{
 const link=e.target.closest('[data-auth]');
 if(link){e.preventDefault();authMode=link.dataset.auth;notice='';render();return;}
 const el=e.target.closest('[data-action]');if(!el||el.disabled)return;
 const a=el.dataset.action;
 if(a==='noop')return;
 if(a==='requestRegistrationCode'){
  const form=root.querySelector('#auth-form'),email=form?.elements.namedItem('email')?.value||'';
  const status=root.querySelector('#registration-code-status');
  const button=el;
  button.disabled=true;
  if(status)status.textContent='正在请求发送，请勿重复提交……';
  gateway.send('requestRegistrationCode',{email},'registration-send-'+(++request)).then(result=>{
   if(status)status.textContent=(result.status==='Accepted'?'已受理发送请求。':'无法发送：')+result.message;
  }).catch(()=>{
   if(status)status.textContent='请求结果未知，请在同步服务端状态后再试。';
  }).finally(()=>{button.disabled=false;});
  return;
 }
 if(a==='dismiss'){notice='';render();return;}
 if(a==='cancelModal'){modal=null;render();return;}
 if(a==='confirmModal'){const m=modal;modal=null;send(m.command,m.payload);return;}
 if(['lobby','game','settings'].includes(a)){nav(a);return;}
 if(a.startsWith('card:')){const i=Number(a.slice(5));if(view.game?.phase==='InitialReveal')send('reveal',{index:i});else{selected=selected.includes(i)?[]:[i];render();}return;}
 if(a.startsWith('kick:')){confirm('移除成员','Playing Kick 将 Aborted 当前 Game。','kick',{memberId:a.slice(5)},true);return;}
 if(a==='disband'){confirm('解散房间','关闭 Room 不可撤销；当前 Game 可能中止。','disband',{},true);return;}
 if(a==='leave'){confirm('离开房间','Leave 与注销是两项独立正式请求。','leave');return;}
 if(a==='cabo'){confirm('呼叫 CABO','将结束本次正常 Turn 并进入 FinalTurns。','cabo');return;}
 if(a==='endReveal'&&view.game?.revealCount<2){confirm('提前结束查看','剩余机会将作废，是否继续？','endReveal');return;}
 if(a==='deleteAccount'){confirm('申请注销','受限 Mock 不实际注销账号。','deleteAccount',{},true);return;}
 if(a==='toggleReady'){send('ready',{ready:!view.room.members.find(m=>m.id==='demo-me')?.ready});return;}
 if(a==='replace'){send('replace',{positions:[...selected]});return;}
 send(a);
});
root.addEventListener('input',e=>{
 if(e.target?.name==='confirmPassword'||e.target?.name==='password'){
  const form=e.target.closest('form');
  form?.elements.namedItem('confirmPassword')?.setCustomValidity('');
 }
});
root.addEventListener('submit',e=>{
 e.preventDefault();
 const f=e.target,p=Object.fromEntries(new FormData(f));
 if(f.id==='auth-form'){
  if(authMode==='register'&&!passwordsMatch(p.password,p.confirmPassword)){
   const confirmInput=f.elements.namedItem('confirmPassword');
   confirmInput?.setCustomValidity('两次输入的密码不一致');
   confirmInput?.reportValidity();
   return;
  }
  send(({forgot:'requestRecovery',verify:'requestVerification',reset:'resetPassword'})[authMode]||authMode,authMode==='register'?{email:p.email,nickname:p.nickname,password:p.password,code:p.code}:p);
 }
 if(f.id==='join-form')send('joinRoom',p);
 if(f.id==='name-form')send('changeName',p);
});
setInterval(()=>{
 const updated=gateway.snapshot();
 if(updated.game?.phase!==view.game?.phase||updated.game?.turnStep!==view.game?.turnStep||updated.session!==view.session){render();return;}
 root.querySelectorAll('[data-deadline]').forEach(el=>{const d=Number(el.dataset.deadline)||null;el.textContent=(el.id==='timer'?'⏱ ':'')+formatRemaining(d);});
},500);
window.addEventListener('keydown',e=>{if(e.altKey&&e.shiftKey&&e.key.toLowerCase()==='m'){e.preventDefault();confirm('模拟新设备接管','旧连接会停止接受受保护操作。','takeover');}});
render();
