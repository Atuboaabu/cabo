/**
 * Real Room navigation controller. The stored UUID is a locator, never proof
 * of membership. Only a successful GET /rooms/{id} authorizes the displayed view.
 * No Auth cookie, Account, or Room View is persisted.
 */
const KEY='cabo.lastRealRoomId';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_CODE=/^[A-HJ-NP-Z2-9]{6}$/;

export function createRealRoomState({api,storage=null,onChange=()=>{},onUnauthorized=()=>{}}) {
  const state={
    roomId:null,view:null,pending:null,error:'',outcomeUnknown:false,
    joinCode:'',stale:false
  };
  const emit=()=>onChange(state);
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
      state.error+=' 请先从其他已登录页面确认房间状态，勿直接重复创建或加入。';
    }
    if(error?.status===403 || error?.status===404){
      // Authorization/room invalidation cannot be inferred from a stale view.
      save(null);state.roomId=null;state.view=null;state.stale=false;
    }else if(kind==='read'){
      // Network errors do not prove the room is gone; retained data is stale.
      state.stale=!!state.view;
      if(error?.status===401)state.view=null;
    }
    if(error?.status===401)Promise.resolve().then(onUnauthorized).catch(()=>{});
  }
  async function readRoom(id) {
    if(state.pending || !UUID.test(id))return false;
    state.pending='read';state.error='';state.stale=!!state.view;emit();
    try{
      const room=await api.getRoom(id);
      if(room.id.toLowerCase()!==id.toLowerCase())throw Error('服务端返回的房间 ID 不一致，请重新验证。');
      state.roomId=id;state.view=room;state.error='';state.stale=false;
      state.outcomeUnknown=false;
      save(id);
      return true;
    }catch(error){
      failure(error,'read');
      return false;
    }finally{state.pending=null;emit();}
  }
  async function enter(write) {
    if(state.pending||state.outcomeUnknown||state.roomId)return false;
    state.pending=write;state.error='';emit();
    let roomId=null;
    try{
      const result=write==='create'
        ? await api.createRoom()
        : await api.joinRoom(state.joinCode.trim().toUpperCase());
      // Only an HTTP 201/200 RoomResponse supplies a genuine ID.
      roomId=result.id;
      state.roomId=roomId;save(roomId);
      state.pending='read';emit();
      const room=await api.getRoom(roomId);
      if(room.id.toLowerCase()!==roomId.toLowerCase())throw Error('服务端返回的房间 ID 不一致，请重新验证。');
      state.view=room;state.error='';state.stale=false;state.outcomeUnknown=false;
      return true;
    }catch(error){
      // If Create/Join committed but returned no ID, there is no safe way
      // to discover that Room through the available backend endpoints.
      failure(error,roomId?'read':write);
      return false;
    }finally{state.pending=null;emit();}
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
    if(!id){state.roomId=null;state.view=null;state.error='';state.stale=false;emit();return false;}
    state.roomId=id;state.view=null; // Never restore an unverified cached Room View.
    return readRoom(id);
  }
  async function refresh(){
    return state.roomId?readRoom(state.roomId):false;
  }
  return {state,reset,setJoinCode,createRoom,joinRoom,restore,refresh};
}
