/** Server-authoritative Game HTTP transport. No UI or secret storage. */
import {getAuthApiBaseUrl} from './auth-api.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const uuid=x=>typeof x==='string'&&UUID.test(x);
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const integer=x=>Number.isInteger(x);
export class GameApiError extends Error {
 constructor(message,status=0,code='GAME_API_ERROR',outcomeUnknown=false){
  super(message);this.name='GameApiError';this.status=status;this.code=code;this.outcomeUnknown=outcomeUnknown;
 }
}
function validGame(v,id){
 return obj(v)&&uuid(v.id)&&v.id.toLowerCase()===id.toLowerCase()&&uuid(v.room_id)&&
  v.state==='Playing'&&['InitialPeek','PlayerTurn'].includes(v.phase)&&uuid(v.viewer_account_id)&&
  integer(v.schema_version)&&v.schema_version===1&&integer(v.state_revision)&&v.state_revision>=0&&
  date(v.server_time)&&Array.isArray(v.players)&&v.players.length>=2&&v.players.length<=4&&
  v.players.some(p=>p.account_id===v.viewer_account_id)&&v.players.every(p=>
   obj(p)&&uuid(p.account_id)&&typeof p.username==='string'&&integer(p.seat_index)&&
   typeof p.initial_peek_completed==='boolean'&&Array.isArray(p.initial_peek_confirmed_positions)&&
   p.initial_peek_confirmed_positions.length<=2&&p.initial_peek_confirmed_positions.every(n=>integer(n)&&n>=0&&n<=3)&&
   Array.isArray(p.hand_cards)&&p.hand_cards.every(c=>obj(c)&&integer(c.position)&&c.position>=0&&
    (c.face_up===false&&!Object.hasOwn(c,'value')||
     c.face_up===true&&integer(c.value)&&c.value>=0&&c.value<=13)))&&
  obj(v.draw_pile)&&integer(v.draw_pile.card_count)&&v.draw_pile.card_count>=0&&
  obj(v.discard_pile)&&integer(v.discard_pile.card_count)&&v.discard_pile.card_count>=0&&
  (v.discard_pile.top_card_value===null||integer(v.discard_pile.top_card_value)&&v.discard_pile.top_card_value>=0&&v.discard_pile.top_card_value<=13)&&
  (v.phase!=='InitialPeek'||date(v.initial_peek_deadline_at))&&
  (v.active_turn===null||(obj(v.active_turn)&&uuid(v.active_turn.id)&&uuid(v.active_turn.acting_account_id)&&
   integer(v.active_turn.turn_number)&&date(v.active_turn.deadline_at)));
}
function validPrivate(v,id){
 return obj(v)&&uuid(v.game_session_id)&&v.game_session_id.toLowerCase()===id.toLowerCase()&&
  uuid(v.account_id)&&integer(v.remaining_peek_count)&&v.remaining_peek_count>=0&&v.remaining_peek_count<=2&&
  date(v.deadline_at)&&date(v.server_time)&&Array.isArray(v.revealed_cards)&&v.revealed_cards.length<=2&&
  v.revealed_cards.every(c=>obj(c)&&integer(c.position)&&c.position>=0&&c.position<=3&&
   integer(c.value)&&c.value>=0&&c.value<=13);
}
function validOutcome(v,kind){
 return obj(v)&&['Accepted','Rejected','NotYetDetermined','IdentityConflict'].includes(v.status)&&
  typeof v.replayed==='boolean'&&(v.reason==null||typeof v.reason==='string')&&
  (kind==='peek'?(v.peek_result===null||(obj(v.peek_result)&&integer(v.peek_result.position)&&
    integer(v.peek_result.value)&&integer(v.peek_result.remaining_peek_count)&&date(v.peek_result.deadline_at))):
   (v.complete_result===null||(obj(v.complete_result)&&typeof v.complete_result.all_players_completed==='boolean')));
}
export function createGameApi({baseUrl=getAuthApiBaseUrl(),fetchImpl=globalThis.fetch}={}){
 const root=getAuthApiBaseUrl({CABO_API_BASE_URL:baseUrl});
 const check=id=>{if(!uuid(id))throw new GameApiError('GameSession ID 无效。',0,'INVALID_ID');return id;};
 async function request(id,suffix,method,kind,payload){
  id=check(id);
  const write=method!=='GET';
  let r;
  try{
   r=await fetchImpl(root+'/games/'+id+suffix,{
    method,credentials:'include',cache:'no-store',
    headers:payload?{'Accept':'application/json','Content-Type':'application/json'}:{'Accept':'application/json'},
    ...(payload?{body:JSON.stringify(payload)}:{})
   });
  }catch{
   throw new GameApiError(write?'请求结果未知，请使用原 request_id 重试。':'无法连接游戏服务。',0,'NETWORK_ERROR',write);
  }
  if(r.status!==200){
   let code='HTTP_ERROR';
   try{const body=await r.json();if(typeof body?.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(body.code))code=body.code;}catch{}
   const message=r.status===401?'会话失效，请重新登录。':r.status===403?'无权访问当前游戏。':
    r.status===404?'游戏或接口不存在。':r.status===409?'游戏状态已变化，请同步权威视图。':
    r.status===422?'请求参数不合法。':r.status>=500?'游戏服务异常，操作结果可能未知。':'游戏请求未成功。';
   throw new GameApiError(message,r.status,code,write&&r.status>=500);
  }
  let data;
  try{data=await r.json();}catch{throw new GameApiError('游戏响应格式异常。',200,'INVALID_RESPONSE',write);}
  const valid=kind==='game'?validGame(data,id):kind==='private'?validPrivate(data,id):validOutcome(data,kind);
  if(!valid)throw new GameApiError('服务器返回的游戏契约不兼容。',200,'INVALID_RESPONSE',write);
  return data;
 }
 return {
  getGame:id=>request(id,'','GET','game'),
  getInitialPeekView:id=>request(id,'/initial-peek-view','GET','private'),
  initialPeek:(id,requestId,position)=>{
   if(!uuid(requestId)||!integer(position)||position<0||position>3)throw new GameApiError('初始查看参数无效。');
   return request(id,'/commands/initial-peek','POST','peek',{request_id:requestId,position});
  },
  completeInitialPeek:(id,requestId)=>{
   if(!uuid(requestId))throw new GameApiError('请求 ID 无效。');
   return request(id,'/commands/complete-initial-peek','POST','complete',{request_id:requestId});
  }
 };
}
