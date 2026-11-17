/**
 * Real Room navigation controller. The stored UUID is a locator, never proof
 * of membership. Only a successful GET /rooms/{id} authorizes the displayed view.
 * No Auth cookie, Account, or Room View is persisted.
 */
const KEY='cabo.lastRealRoomId';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_CODE=/^[A-HJ-NP-Z2-9]{6}$/;

export function createRealRoomState({api,storage=null,onChange=()=>{},onUnauthorized=()=>{},getAccountId=()=>null,createSocket=null}={}) {
  const state={
    roomId:null,view:null,pending:null,error:'',outcomeUnknown:false,
    joinCode:'',stale:false
  };
  let generation=0,queuedRoomChange=false,queuedCloseVerification=false,notificationsPaused=false;
  const socket=createSocket?.({
    onChanged:roomId=>{
      if(roomId.toLowerCase()!==state.roomId?.toLowerCase()||!state.view||
         notificationsPaused)return;
      queuedRoomChange=true;
      flushRoomChange();
    },
    onClosed:roomId=>{
      // WebSocket close (including 1008) is a signal to *verify*, not proof
      // of a kick. Only an authoritative GET may revoke Room navigation.
      if(roomId.toLowerCase()!==state.roomId?.toLowerCase()||!state.view||
         notificationsPaused)return;
      queuedRoomChange=true;
      queuedCloseVerification=true;
      flushRoomChange();
    }
  });
  const emit=options=>onChange(state,options);
  function openRoomSocket(id){
    if(notificationsPaused)return;
    try{socket?.connect(id);}catch{/* HTTP Room View remains authoritative. */}
  }
  function pauseNotifications(){
    notificationsPaused=true;queuedRoomChange=false;queuedCloseVerification=false;socket?.close();
  }
  function resumeNotifications(){
    notificationsPaused=false;
    if(state.roomId&&state.view)openRoomSocket(state.roomId);
  }
  function flushRoomChange(){
    if(!queuedRoomChange||state.pending||!state.roomId||!state.view||notificationsPaused)return;
    queuedRoomChange=false;
    const fromClose=queuedCloseVerification;
    queuedCloseVerification=false;
    void readRoom(state.roomId,{silent:true,fromClose});
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
  function reset(){
    generation++; // Invalidate any outstanding create/join/GET response.
    queuedRoomChange=false;queuedCloseVerification=false;
    socket?.close();
    save(null);
    state.roomId=null;state.view=null;state.pending=null;state.error='';
    state.outcomeUnknown=false;state.joinCode='';state.stale=false;
    emit();
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
      queuedRoomChange=false;queuedCloseVerification=false;socket?.close();
      save(null);state.roomId=null;state.view=null;state.stale=false;
    }else if(kind==='read'||kind==='mutation'){
      // Mutation conflicts / network uncertainty require a fresh GET before
      // any more writes. A kick-target 404 does not invalidate the whole Room.
      state.stale=!!state.view;
      if(kind==='mutation' && error?.status===404)state.error+=' 请刷新房间查看最新成员。';
      if(error?.status===401){state.view=null;socket?.close();}
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
    state.pending='read';
    if(!background){state.error='';state.stale=!!state.view;emit();}
    try{
      const room=await api.getRoom(id);
      // A socket close during an older GET requires a fresh authorization
      // check. Discard that older response before any UI mutation.
      if(token!==generation||queuedCloseVerification)return false;
      if(room.id.toLowerCase()!==id.toLowerCase())throw Error('服务端返回的房间 ID 不一致，请重新验证。');
      changed=JSON.stringify(state.view)!==JSON.stringify(room)||!!state.error||state.stale;
      state.roomId=id;state.view=room;state.error='';state.stale=false;
      state.outcomeUnknown=false;
      save(id);
      openRoomSocket(id);
      return true;
    }catch(error){
      if(token===generation&&!queuedCloseVerification){
        if(!background || [401,403,404].includes(error?.status)){
          failure(error,'read');
          if(fromClose&&(error?.status===403||error?.status===404)){
            state.error='当前房间已关闭或你已不在房间，请重新创建或加入。';
          }
          changed=true;
        }
        // Transient notification GET failures are silent. Preserve the last
        // confirmed view and let the existing manual refresh surface errors.
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
    if(!id){queuedRoomChange=false;queuedCloseVerification=false;socket?.close();state.roomId=null;state.view=null;state.error='';state.stale=false;emit();return false;}
    if(state.roomId?.toLowerCase()!==id.toLowerCase()){
      queuedRoomChange=false;queuedCloseVerification=false;socket?.close();
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
        reset();
        return true;
      }
      state.pending='read';emit({silent:true});
      try{
        const latest=await api.getRoom(id);
        if(token!==generation||queuedCloseVerification)return false;
        if(latest.id.toLowerCase()!==id.toLowerCase())throw Error('服务端返回的房间 ID 不一致，请刷新房间。');
        state.view=latest;
        openRoomSocket(id);
        state.stale=false;
        state.outcomeUnknown=false;
        state.error='';
        return true;
      }catch(error){
        if(token!==generation||queuedCloseVerification)return false;
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
      if(token===generation){state.pending=null;emit({silent:true});flushRoomChange();}
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
  return {state,reset,setJoinCode,createRoom,joinRoom,restore,refresh,setReady,leaveRoom,kickMember,disbandRoom,allowedMutation,pauseNotifications,resumeNotifications};
}
