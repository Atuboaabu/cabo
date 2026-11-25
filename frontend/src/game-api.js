/** Real Game HTTP contract. Cookie stays HttpOnly, private card values never logged. */
import { getAuthApiBaseUrl } from './auth-api.js';

export const GAME_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uuid=x=>typeof x==='string'&&GAME_ID.test(x);
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const int=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isInteger(x)&&x>=min&&x<=max;
const resultStatus=new Set(['Accepted','Rejected','NotYetDetermined','IdentityConflict']);
const gameState=new Set(['InitialPeek','PlayerTurn']);
const errors={
 INVALID_COOKIE:'登录已失效，请重新登录。',
 GAME_NOT_ACCESSIBLE:'当前账号没有该游戏的访问权限。',
 INVALID_GAME_STATE:'游戏阶段已变化，请同步最新游戏状态。',
 INITIAL_PEEK_EXPIRED:'初始查看窗口已结束。',
 INITIAL_PEEK_COMPLETED:'你已结束初始查看。',
 INVALID_PEEK_TARGET:'不是可查看的初始牌位置。',
 REPEATED_PEEK:'这张牌的位置已确认，不能再次查看。',
 PEEK_LIMIT_EXCEEDED:'已达到两次初始查看额度。',
 GAME_ENDED:'当前游戏已结束。'
};
export class GameApiError extends Error{
 constructor(message,status=0,code='GAME_API_ERROR',outcomeUnknown=false){
  super(message);this.name='GameApiError';this.status=status;this.code=code;
  this.outcomeUnknown=outcomeUnknown;
 }
}
const checkedId=id=>{
 if(!uuid(id))throw new GameApiError('GameSession ID 格式无效。',0,'INVALID_ID');
 return id;
};
const validCard=c=>object(c)&&int(c.position)&&typeof c.face_up==='boolean'&&
 (c.face_up?int(c.value,0,13):!Object.hasOwn(c,'value'));
const validPlayer=p=>object(p)&&uuid(p.account_id)&&typeof p.username==='string'&&
 int(p.seat_index,0,3)&&Array.isArray(p.hand_cards)&&p.hand_cards.every(validCard)&&
 typeof p.initial_peek_completed==='boolean'&&
 Array.isArray(p.initial_peek_confirmed_positions)&&p.initial_peek_confirmed_positions.length<=2&&
 p.initial_peek_confirmed_positions.every(v=>int(v,0,3));
export const validGameView=g=>object(g)&&g.schema_version===1&&uuid(g.id)&&uuid(g.room_id)&&
 g.state==='Playing'&&gameState.has(g.phase)&&uuid(g.viewer_account_id)&&
 int(g.state_revision)&&date(g.server_time)&&
 Array.isArray(g.players)&&g.players.length>=2&&g.players.length<=4&&
 g.players.every(validPlayer)&&g.players.some(p=>p.account_id===g.viewer_account_id)&&
 object(g.draw_pile)&&int(g.draw_pile.card_count)&&
 object(g.discard_pile)&&int(g.discard_pile.card_count)&&
 (g.discard_pile.top_card_value===null||int(g.discard_pile.top_card_value,0,13))&&
 (g.discard_pile.card_count===0?g.discard_pile.top_card_value===null:g.discard_pile.top_card_value!==null)&&
 (g.phase==='InitialPeek'
  ? date(g.initial_peek_deadline_at)&&g.active_turn===null
  : g.initial_peek_deadline_at===null&&object(g.active_turn)&&
    uuid(g.active_turn.id)&&uuid(g.active_turn.acting_account_id)&&
    int(g.active_turn.turn_number,1)&&date(g.active_turn.started_at)&&
    date(g.active_turn.deadline_at));
