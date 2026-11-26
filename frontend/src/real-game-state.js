/**
 * Real Game controller. The only persisted value is a GameSession locator.
 * Never persist or log private cards. Every restore first reauthorizes via GET.
 */
const KEY='cabo.lastRealGameId';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createRealGameState({
 api,createSocket,storage=null,getAccountId=()=>null,onChange=()=>{},onUnauthorized=()=>{},
 setTimeoutFn=globalThis.setTimeout,clearTimeoutFn=globalThis.clearTimeout,
 setIntervalFn=globalThis.setInterval,clearIntervalFn=globalThis.clearInterval
}={}){
 const state={gameId:null,view:null,privateCards:new Map(),acceptedPositions:new Set(),remaining:2,loading:false,
  error:'',wsConnected:false,command:null,outcomeUnknown:false,deadlineMs:null,remainingSeconds:null,peekAllowed:false};
 let generation=0,socket=null,pollTimer=null,clockTimer=null,reconnectTimer=null,reconnectAttempt=0;
 let queued=false,reading=false,privateRequest=0,timeoutAttempts=0,offsetMs=0,expectedRoomId=null,endedLocally=false,expired=false,deadlineTimer=null,handshakeTimer=null,highestRevision=-1;
 const emit=()=>{state.peekAllowed=!!inWindow();onChange(state);};
 const save=id=>{try{id?storage?.setItem(KEY,id):storage?.removeItem(KEY);}catch{}};
 const stored=()=>{try{const id=storage?.getItem(KEY);return UUID.test(id||'')?id:null;}catch{return null;}};
 const clearPrivate=()=>{state.privateCards.clear();state.remaining=0;privateRequest++;};
 const nowServer=()=>Date.now()+offsetMs;
 const inWindow=()=>state.view?.state==='Playing'&&state.view.phase==='InitialPeek'&&
  !!state.deadlineMs&&!expired&&!endedLocally&&nowServer()<state.deadlineMs&&
  state.view.viewer_account_id===getAccountId()&&state.view.players.some(p=>p.account_id===getAccountId()&&!p.initial_peek_completed);
 function cancelTimers(){
  if(pollTimer!=null)clearTimeoutFn(pollTimer);
  if(clockTimer!=null)clearIntervalFn(clockTimer);
  if(reconnectTimer!=null)clearTimeoutFn(reconnectTimer);
  if(deadlineTimer!=null)clearTimeoutFn(deadlineTimer);
  if(handshakeTimer!=null)clearTimeoutFn(handshakeTimer);
  pollTimer=clockTimer=reconnectTimer=deadlineTimer=handshakeTimer=null;
 }
 function reset({keepLocator=false}={}){
  generation++;cancelTimers();socket?.close();socket=null;
  clearPrivate();state.acceptedPositions.clear();state.view=null;state.loading=false;state.error='';
  state.wsConnected=false;state.command=null;state.outcomeUnknown=false;state.deadlineMs=null;
  state.remainingSeconds=null;queued=false;reading=false;timeoutAttempts=0;reconnectAttempt=0;
  expectedRoomId=null;endedLocally=false;expired=false;highestRevision=-1;
  if(!keepLocator){state.gameId=null;save(null);}emit();
 }
 function adjustClock(serverTime,rttMs){
  // Response arrival biases the estimate toward delaying expiry, so clamp it
  // toward early hiding with a small safety margin.
  offsetMs=Date.parse(serverTime)-Date.now()+Math.max(250,rttMs);
 }
 function updateClock(){
  if(!state.view||state.view.phase!=='InitialPeek')return;
  state.remainingSeconds=Math.max(0,Math.ceil((state.deadlineMs-nowServer())/1000));
  if(nowServer()>=state.deadlineMs)expired=true;
  if(!inWindow())clearPrivate();
  emit();
  if(state.remainingSeconds===0&&pollTimer==null&&timeoutAttempts===0)pollAfterDeadline();
 }
 function pollAfterDeadline(){
  if(pollTimer!=null)return;
  if(state.view?.phase!=='InitialPeek'||state.deadlineMs==null)return;
  if(nowServer()<state.deadlineMs){
   pollTimer=setTimeoutFn(()=>{pollTimer=null;pollAfterDeadline();},Math.min(1000,Math.max(50,state.deadlineMs-nowServer())));return;
  }
  clearPrivate();emit();
  if(timeoutAttempts>=12){state.error='等待服务器超时迁移；请点击刷新游戏状态。';emit();return;}
  const token=generation;
  const delay=timeoutAttempts<5?1500:4000;
  pollTimer=setTimeoutFn(async()=>{
   pollTimer=null;if(token!==generation||state.view?.phase!=='InitialPeek')return;
   timeoutAttempts++;
   await refresh();
   if(token===generation&&state.view?.phase==='InitialPeek')pollAfterDeadline();
  },delay);
 }
 function scheduleReconnect(){
  if(reconnectTimer!=null||!state.gameId)return;
  const token=generation;
  const delay=Math.min(30000,1000*2**Math.min(reconnectAttempt++,5));
  reconnectTimer=setTimeoutFn(async()=>{
   reconnectTimer=null;
   if(token!==generation||!state.gameId)return;
   if(await refresh())connect();
   else if(token===generation&&state.gameId)scheduleReconnect();
  },delay);
 }
 function connect(){
  if(!state.gameId||!state.view||socket||reconnectTimer!=null)return;
  const id=state.gameId,token=generation;
  const current=()=>token===generation&&socket===candidate;
  const clearHandshake=()=>{if(handshakeTimer!=null)clearTimeoutFn(handshakeTimer);handshakeTimer=null;};
  const candidate=createSocket({
   onChanged:changed=>{if(current()&&changed.toLowerCase()===id.toLowerCase())void refresh();},
   onOpen:opened=>{
    if(!current()||opened.toLowerCase()!==id.toLowerCase())return;
    clearHandshake();state.wsConnected=true;reconnectAttempt=0;emit();void refresh();
   },
   onClosed:closed=>{
    if(!current()||closed.toLowerCase()!==id.toLowerCase())return;
    clearHandshake();socket=null;state.wsConnected=false;
    clearPrivate();emit();void refresh();scheduleReconnect();
   }
  });
  socket=candidate;
  try{
   if(candidate.connect(id)!==true)throw Error('socket unavailable');
   if(!state.wsConnected)handshakeTimer=setTimeoutFn(()=>{
    if(!current())return;
    handshakeTimer=null;socket=null;candidate.close();
    clearPrivate();state.wsConnected=false;emit();scheduleReconnect();
   },10000);
  }catch{
   socket=null;candidate.close();scheduleReconnect();
  }
 }
 async function refresh(){
  if(!state.gameId)return false;
  if(reading){queued=true;return false;}
  reading=true;const id=state.gameId,token=generation,startedAt=Date.now();
  try{
   const v=await api.getGame(id);
   if(token!==generation||state.gameId!==id)return false;
   if(v.id.toLowerCase()!==id.toLowerCase()||v.viewer_account_id!==getAccountId()||
      (expectedRoomId&&v.room_id!==expectedRoomId)){
    const e=new Error('游戏、房间或当前账号身份不一致。');e.code='INVALID_RESPONSE';throw e;
   }
   expectedRoomId=v.room_id;
   if(v.state_revision<highestRevision)return false;
   highestRevision=v.state_revision;
   adjustClock(v.server_time,Date.now()-startedAt);
   state.view=v;state.error='';state.loading=false;
   if(v.phase==='InitialPeek'){
    state.deadlineMs=Date.parse(v.initial_peek_deadline_at);
    state.remainingSeconds=Math.max(0,Math.ceil((state.deadlineMs-nowServer())/1000));
    const me=v.players.find(p=>p.account_id===getAccountId());
    if(me?.initial_peek_completed){endedLocally=true;}
    if(nowServer()>=state.deadlineMs)expired=true;
    if(!inWindow())clearPrivate();
    else{
     for(const pos of [...state.privateCards.keys()])
      if(!me.initial_peek_confirmed_positions.includes(pos))state.privateCards.delete(pos);
    }
    if(clockTimer==null)clockTimer=setIntervalFn(updateClock,1000);
    if(deadlineTimer!=null)clearTimeoutFn(deadlineTimer);
    if(!expired)deadlineTimer=setTimeoutFn(()=>{deadlineTimer=null;updateClock();},Math.max(0,state.deadlineMs-nowServer()));
    if(pollTimer!=null){clearTimeoutFn(pollTimer);pollTimer=null;}
    if(expired||state.remainingSeconds===0)pollAfterDeadline();
   }else{
    clearPrivate();state.acceptedPositions.clear();state.deadlineMs=null;state.remainingSeconds=null;
    if(deadlineTimer!=null)clearTimeoutFn(deadlineTimer);deadlineTimer=null;
    if(clockTimer!=null)clearIntervalFn(clockTimer);clockTimer=null;
    if(pollTimer!=null)clearTimeoutFn(pollTimer);pollTimer=null;
   }
   emit();
   return true;
  }catch(e){
   if(token!==generation)return false;
   state.loading=false;
   if([401,403,404,409].includes(e?.status)||e?.code==='INVALID_RESPONSE'){
    clearPrivate();cancelTimers();socket?.close();socket=null;state.view=null;state.wsConnected=false;
    state.command=null;state.outcomeUnknown=false;
    if(e.status===401)onUnauthorized();
    if(e.status===403||e.status===404){save(null);state.gameId=null;}
   }
   state.error=e.message||'游戏同步失败。';emit();return false;
  }finally{
   if(token===generation){
    reading=false;if(queued){queued=false;void refresh();}
   }
  }
 }
 async function loadPrivate(){
  if(!inWindow()||state.command?.kind==='end')return false;
  const token=generation,seq=++privateRequest;
  try{
   const v=await api.getInitialPeekView(state.gameId);
   if(token!==generation||seq!==privateRequest||!inWindow())return false;
   if(v.account_id!==getAccountId()||Date.parse(v.deadline_at)!==state.deadlineMs||
      Date.parse(v.server_time)>=state.deadlineMs){clearPrivate();emit();return false;}
   state.privateCards=new Map(v.revealed_cards.map(c=>[c.position,c.value]));
   state.remaining=v.remaining_peek_count;emit();return true;
  }catch(e){
   if(token!==generation||seq!==privateRequest)return false;
   clearPrivate();
   if(e.status===401)onUnauthorized();
   state.error=e.message||'无法恢复私人查看结果。';emit();return false;
  }
 }
 async function enter(id,roomId=null){
  if(!UUID.test(id||''))return false;
  if(state.gameId?.toLowerCase()===id.toLowerCase()&&state.view&&(!roomId||state.view.room_id===roomId))return true;
  reset();expectedRoomId=roomId;state.gameId=id;save(id);state.loading=true;emit();
  if(!await refresh())return false;
  connect();
  if(inWindow())void loadPrivate();
  return true;
 }
 async function restore(){
  const id=stored();
  if(!id)return false;
  return enter(id);
 }
 async function runCommand(kind,position){
  if(!state.gameId||!inWindow()||state.command||state.outcomeUnknown)return false;
  const me=state.view.players.find(p=>p.account_id===getAccountId());
  if(!me||me.initial_peek_completed)return false;
  if(kind==='peek'&&(state.privateCards.has(position)||state.acceptedPositions.has(position)||me.initial_peek_confirmed_positions.includes(position)||
    new Set([...me.initial_peek_confirmed_positions,...state.acceptedPositions]).size>=2||!Number.isInteger(position)||position<0||position>3))return false;
  const command={kind,position,requestId:globalThis.crypto.randomUUID(),unknown:false};
  state.command=command;state.error='';
  if(kind==='end'){endedLocally=true;clearPrivate();}
  emit();return submit(command);
 }
 async function submit(command){
  const token=generation,id=state.gameId;
  try{
   const out=command.kind==='peek'
    ?await api.initialPeek(id,command.requestId,command.position)
    :await api.completeInitialPeek(id,command.requestId);
   if(token!==generation||state.command!==command)return false;
   if(out.status==='NotYetDetermined'){
    command.unknown=true;state.outcomeUnknown=true;state.error='结果尚未确定，请用原请求 ID 重试。';emit();return false;
   }
   state.outcomeUnknown=false;
   if(out.status==='Accepted'){
    if(command.kind==='peek')state.acceptedPositions.add(command.position);
    if(command.kind==='end')clearPrivate();
    if(command.kind==='peek'&&out.peek_result&&out.peek_result.position===command.position&&
       Date.parse(out.peek_result.deadline_at)===state.deadlineMs&&inWindow())
      state.privateCards.set(command.position,out.peek_result.value);
   }else{
    if(command.kind==='end')endedLocally=false;
    state.error=out.status==='IdentityConflict'?'请求 ID 与历史操作冲突。':
      '请求未被服务器接受：'+(out.reason||out.status);
   }
   const message=state.error;
   emit();await refresh();
   if(token!==generation||state.command!==command)return out.status==='Accepted';
   state.command=null;if(message)state.error=message;emit();
   if(inWindow())void loadPrivate();
   return out.status==='Accepted';
  }catch(e){
   if(token!==generation||state.command!==command)return false;
   if(e.outcomeUnknown){
    command.unknown=true;state.outcomeUnknown=true;
    state.error='操作结果未知，请重试原请求，不要再次选择目标。';
   }else{
    state.command=null;state.outcomeUnknown=false;state.error=e.message||'命令失败。';
    if(command.kind==='end')endedLocally=false;
    if([401,403,404].includes(e.status))clearPrivate();
    if(e.status===401)onUnauthorized();
   }
   emit();void refresh();return false;
  }
 }
 async function retry(){
  if(!state.command?.unknown)return false;
  state.command.unknown=false;state.outcomeUnknown=false;emit();
  return submit(state.command);
 }
 function onReturn(){if(!state.gameId)return;updateClock();void (async()=>{if(await refresh()){if(!socket)connect();if(inWindow())void loadPrivate();}})();}
 function sync(){return onReturn();}
 return {state,enter,restore,refresh,loadPrivate,peek:position=>runCommand('peek',position),
  complete:()=>runCommand('end'),retry,reset,onReturn,sync,clearPrivate,getStoredId:stored};
}
