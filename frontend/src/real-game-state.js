/** Server-authoritative real Game controller. Never persists secret card values. */
import { GAME_ID, GameApiError, validGameView } from './game-api.js';
const KEY='cabo.lastRealGameId', COMMAND_KEY='cabo.pendingRealGameCommand';
const message={
 REPEATED_PEEK:'该位置已经确认，不能重复查看。',
 INITIAL_PEEK_EXPIRED:'初始查看的共享时间已经结束。',
 INITIAL_PEEK_COMPLETED:'你已主动结束初始查看。',
 PEEK_LIMIT_EXCEEDED:'初始查看次数已用尽。',
 INVALID_PEEK_TARGET:'初始查看位置无效。',
 INVALID_GAME_STATE:'游戏阶段已变更，请同步最新 GameView。'
};
const validId=x=>typeof x==='string'&&GAME_ID.test(x);
const safeGet=(storage,key)=>{try{return storage?.getItem(key)||null;}catch{return null;}};
const safeSet=(storage,key,val)=>{try{if(val)storage?.setItem(key,val);else storage?.removeItem(key);}catch{}};
const safeCommand=x=>x&&validId(x.gameId)&&validId(x.accountId)&&validId(x.requestId)&&
 ['peek','complete'].includes(x.type)&&(x.type==='complete'||Number.isInteger(x.position)&&x.position>=0&&x.position<=3);