const validPrivate=p=>object(p)&&uuid(p.game_session_id)&&uuid(p.account_id)&&
 Array.isArray(p.revealed_cards)&&p.revealed_cards.length<=2&&
 p.revealed_cards.every(c=>object(c)&&int(c.position,0,3)&&int(c.value,0,13))&&
 new Set(p.revealed_cards.map(c=>c.position)).size===p.revealed_cards.length&&
 int(p.remaining_peek_count,0,2)&&date(p.deadline_at)&&date(p.server_time);
const validOutcome=(p,type)=>object(p)&&resultStatus.has(p.status)&&
 typeof p.replayed==='boolean'&&(p.reason===null||p.reason===undefined||typeof p.reason==='string')&&
 (type==='peek'?
   (p.peek_result===null||p.peek_result===undefined||
    (object(p.peek_result)&&int(p.peek_result.position,0,3)&&int(p.peek_result.value,0,13)&&
     int(p.peek_result.remaining_peek_count,0,2)&&date(p.peek_result.deadline_at))):
   (p.complete_result===null||p.complete_result===undefined||
    (object(p.complete_result)&&typeof p.complete_result.all_players_completed==='boolean')));
const reasonMessage=(code,status,write)=>{
 if(Object.hasOwn(errors,code))return errors[code];
 if(status===401)return errors.INVALID_COOKIE;
 if(status===403||status===404)return '游戏不可访问，请验证游戏身份和当前账号。';
 if(status===409||status===422)return '请求与当前游戏状态不符，请刷新 GameView。';
 if(status>=500)return write?'游戏服务暂不可用，命令结果可能未知，请保留原请求编号。':'游戏服务暂不可用，请稍后同步。';
 return '游戏请求未成功，请稍后重试。';
};
export function createGameApi({baseUrl=getAuthApiBaseUrl(),fetchImpl=globalThis.fetch}={}){
 const origin=getAuthApiBaseUrl({CABO_API_BASE_URL:baseUrl});
 async function request(path,method,expected,kind,payload){
  const write=method!=='GET';
  let response;
  try{
   response=await fetchImpl(origin+path,{
    method,credentials:'include',cache:'no-store',
    headers:payload===undefined?{Accept:'application/json'}:
      {Accept:'application/json','Content-Type':'application/json'},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})
   });
  }catch{
   throw new GameApiError(write?'网络中断，命令结果未知，请使用原 request_id 核实。':'网络异常，无法同步 GameView。',0,'NETWORK_ERROR',write);
  }
  if(response.status!==expected){
   let code='HTTP_ERROR';
   try{
    const c=(await response.json())?.code;
    if(typeof c==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(c))code=c;
   }catch{}
   throw new GameApiError(reasonMessage(code,response.status,write),response.status,code,write&&response.status>=500);
  }
  let data;
  try{data=await response.json();}
  catch{throw new GameApiError('游戏响应不可读取，请重新同步游戏状态。',expected,'INVALID_RESPONSE',write);}
  const valid=kind==='game'?validGameView(data):
    kind==='private'?validPrivate(data):
    kind==='peek'?validOutcome(data,'peek'):validOutcome(data,'complete');
  if(!valid)throw new GameApiError('GameView 或 Command 响应结构不兼容，已停止使用该结果。',expected,'INVALID_RESPONSE',write);
  return data;
 }
 return {
  getGame(id){return request('/games/'+checkedId(id),'GET',200,'game');},
  getInitialPeekView(id){return request('/games/'+checkedId(id)+'/initial-peek-view','GET',200,'private');},
  initialPeek(id,requestId,position){
   if(!uuid(requestId)||!int(position,0,3))throw new GameApiError('初始查看请求编号或牌位无效。',0,'INVALID_REQUEST');
   return request('/games/'+checkedId(id)+'/commands/initial-peek','POST',200,'peek',{request_id:requestId,position});
  },
  completeInitialPeek(id,requestId){
   if(!uuid(requestId))throw new GameApiError('结束查看请求编号无效。',0,'INVALID_REQUEST');
   return request('/games/'+checkedId(id)+'/commands/complete-initial-peek','POST',200,'complete',{request_id:requestId});
  }
 };
}
