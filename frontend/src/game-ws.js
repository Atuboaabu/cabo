/** Game WebSocket: notification-only, one connection per verified Game. */
import { getAuthApiBaseUrl } from './auth-api.js';
import { GAME_ID } from './game-api.js';
export function gameWebSocketUrl(id,scope=globalThis){
 if(typeof id!=='string'||!GAME_ID.test(id))throw new TypeError('无效 GameSession ID');
 const base=scope?.CABO_ROOM_WS_BASE_URL||getAuthApiBaseUrl(scope);
 const url=new URL(base);
 if(!['http:','https:','ws:','wss:'].includes(url.protocol))throw new TypeError('WebSocket origin 无效');
 const secure=scope?.location?.protocol==='https:'||['https:','wss:'].includes(url.protocol);
 url.protocol=secure?'wss:':'ws:';
 url.pathname='/ws/games/'+id;
 url.search='';url.hash='';
 return url.href;
}
const diagnostic=(name,id)=>{if(globalThis.CABO_DEBUG_ROOM_WS===true)console.info('[CABO game WS]',name,{game_session_id:id});};
export function createGameSocket({onChanged=()=>{},onOpen=()=>{},onClosed=()=>{},WebSocketImpl=globalThis.WebSocket,baseUrl}={}){
 let socket=null,id=null;
 function close(){
  const old=socket;socket=null;id=null;
  if(old){
   old.onmessage=null;old.onclose=null;old.onopen=null;old.onerror=null;
   try{old.close();}catch{}
  }
 }
 function connect(gameId,{replace=false}={}){
  if(!GAME_ID.test(gameId))throw new TypeError('无效 GameSession ID');
  if(socket&&id===gameId&&!replace)return false;
  close();
  if(typeof WebSocketImpl!=='function')return false;
  const next=new WebSocketImpl(gameWebSocketUrl(gameId,baseUrl?
   {CABO_ROOM_WS_BASE_URL:baseUrl,location:globalThis.location}:globalThis));
  socket=next;id=gameId;let ended=false;
  diagnostic('connecting',id);
  next.onopen=()=>{if(socket===next&&!ended){diagnostic('open',gameId);onOpen(gameId);}};
  next.onmessage=e=>{
   if(socket!==next||ended)return;
   let value;
   try{value=JSON.parse(e.data);}catch{return;}
   if(value?.type==='game.changed'&&typeof value.game_session_id==='string'&&
      value.game_session_id.toLowerCase()===gameId.toLowerCase()){
    diagnostic('game.changed',gameId);onChanged(gameId);
   }
  };
  next.onerror=()=>{if(socket===next)diagnostic('error',gameId);};
  next.onclose=e=>{
   if(socket!==next||ended)return;
   ended=true;
   next.onclose=null;next.onopen=null;next.onmessage=null;next.onerror=null;
   diagnostic('close',gameId);
   onClosed(gameId,e?.code);
  };
  return true;
 }
 return {connect,close,reconnect:gameId=>connect(gameId,{replace:true}),get gameId(){return id;}};
}