const wait=(n,min,max)=>Math.min(max,Math.max(min,n));
export function createRealGameState({
 api,createSocket,storage=null,getAccountId=()=>null,onChange=()=>{},onUnauthorized=()=>{},
 uuid=()=>globalThis.crypto.randomUUID(),now=Date.now,setTimeoutFn=globalThis.setTimeout,
 clearTimeoutFn=globalThis.clearTimeout,random=Math.random
}={}){
 const state={
  gameId:null,view:null,privateCards:{},privateRemaining:null,
  pending:null,pendingCommand:null,error:'',outcomeUnknown:false,privateEnded:false,terminal:false,
  deadlineMs:null,wsConnected:false,refreshNeeded:false
 };
 let generation=0,paused=false,syncPromise=null,queuedSync=false,deadlineTimer=null,
 compensationTimer=null,compensationTries=0,reconnectTimer=null,reconnectAttempts=0,
 handshakeTimer=null,privateEpoch=0;
 const emit=()=>onChange(state);
 const own=()=>state.view?.players.find(p=>p.account_id===getAccountId())||null;
 const isInitial=()=>state.view?.state==='Playing'&&state.view?.phase==='InitialPeek';
 const remainingMs=()=>state.deadlineMs===null?0:Math.max(0,state.deadlineMs-now());
 const clearTimer=name=>{}; // intentionally no generic browser timer registry
 function clearPrivate(){
  privateEpoch++;
  state.privateCards={};state.privateRemaining=null;
 }
 function stopTimers(){
  for(const value of [deadlineTimer,compensationTimer,reconnectTimer,handshakeTimer]){
   if(value!==null)clearTimeoutFn(value);
  }
  deadlineTimer=compensationTimer=reconnectTimer=handshakeTimer=null;
 }
 const socket=createSocket?.({
  onChanged:id=>{
   if(id.toLowerCase()===state.gameId?.toLowerCase()&&!paused)void sync({silent:true});
  },
  onOpen:id=>{
   if(id.toLowerCase()!==state.gameId?.toLowerCase()||paused)return;
   state.wsConnected=true;
   reconnectAttempts=0;
   if(reconnectTimer!==null){clearTimeoutFn(reconnectTimer);reconnectTimer=null;}
   if(handshakeTimer!==null){clearTimeoutFn(handshakeTimer);handshakeTimer=null;}
   emit();
   // Fresh GET after reconnect, also safe if OPEN races the first GET.
   void sync({silent:true});
  },
  onClosed:id=>{
   if(id.toLowerCase()!==state.gameId?.toLowerCase()||paused)return;
   state.wsConnected=false;emit();
   queueReconnect();
  }
 });
 function reset({clearLocator=true}={}){
  generation++;paused=false;queuedSync=false;syncPromise=null;
  stopTimers();socket?.close();reconnectAttempts=0;
  clearPrivate();state.gameId=null;state.view=null;state.pending=null;
  state.pendingCommand=null;state.error='';state.outcomeUnknown=false;
  state.deadlineMs=null;state.wsConnected=false;state.refreshNeeded=false;state.privateEnded=false;state.terminal=false;
  if(clearLocator){safeSet(storage,KEY,null);safeSet(storage,COMMAND_KEY,null);}
  emit();
 }
 function pause(){
  paused=true;stopTimers();socket?.close();state.wsConnected=false;
  clearPrivate();emit();
 }
 function resume(){
  if(!state.gameId)return;
  paused=false;
  onReturn();
 }
 function onReturn(){
  if(!state.gameId||paused)return;
  if(isInitial()&&remainingMs()<=0)expirePrivate();
  void sync({silent:true});
 }
 function queueReconnect(){
  if(paused||state.terminal||!state.gameId||!state.view||reconnectTimer!==null||handshakeTimer!==null)return;
  const attempt=reconnectAttempts++;
  const delay=Math.min(30000,Math.round(Math.min(30000,1000*2**Math.min(attempt,5))*
    (0.85+0.15*wait(random(),0,1))));
  const token=generation,id=state.gameId;
  reconnectTimer=setTimeoutFn(async()=>{
   reconnectTimer=null;
   if(token!==generation||paused||id!==state.gameId)return;
   const verified=await sync({silent:true});
   if(!verified||token!==generation||paused||id!==state.gameId){
    if(state.view&&id===state.gameId&&!paused&&!state.terminal)queueReconnect();
    return;
   }
   try{
    state.wsConnected=false;
    if(socket?.reconnect(id)!==true)throw Error('WS unavailable');
    handshakeTimer=setTimeoutFn(()=>{
     handshakeTimer=null;
     if(token!==generation||paused||id!==state.gameId||state.wsConnected)return;
     socket?.close();queueReconnect();
    },10000);
   }catch{queueReconnect();}
  },delay);
 }
 function beginSocket(id){
  if(paused)return;
  try{
   if(socket?.connect(id)!==true&&socket?.gameId!==id)queueReconnect();
  }catch{queueReconnect();}
 }
 function scheduleCompensation(){
  if(paused||!isInitial()||state.deadlineMs===null||remainingMs()>0||
     compensationTimer!==null||compensationTries>=6)return;
  const token=generation,id=state.gameId;
  const delay=[1500,2500,4000,6000,8000,10000][compensationTries++];
  compensationTimer=setTimeoutFn(async()=>{
   compensationTimer=null;
   if(token!==generation||paused||id!==state.gameId||!isInitial())return;
   await sync({silent:true});
   if(token===generation)scheduleCompensation();
  },delay);
 }
 function expirePrivate(){
  if(!isInitial()||remainingMs()>0)return;
  clearPrivate();emit();
  scheduleCompensation();
 }
 function updateDeadline(g,old,requestStart){
  if(deadlineTimer!==null){clearTimeoutFn(deadlineTimer);deadlineTimer=null;}
  if(compensationTimer!==null){clearTimeoutFn(compensationTimer);compensationTimer=null;}
  if(g.phase!=='InitialPeek'){
   state.deadlineMs=null;compensationTries=0;clearPrivate();return;
  }
  // Use request start, not response arrival: a delayed response must never
  // extend the original server-authorized private reveal window.
  const newMs=requestStart+Date.parse(g.initial_peek_deadline_at)-Date.parse(g.server_time);
  state.deadlineMs=old?.phase==='InitialPeek'&&state.deadlineMs!==null
    ? Math.min(state.deadlineMs,newMs):newMs;
  if(own()?.initial_peek_completed){state.privateEnded=true;clearPrivate();}
  const left=remainingMs();
  if(left<=0){clearPrivate();scheduleCompensation();}
  else{
   const token=generation,id=state.gameId;
   deadlineTimer=setTimeoutFn(()=>{
    deadlineTimer=null;
    if(token!==generation||id!==state.gameId||paused)return;
    expirePrivate();
   },left);
  }
 }
 function revoke(error){
  clearPrivate();stopTimers();socket?.close();
  if(error?.status===401)Promise.resolve().then(onUnauthorized).catch(()=>{});
  reset();state.error=error?.message||'当前游戏不再可访问。';emit();
 }
 async function readPrivate(){
  const id=state.gameId,token=generation,epoch=privateEpoch;
  const view=state.view,revision=view?.state_revision;
  if(paused||!isInitial()||!own()||state.privateEnded||own().initial_peek_completed||remainingMs()<=0)return false;
  try{
   const p=await api.getInitialPeekView(id);
   if(token!==generation||epoch!==privateEpoch||id!==state.gameId||
      state.view?.phase!=='InitialPeek'||state.view?.state_revision!==revision||
      state.privateEnded||own()?.initial_peek_completed||remainingMs()<=0)return false;
   if(p.game_session_id!==id||p.account_id!==getAccountId()||
      Date.parse(p.deadline_at)!==Date.parse(view.initial_peek_deadline_at)||
      Date.parse(p.server_time)>=Date.parse(p.deadline_at)){
    clearPrivate();state.error='私人查看响应与当前窗口不一致，已停止显示。';emit();return false;
   }
   const allowed=new Set(own()?.initial_peek_confirmed_positions||[]);
   if(p.revealed_cards.some(c=>!allowed.has(c.position))){
    clearPrivate();state.error='私人查看响应与已确认位置不一致。';emit();return false;
   }
   state.privateCards=Object.fromEntries(p.revealed_cards.map(c=>[c.position,c.value]));
   state.privateRemaining=p.remaining_peek_count;emit();return true;
  }catch(error){
   if(token!==generation||id!==state.gameId)return false;
   if([401,403,404].includes(error?.status)){
    clearPrivate();state.privateEnded=true;
    if(error.status===401)revoke(error);
   }
   else if(error?.status===409||error?.status===422||error?.code==='INVALID_GAME_STATE'){
    clearPrivate();state.privateEnded=true;
   }
   emit();return false;
  }
 }
 async function sync({silent=false,expectedRoomId=null}={}){
  if(!state.gameId||paused)return false;
  if(syncPromise){queuedSync=true;return syncPromise;}
  const id=state.gameId,token=generation,requestStart=now();
  state.pending=state.pending||'read';
  if(!silent){state.error='';emit();}
  let success=false;
  const promise=(async()=>{
   try{
    const g=await api.getGame(id);
    if(token!==generation||id!==state.gameId||paused)return false;
    if(!validGameView(g)||g.id.toLowerCase()!==id.toLowerCase()||
       (expectedRoomId&&g.room_id.toLowerCase()!==expectedRoomId.toLowerCase())||
       g.viewer_account_id!==getAccountId()){
      clearPrivate();state.privateEnded=true;state.refreshNeeded=true;
      state.error='GameView 身份、Room 或 Schema 不兼容，已停止使用响应。';
      emit();return false;
    }
    if(state.view&&g.state_revision<state.view.state_revision)return true;
    const old=state.view;
    const changed=!old||JSON.stringify(old)!==JSON.stringify(g);
    state.view=g;state.error='';state.refreshNeeded=false;state.terminal=false;
    safeSet(storage,KEY,id);
    if(changed){
     if(g.phase!=='InitialPeek')state.privateEnded=true;
     updateDeadline(g,old,requestStart);
     if(state.pendingCommand&&(!isInitial()||own()?.initial_peek_completed)){
      state.pendingCommand=null;safeSet(storage,COMMAND_KEY,null);state.outcomeUnknown=false;
     }
     emit();
    }
    if(!socket?.gameId&&!paused)beginSocket(id);
    if(isInitial()&&remainingMs()>0&&!own()?.initial_peek_completed&&
       (changed||Object.keys(state.privateCards).length===0))void readPrivate();
    success=true;return true;
   }catch(error){
    if(token!==generation||id!==state.gameId)return false;
    clearPrivate();
    if([401,403,404].includes(error?.status)){revoke(error);return false;}
    if(error?.code==='INVALID_GAME_STATE'||error?.code==='GAME_ENDED'){
     state.privateEnded=true;state.terminal=true;stopTimers();socket?.close();state.wsConnected=false;
    }
    state.error=error?.message||'暂时无法同步游戏。';
    state.refreshNeeded=true;emit();return false;
   }finally{
    if(token===generation){
     if(state.pending==='read')state.pending=null;
     syncPromise=null;
     if(queuedSync&&!paused){queuedSync=false;void sync({silent:true});}
     emit();
    }
   }
  })();
  syncPromise=promise;return promise;
 }
 function remember(id){
  if(!validId(id))return false;
  safeSet(storage,KEY,id);
  return true;
 }
 async function enter(id,{roomId=null}={}){
  if(!validId(id))return false;
  if(state.gameId===id&&state.view){
   paused=false;
   return sync({silent:true,expectedRoomId:roomId});
  }
  reset({clearLocator:false});
  state.gameId=id;
  emit();
  const ok=await sync({expectedRoomId:roomId});
  if(!ok)state.error=state.error||'无法验证 GameSession 访问资格。';
  emit();return ok;
 }
 async function restore({roomId=null}={}){
  const id=safeGet(storage,KEY);
  if(!validId(id)){safeSet(storage,KEY,null);return false;}
  const ok=await enter(id,{roomId});
  if(ok){
   const pending=safeGet(storage,COMMAND_KEY);
   if(pending){
    let meta;try{meta=JSON.parse(pending);}catch{}
    if(safeCommand(meta)&&meta.gameId===id&&meta.accountId===getAccountId()){
     state.pendingCommand=meta;state.outcomeUnknown=true;emit();
    }else safeSet(storage,COMMAND_KEY,null);
   }
  }
  return ok;
 }
 function validPeekPosition(position){
  return isInitial()&&remainingMs()>0&&!state.terminal&&!state.privateEnded&&!state.refreshNeeded&&!own()?.initial_peek_completed&&
   state.pending===null&&!state.pendingCommand&&
   Number.isInteger(position)&&position>=0&&position<=3&&
   own().hand_cards.some(c=>c.position===position)&&
   !own().initial_peek_confirmed_positions.includes(position)&&
   own().initial_peek_confirmed_positions.length<2;
 }
 function canComplete(){
  return isInitial()&&remainingMs()>0&&!state.terminal&&!state.privateEnded&&!state.refreshNeeded&&!own()?.initial_peek_completed&&
   !state.pending&&!state.pendingCommand;
 }
 async function command(type,position=null,{retry=false}={}){
  if(paused||!state.view)return false;
  if(!retry&&!(type==='peek'?validPeekPosition(position):canComplete()))return false;
  let meta;
  if(retry){
   meta=state.pendingCommand;
   if(!safeCommand(meta)||meta.type!==type||meta.gameId!==state.gameId||
      meta.accountId!==getAccountId())return false;
  }else{
   meta={gameId:state.gameId,accountId:getAccountId(),requestId:uuid(),type,
     ...(type==='peek'?{position}:{})};
   if(!safeCommand(meta))return false;
   state.pendingCommand=meta;
   safeSet(storage,COMMAND_KEY,JSON.stringify(meta));
  }
  const token=generation,id=state.gameId;
  state.pending=type;state.error='';state.outcomeUnknown=false;emit();
  try{
   const outcome=type==='peek'
     ?await api.initialPeek(id,meta.requestId,meta.position)
     :await api.completeInitialPeek(id,meta.requestId);
   if(token!==generation||id!==state.gameId||paused)return false;
   if(outcome.status==='NotYetDetermined'){
    state.outcomeUnknown=true;state.error='请求尚未裁决，请保留原 request_id 后重试核实。';
    return false;
   }
   if(outcome.status==='IdentityConflict'){
    state.outcomeUnknown=true;state.error='请求编号与已有操作冲突；请勿更换编号重新执行相同操作。';
    return false;
   }
   state.pendingCommand=null;safeSet(storage,COMMAND_KEY,null);
   state.outcomeUnknown=false;
   if(outcome.status==='Rejected'){
    state.error=message[outcome.reason]||'服务器拒绝了该命令，请同步最新 GameView。';
    if(['INITIAL_PEEK_EXPIRED','INITIAL_PEEK_COMPLETED','INVALID_GAME_STATE','GAME_ENDED'].includes(outcome.reason))clearPrivate();
   }else if(outcome.status==='Accepted'){
    if(type==='complete'){state.privateEnded=true;clearPrivate();}
    else if(outcome.peek_result&&isInitial()&&!state.privateEnded&&!own()?.initial_peek_completed&&remainingMs()>0&&
       Date.parse(outcome.peek_result.deadline_at)===Date.parse(state.view.initial_peek_deadline_at)&&
       outcome.peek_result.position===meta.position){
      state.privateCards={...state.privateCards,[meta.position]:outcome.peek_result.value};
    }
   }
   // Complete result is historical; Phase is determined only by new GameView.
   return outcome.status==='Accepted';
  }catch(error){
   if(token!==generation||id!==state.gameId)return false;
   if([401,403,404].includes(error?.status)){revoke(error);return false;}
   if(error?.outcomeUnknown){
    state.outcomeUnknown=true;
    state.error='命令结果未知，原 request_id 已保留。请仅使用「重试核实」重新提交同一请求。';
   }else{
    state.pendingCommand=null;safeSet(storage,COMMAND_KEY,null);
    state.error=error?.message||'Command 请求失败。';
   }
   return false;
  }finally{
   if(token===generation){
    state.pending=null;emit();
    if(state.gameId===id&&!paused){
     await sync({silent:true});
     if(type==='peek'&&isInitial()&&remainingMs()>0&&!own()?.initial_peek_completed)
      void readPrivate();
    }
   }
  }
 }
 return {
  state,reset,pause,resume,onReturn,enter,restore,remember,sync,readPrivate,
  peek:position=>command('peek',position),
  complete:()=>command('complete'),
  retryPending:()=>state.pendingCommand?command(state.pendingCommand.type,null,{retry:true}):Promise.resolve(false),
  validPeekPosition,canComplete,remainingMs
 };
}
