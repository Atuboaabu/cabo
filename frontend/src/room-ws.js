/**
 * Room-change notifications only. The WebSocket never contains an authoritative
 * Room View: its sole effect is to request an HTTP GET through real-room-state.
 * The browser handles the HttpOnly Session cookie during the handshake.
 */
import {getAuthApiBaseUrl} from './auth-api.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Opt-in diagnostics: no Cookie, token, payload or exception objects.
const trace=(event,roomId,detail={})=>{
  if(globalThis.CABO_DEBUG_ROOM_WS===true)
    console.info('[CABO room WS]',event,{room_id:roomId,...detail});
};

export function roomWebSocketUrl(roomId, baseUrl=globalThis.CABO_ROOM_WS_BASE_URL||getAuthApiBaseUrl(), pageProtocol=globalThis.location?.protocol) {
  if(typeof roomId!=='string'||!UUID.test(roomId))throw new TypeError('房间 ID 格式无效');
  // Validate the configured origin with the same rules as the existing API.
  const root=getAuthApiBaseUrl({CABO_API_BASE_URL:baseUrl});
  const url=new URL('/ws/rooms/'+roomId,root);
  // HTTPS pages must never attempt a mixed-content ws:// handshake.
  url.protocol=(pageProtocol==='https:'||url.protocol==='https:')?'wss:':'ws:';
  return url.href;
}

export function createRoomSocket({onChanged,onClosed=()=>{},onOpen=()=>{},WebSocketImpl=globalThis.WebSocket,baseUrl}={}) {
  if(typeof onChanged!=='function'||typeof onClosed!=='function'||typeof onOpen!=='function')throw new TypeError('需要房间通知回调');
  let socket=null,activeRoomId=null;
  function close(){
    const old=socket;
    socket=null;activeRoomId=null;
    if(old){
      old.onmessage=null;
      old.onopen=null;
      old.onerror=null;
      old.onclose=null;
      old.close();
    }
  }
  function connect(roomId){
    if(socket&&activeRoomId?.toLowerCase()===roomId?.toLowerCase())return false;
    close();
    if(typeof WebSocketImpl!=='function')return false;
    const url=roomWebSocketUrl(roomId,baseUrl);
    const ws=new WebSocketImpl(url);
    socket=ws;activeRoomId=roomId;
    trace('connecting',roomId,{origin:new URL(url).origin});
    ws.onopen=()=>{
      if(socket!==ws)return;
      trace('open',roomId);
      onOpen(roomId);
    };
    ws.onerror=()=>{
      if(socket===ws)trace('error',roomId);
    };
    ws.onmessage=event=>{
      if(socket!==ws||activeRoomId!==roomId)return;
      let data;
      try{data=JSON.parse(event.data);}catch{return;}
      if(data?.type==='room.changed'&&typeof data.room_id==='string'&&
         data.room_id.toLowerCase()===roomId.toLowerCase()){
        trace('room.changed',roomId);
        onChanged(roomId);
      }
    };
    ws.onclose=event=>{
      if(socket!==ws||activeRoomId!==roomId)return;
      // Keep the closed socket as a marker: subsequent verified GETs must
      // not transparently reconnect until the caller explicitly closes it.
      ws.onclose=null;
      ws.onmessage=null;
      trace('close',roomId,{code:event?.code,clean:event?.wasClean===true});
      onClosed(roomId,event?.code);
    };
    // The controller owns backoff and permission checks; this layer never retries.
    return true;
  }
  function reconnect(roomId){
    // Called only after the controller's authoritative GET. Detach old close
    // handlers before closing, and make this the sole active socket.
    close();
    return connect(roomId);
  }
  return {connect,reconnect,close,get roomId(){return activeRoomId;}};
}
