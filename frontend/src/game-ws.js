/** Game WS is a notification channel, never a GameView or command transport. */
import {getAuthApiBaseUrl} from './auth-api.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function gameWebSocketUrl(id,baseUrl=globalThis.CABO_GAME_WS_BASE_URL||globalThis.CABO_ROOM_WS_BASE_URL||getAuthApiBaseUrl(),protocol=globalThis.location?.protocol){
 if(typeof id!=='string'||!UUID.test(id))throw new TypeError('无效 GameSession ID');
 const root=getAuthApiBaseUrl({CABO_API_BASE_URL:baseUrl});
 const url=new URL('/ws/games/'+id,root);
 url.protocol=(protocol==='https:'||url.protocol==='https:')?'wss:':'ws:';
 return url.href;
}
export function createGameSocket({onChanged=()=>{},onOpen=()=>{},onClosed=()=>{},WebSocketImpl=globalThis.WebSocket,baseUrl}={}){
 let ws=null,gameId=null;
 function close(){
  const old=ws;ws=null;gameId=null;
  if(old){old.onopen=null;old.onmessage=null;old.onerror=null;old.onclose=null;old.close();}
 }
 function connect(id){
  if(ws&&gameId?.toLowerCase()===id?.toLowerCase()&&ws.readyState!==WebSocketImpl?.CLOSED)return false;
  close();if(typeof WebSocketImpl!=='function')return false;
  const sock=new WebSocketImpl(gameWebSocketUrl(id,baseUrl));ws=sock;gameId=id;
  sock.onopen=()=>{if(ws===sock)onOpen(id);};
  sock.onmessage=e=>{
   if(ws!==sock||gameId!==id)return;
   let data;try{data=JSON.parse(e.data);}catch{return;}
   if(data?.type==='game.changed'&&typeof data.game_session_id==='string'&&
     data.game_session_id.toLowerCase()===id.toLowerCase())onChanged(id);
  };
  sock.onerror=()=>{};
  sock.onclose=e=>{
   if(ws!==sock)return;
   ws=null;gameId=null;onClosed(id,e?.code);
  };
  return true;
 }
 return {connect,reconnect:id=>{close();return connect(id);},close};
}
