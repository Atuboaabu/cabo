/**
 * Room-change notifications only. The WebSocket never contains an authoritative
 * Room View: its sole effect is to request an HTTP GET through real-room-state.
 * The browser handles the HttpOnly Session cookie during the handshake.
 */
import {getAuthApiBaseUrl} from './auth-api.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function roomWebSocketUrl(roomId, baseUrl=globalThis.CABO_ROOM_WS_BASE_URL||getAuthApiBaseUrl()) {
  if(typeof roomId!=='string'||!UUID.test(roomId))throw new TypeError('房间 ID 格式无效');
  // Validate the configured origin with the same rules as the existing API.
  const root=getAuthApiBaseUrl({CABO_API_BASE_URL:baseUrl});
  const url=new URL('/ws/rooms/'+roomId,root);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  return url.href;
}

export function createRoomSocket({onChanged,WebSocketImpl=globalThis.WebSocket,baseUrl}={}) {
  if(typeof onChanged!=='function')throw new TypeError('需要房间变更回调');
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
    if(socket&&activeRoomId?.toLowerCase()===roomId?.toLowerCase())return;
    close();
    if(typeof WebSocketImpl!=='function')return;
    const url=roomWebSocketUrl(roomId,baseUrl);
    const ws=new WebSocketImpl(url);
    socket=ws;activeRoomId=roomId;
    ws.onmessage=event=>{
      if(socket!==ws||activeRoomId!==roomId)return;
      let data;
      try{data=JSON.parse(event.data);}catch{return;}
      if(data?.type==='room.changed'&&typeof data.room_id==='string'&&
         data.room_id.toLowerCase()===roomId.toLowerCase()){
        onChanged(roomId);
      }
    };
    // No automatic reconnect. The manual refresh button stays available.
  }
  return {connect,close,get roomId(){return activeRoomId;}};
}
