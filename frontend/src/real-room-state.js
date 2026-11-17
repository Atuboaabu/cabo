/**
 * Real Room navigation controller. The stored UUID is a locator, never proof
 * of membership. Only a successful GET /rooms/{id} authorizes the displayed view.
 * No Auth cookie, Account, or Room View is persisted.
 */
const KEY='cabo.lastRealRoomId';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_CODE=/^[A-HJ-NP-Z2-9]{6}$/;
const trace=(event,roomId,extra={})=>{
  if(globalThis.CABO_DEBUG_ROOM_WS===true)
    console.info('[CABO room]',event,{room_id:roomId,...extra});
};


export function createRealRoomState({api,storage=null,onChange=()=>{},onUnauthorized=()=>{},getAccountId=()=>null,createSocket=null,setTimeoutFn=globalThis.setTimeout,clearTimeoutFn=globalThis.clearTimeout,random=Math.random}={}) {
  const state={
    roomId:null,view:null,pending:null,error:'',outcomeUnknown:false,
    joinCode:'',stale:false,quietRead:false
  };
  let generation=0,queuedRoomChange=false,queuedCloseVerification=false,queuedReturnVerification=false,notificationsPaused=false;
  // Single recovery owner and at most one timeout for the current generation.
  let recovery=null;
  function isRecoveryActive(r){
    return r===recovery&&r.generation===generation&&
      r.roomId.toLowerCase()===state.roomId?.toLowerCase()&&
      !!state.view&&!notificationsPaused;
  }
  function clearRecoveryTimer(r){
    if(r?.timer!=null){clearTimeoutFn(r.timer);r.timer=null;}
  }
  function cancelRecovery(){
    clearRecoveryTimer(recovery);
    recovery=null;
  }
  function scheduleRecovery(r){
    if(!isRecoveryActive(r)||r.timer!=null||r.due)return;
    const base=Math.min(30000,1000*2**Math.min(r.attempts,5));
    const jitter=0.85+Math.max(0,Math.min(1,random()))*0.15;
    const delay=Math.min(30000,Math.round(base*jitter));
    r.attempts++;
    trace('reconnect-scheduled',r.roomId,{delay_ms:delay,attempt:r.attempts});
    r.timer=setTimeoutFn(()=>{
      r.timer=null;
      if(!isRecoveryActive(r))return;
      r.due=true;
      drainRecovery();
    },delay);
  }
  function drainRecovery(){
    const r=recovery;
    if(!r||!r.due||!isRecoveryActive(r)||state.pending||queuedRoomChange)return;
    r.due=false;
    if(r.phase==='validate'||r.phase==='postopen'){
      void readRoom(r.roomId,{silent:true,fromRecovery:true});
    }else if(r.phase==='connect'){
      r.phase='opening';
      try{
        if(socket?.reconnect(r.roomId)!==true)throw Error('socket unavailable');
        // OPEN, not constructor completion, confirms a successful connection.
        // This single handshake timeout prevents a stuck CONNECTING socket.
        if(r.phase==='opening'){
          r.timer=setTimeoutFn(()=>{
            r.timer=null;
            if(!isRecoveryActive(r)||r.phase!=='opening')return;
            socket?.close(); // Detached local close, not a server kick.
            r.phase='validate';
            trace('reconnect-handshake-timeout',r.roomId);
            scheduleRecovery(r);
          },10000);
        }
      }catch{
        if(!isRecoveryActive(r))return;
        r.phase='validate';
        trace('reconnect-connect-failed',r.roomId);
        scheduleRecovery(r);
      }
    }
  }
  function confirmedRecoveryRead(id){
    const r=recovery;
    if(!r||!isRecoveryActive(r)||r.roomId.toLowerCase()!==id.toLowerCase())return;
    if(r.phase==='postopen'){
      trace('reconnect-synced',id);
      cancelRecovery();
    }else if(r.phase==='validate'){
      r.phase='connect';
      scheduleRecovery(r);
    }
  }
  function failedRecoveryRead(error){
    const r=recovery;
    if(!r)return;
    if([401,403,404].includes(error?.status)){cancelRecovery();return;}
    if(isRecoveryActive(r)&&(r.phase==='validate'||r.phase==='postopen'))
      scheduleRecovery(r);
  }
  const socket=createSocket?.({
    onChanged:roomId=>{
      if(roomId.toLowerCase()!==state.roomId?.toLowerCase()||!state.view||
         notificationsPaused)return;
      queuedRoomChange=true;
      flushRoomChange();
    },
    onOpen:roomId=>{
      const r=recovery;
      if(!r||!isRecoveryActive(r)||r.phase!=='opening'||
        r.roomId.toLowerCase()!==roomId.toLowerCase())return;
      clearRecoveryTimer(r);
      r.phase='postopen';
      queuedRoomChange=true; // Always GET after reconnect OPEN.
      trace('reconnect-open',roomId);
      flushRoomChange();
    },
    onClosed:roomId=>{
      // WebSocket close (including 1008) is a signal to *verify*, not proof
      // of a kick. Only an authoritative GET may revoke Room navigation.
      const eligible=roomId.toLowerCase()===state.roomId?.toLowerCase()&&
        !!state.view&&!notificationsPaused;
      trace('close-callback',roomId,{
        eligible,paused:notificationsPaused,pending:state.pending||'none'
      });
      if(!eligible)return;
      if(!recovery||!isRecoveryActive(recovery)){
        cancelRecovery();
        recovery={roomId,generation,attempts:0,timer:null,due:false,phase:'validate'};
      }else{
        clearRecoveryTimer(recovery);
        recovery.due=false;
        recovery.phase='validate';
      }
      queuedRoomChange=true;
      queuedCloseVerification=true;
      flushRoomChange();
    }
  });
  const emit=options=>onChange(state,options);
  function openRoomSocket(id){
    // During recovery only drainRecovery may create a socket, after GET 200
    // and its bounded delay. Ordinary rendering/GET must not bypass backoff.
    if(notificationsPaused||recovery)return;
    try{socket?.connect(id);}catch{
      trace('socket-connect-failed',id); // Deliberately omit exception details.
    }
  }
  function pauseNotifications(){
    notificationsPaused=true;queuedRoomChange=false;queuedCloseVerification=false;queuedReturnVerification=false;cancelRecovery();socket?.close();
  }
  function resumeNotifications(){
    notificationsPaused=false;
    if(state.roomId&&state.view)openRoomSocket(state.roomId);
  }
  function verifyOnReturn(){
    // A missed WebSocket close cannot be distinguished from a healthy socket.
    // Re-check membership once when the tab/window comes back to the foreground.
    if(notificationsPaused||!state.roomId||!state.view)return false;
    queuedRoomChange=true;
    queuedReturnVerification=true;
    flushRoomChange();
    return true;
  }
  function flushRoomChange(){
    if(state.pending||!state.roomId||!state.view||notificationsPaused)return;
    if(queuedRoomChange){
      queuedRoomChange=false;
      const fromClose=queuedCloseVerification;
      queuedCloseVerification=false;
      queuedReturnVerification=false;
      if(fromClose)trace('close-recheck-queued',state.roomId);
      void readRoom(state.roomId,{silent:true,fromClose});
      return;
    }
    drainRecovery();
  }
  const save=id=>{
    try { if(id)storage?.setItem(KEY,id);else storage?.removeItem(KEY); }
    catch { /* Private browsing / storage denied: in-memory navigation still works. */ }
  };
  const stored=()=>{
    try {
      const value=storage?.getItem(KEY);
      if(value && UUID.test(value))return value;
      if(value)save(null);
    }catch { /* Storage unavailable, no session permission inferred. */ }
    return null;
  };
  function reset({silent=false}={}){
    generation++; // Invalidate any outstanding create/join/GET response.
    queuedRoomChange=false;queuedCloseVerification=false;queuedReturnVerification=false;
    cancelRecovery();socket?.close();
    save(null);
    state.roomId=null;state.view=null;state.pending=null;state.error='';
    state.outcomeUnknown=false;state.joinCode='';state.stale=false;state.quietRead=false;
    emit(silent?{silent:true}:undefined);
  }
  function setJoinCode(value){
    state.joinCode=String(value??'').toUpperCase();
  }
  function failure(error,kind) {
    state.error=error?.message||'房间请求未完成，请稍后重试。';
    if(error?.outcomeUnknown && kind!=='read'){
      state.outcomeUnknown=true;
      state.error+=kind==='mutation'
        ? ' 操作结果尚不能确认，请刷新房间，勿重复提交。'
        : ' 请先从其他已登录页面确认房间状态，勿直接重复创建或加入。';
    }
    if((error?.status===403 || error?.status===404) && kind!=='mutation'){
      // An authoritative GET may revoke the current Room locator.
      queuedRoomChange=false;queuedCloseVerification=false;queuedReturnVerification=false;cancelRecovery();socket?.close();
      trace('room-access-revoked',state.roomId,{status:error.status});
      save(null);state.roomId=null;state.view=null;state.stale=false;
    }else if(kind==='read'||kind==='mutation'){
      // Mutation conflicts / network uncertainty require a fresh GET before
      // any more writes. A kick-target 404 does not invalidate the whole Room.
      state.stale=!!state.view;
      if(kind==='mutation' && error?.status===404)state.error+=' 请刷新房间查看最新成员。';
      if(error?.status===401){cancelRecovery();state.view=null;socket?.close();}
    }
    if(error?.status===401)Promise.resolve().then(onUnauthorized).catch(()=>{});
  }
  async function readRoom(id,{silent=false,fromClose=false}={}) {
    if(state.pending || !UUID.test(id))return false;
    const token=generation;
    // A WebSocket notification is not a foreground operation. Keep the
    // current Room visible and do not emit intermediate loading/stale states.
    const background=silent&&!!state.view;
    let changed=false;
    state.pending='read';state.quietRead=false;
    if(fromClose)trace('close-recheck-get',id);
    if(!background){state.error='';state.stale=!!state.view;emit();}
    try{
      const room=await api.getRoom(id);
      // A socket close during an older GET requires a fresh authorization
      // check. Discard that older response before any UI mutation.
      if(token!==generation||queuedCloseVerification||queuedReturnVerification)return false;
      if(fromClose)trace('close-recheck-result',id,{status:200});
      if(room.id.toLowerCase()!==id.toLowerCase())throw Error('服务端返回的房间 ID 不一致，请重新验证。');
      changed=JSON.stringify(state.view)!==JSON.stringify(room)||!!state.error||state.stale;
      state.roomId=id;state.view=room;state.error='';state.stale=false;
      state.outcomeUnknown=false;
      save(id);
      openRoomSocket(id);
      confirmedRecoveryRead(id);
      return true;
    }catch(error){
      if(token===generation&&!queuedCloseVerification&&!queuedReturnVerification){
        if(fromClose)trace('close-recheck-result',id,{status:error?.status||0});
        if(!background || [401,403,404].includes(error?.status)){
          failure(error,'read');
          if(fromClose&&(error?.status===403||error?.status===404)){
            state.error='当前房间已关闭或你已不在房间，请重新创建或加入。';
          }
          changed=true;
        }
        // Transient notification GET failures are silent. Preserve the last
        // confirmed view and let the existing manual refresh surface errors.
        failedRecoveryRead(error);
      }
      return false;
    }finally{
      if(token===generation){
        state.pending=null;
        if(!background || changed)emit(background?{silent:true}:undefined);
        flushRoomChange();
      }
    }
  }
  async function enter(write) {
    if(state.pending||state.outcomeUnknown||state.roomId)return false;
    const token=generation;
    state.pending=write;state.error='';emit();
    let roomId=null;
    try{
      const result=write==='create'
        ? await api.createRoom()
        : await api.joinRoom(state.joinCode.trim().toUpperCase());
      if(token!==generation)return false;
      // Only an HTTP 201/200 RoomResponse supplies a genuine ID.
      roomId=result.id;
      state.roomId=roomId;save(roomId);
      state.pending='read';emit();
      const room=await api.getRoom(roomId);
      if(token!==generation)return false;
      if(room.id.toLowerCase()!==roomId.toLowerCase())throw Error('服务端返回的房间 ID 不一致，请重新验证。');
      state.view=room;state.error='';state.stale=false;state.outcomeUnknown=false;
      openRoomSocket(roomId);
      return true;
    }catch(error){
      // If Create/Join committed but returned no ID, there is no safe way
      // to discover that Room through the available backend endpoints.
      if(token===generation)failure(error,roomId?'read':write);
      return false;
    }finally{if(token===generation){state.pending=null;emit();flushRoomChange();}}
  }
  async function createRoom(){return enter('create');}
  async function joinRoom(){
    if(state.pending||state.outcomeUnknown||state.roomId)return false;
    const normalized=state.joinCode.trim().toUpperCase();
    if(!ROOM_CODE.test(normalized)){
      state.error='请输入有效的六位房间码。';emit();return false;
    }
    state.joinCode=normalized;
    return enter('join');
  }
  async function restore(){
    if(state.pending)return false;
    const id=stored();
    if(!id){queuedRoomChange=false;queuedCloseVerification=false;queuedReturnVerification=false;cancelRecovery();socket?.close();state.roomId=null;state.view=null;state.error='';state.stale=false;emit();return false;}
    if(state.roomId?.toLowerCase()!==id.toLowerCase()){
      queuedRoomChange=false;queuedCloseVerification=false;queuedReturnVerification=false;cancelRecovery();socket?.close();
    }
    state.roomId=id;state.view=null; // Never restore an unverified cached Room View.
    return readRoom(id);
  }
  async function refresh(){
    return state.roomId?readRoom(state.roomId):false;
  }
  function authorizedMember(){
    if(!state.roomId||!state.view||state.view.state!=='Lobby'||
       state.pending||state.stale||state.outcomeUnknown)return null;
    const id=getAccountId();
    return id ? state.view.members.find(member=>member.account_id===id)||null : null;
  }
  function allowedMutation(action,targetAccountId){
    const me=authorizedMember();
    if(!me)return false;
    if(action==='ready')return !me.is_host;
    if(action==='leave')return true;
    if(action==='disband')return me.is_host;
    if(action==='kick')return me.is_host&&targetAccountId!==me.account_id&&
      state.view.members.some(member=>member.account_id===targetAccountId&&!member.is_host);
    return false;
  }
  async function mutate(action,payload) {
    const target=payload?.targetAccountId;
    if(!allowedMutation(action,target))return false;
    const id=state.roomId, token=generation;
    state.pending=action;
    state.quietRead=false;
    state.error='';
    emit({silent:true});
    try{
      if(action==='ready')await api.setReady(id,payload.ready);
      else if(action==='leave')await api.leaveRoom(id);
      else if(action==='kick')await api.kickMember(id,target);
      else if(action==='disband')await api.disbandRoom(id);
      if(token!==generation)return false;
      if(action==='leave'||action==='disband'){
        // Only a confirmed 204 clears the Room locator; Session stays intact.
        reset({silent:true});
        return true;
      }
      state.pending='read';state.quietRead=true;emit({silent:true});
      try{
        const latest=await api.getRoom(id);
        if(token!==generation||queuedCloseVerification||queuedReturnVerification)return false;
        if(latest.id.toLowerCase()!==id.toLowerCase())throw Error('服务端返回的房间 ID 不一致，请刷新房间。');
        state.view=latest;
        openRoomSocket(id);
        state.stale=false;
        state.outcomeUnknown=false;
        state.error='';
        return true;
      }catch(error){
        if(token!==generation||queuedCloseVerification||queuedReturnVerification)return false;
        failure(error,'read');
        // A confirmed write followed by an authoritative 403/404 means the
        // Room locator has been invalidated. No Room ID remains to refresh.
        // For transient GET failures retain the locator and offer read-only retry.
        state.error=(error?.status===403||error?.status===404)
          ? '操作已获服务器受理，但当前房间已无法访问，请返回房间入口。'
          : '操作可能已完成，但暂时无法确认最新房间状态，请刷新房间。';
        return false;
      }
    }catch(error){
      if(token===generation)failure(error,'mutation');
      return false;
    }finally{
      if(token===generation){state.pending=null;state.quietRead=false;emit({silent:true});flushRoomChange();}
    }
  }
  async function setReady(ready){
    const me=authorizedMember();
    if(!me||me.is_host||typeof ready!=='boolean'||ready===me.is_ready)return false;
    return mutate('ready',{ready});
  }
  async function leaveRoom(){return mutate('leave');}
  async function kickMember(targetAccountId){return mutate('kick',{targetAccountId});}
  async function disbandRoom(){return mutate('disband');}
  return {state,reset,setJoinCode,createRoom,joinRoom,restore,refresh,setReady,leaveRoom,kickMember,disbandRoom,allowedMutation,pauseNotifications,resumeNotifications,verifyOnReturn};
}
