/**
 * Phase 6-6-A: real Room HTTP client only. No Room UI, MockGateway, or Session token.
 * Cookie credentials are managed by the browser (HttpOnly).
 */
import { getAuthApiBaseUrl } from './auth-api.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUSINESS_ERRORS = {
  INVALID_COOKIE: '登录会话已失效，请重新登录。',
  ACCOUNT_ALREADY_INROOM: '当前账号已加入其他房间。',
  ROOM_NOT_EXIST: '房间不存在或已不可访问。',
  TARGET_MEMBER_NOT_EXIST: '目标成员不存在。',
  ROOM_IS_FULL: '房间已满。',
  ROOM_STATE_NOT_LOBBY: '房间不在等待状态，无法执行此操作。',
  REQUESTER_WRONG: '当前账号无权执行此操作。',
  INVALID_REQUEST: '当前请求不被允许。',
  ROOM_CODE_ALLOCATION_FAILED: '暂时无法创建房间，请稍后重试。'
};

export class RoomApiError extends Error {
  constructor(message, status=0, code='ROOM_API_ERROR', outcomeUnknown=false) {
    super(message);
    this.name = 'RoomApiError';
    this.status = status;
    this.code = code;
    // A write may have committed even if its response was lost or failed.
    this.outcomeUnknown = outcomeUnknown;
  }
}
function roomId(value) {
  if(typeof value!=='string'||!UUID.test(value)) {
    throw new RoomApiError('房间或账号 ID 格式无效。',0,'INVALID_ID');
  }
  return value;
}
function errorMessage(status, code, isWrite) {
  if(status>=500) return isWrite
    ? '房间服务暂不可用，操作结果可能未知，请先查询房间状态。'
    : '房间服务暂不可用，请稍后重试。';
  if(status===401) return BUSINESS_ERRORS.INVALID_COOKIE;
  if(status===403) return '没有权限执行此操作，或请求来源不被允许。';
  if(status===404) return BUSINESS_ERRORS[code]||'房间或目标成员不存在。';
  if(status===409) return BUSINESS_ERRORS[code]||'房间状态冲突，请刷新房间信息。';
  if(status===422) return '请求参数无效，请检查房间码或操作数据。';
  if(status===429) return '请求过于频繁，请稍后再试。';
  return '房间请求未成功，请稍后重试。';
}
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isString=value=>typeof value==='string';
const isUUID=value=>isString(value)&&UUID.test(value);
function validResponse(data,kind) {
  if(!isObject(data))return false;
  if(kind==='ready')return isUUID(data.account_id)&&typeof data.is_ready==='boolean';
  if(!isUUID(data.id)||!isString(data.room_code)||!isUUID(data.host_account_id)||!isString(data.state))return false;
  if(kind==='room')return true;
  return Array.isArray(data.members)&&data.members.every(member=>
    isObject(member)&&isUUID(member.account_id)&&isString(member.username)&&
    Number.isInteger(member.seat_index)&&typeof member.is_ready==='boolean'&&
    typeof member.is_host==='boolean');
}

export function createRoomApi({baseUrl=getAuthApiBaseUrl(),fetchImpl=globalThis.fetch}={}) {
  const root=getAuthApiBaseUrl({CABO_API_BASE_URL:baseUrl});
  if(typeof fetchImpl!=='function')throw new TypeError('浏览器不支持网络请求');
  async function request(path,method,successStatus,kind,payload) {
    const isWrite=method!=='GET';
    let response;
    try {
      response=await fetchImpl(root+path,{
        method,
        headers:payload===undefined
          ? {Accept:'application/json'}
          : {Accept:'application/json','Content-Type':'application/json'},
        ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
        credentials:'include',
        cache:'no-store'
      });
    }catch {
      throw new RoomApiError(
        isWrite?'网络中断，操作结果未知，请先查询房间状态。':'网络异常，暂时无法获取房间信息。',
        0,'NETWORK_ERROR',isWrite
      );
    }
    if(response.status!==successStatus) {
      let code='HTTP_ERROR';
      try {
        const body=await response.json();
        if(typeof body?.code==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(body.code))code=body.code;
      }catch{/* Do not expose untrusted backend details. */}
      throw new RoomApiError(errorMessage(response.status,code,isWrite),response.status,code,isWrite&&response.status>=500);
    }
    if(successStatus===204)return null; // Never parse a 204 body.
    let data;
    try{data=await response.json();}
    catch {
      throw new RoomApiError('房间响应不可读取，请重新获取权威房间状态。',successStatus,'INVALID_RESPONSE',isWrite);
    }
    if(!validResponse(data,kind)){
      throw new RoomApiError('房间响应格式异常，请重新获取权威房间状态。',successStatus,'INVALID_RESPONSE',isWrite);
    }
    return data;
  }
  return {
    createRoom() {
      return request('/rooms','POST',201,'room');
    },
    joinRoom(roomCode) {
      return request('/rooms/join','POST',200,'room',{room_code:roomCode});
    },
    getRoom(id) {
      return request('/rooms/'+roomId(id),'GET',200,'view');
    },
    setReady(id,ready) {
      return request('/rooms/'+roomId(id)+'/ready','PUT',200,'ready',{ready});
    },
    leaveRoom(id) {
      return request('/rooms/'+roomId(id)+'/leave','POST',204);
    },
    kickMember(id,accountId) {
      return request('/rooms/'+roomId(id)+'/members/'+roomId(accountId)+'/kick','POST',204);
    },
    disbandRoom(id) {
      return request('/rooms/'+roomId(id)+'/disband','POST',204);
    }
  };
}
