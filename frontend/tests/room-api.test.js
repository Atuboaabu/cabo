import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomApi, RoomApiError } from '../src/room-api.js';

const roomId='123e4567-e89b-12d3-a456-426614174000';
const accountId='123e4567-e89b-12d3-a456-426614174001';
const room={id:roomId,room_code:'ABC234',host_account_id:accountId,state:'Lobby'};
const ready={account_id:accountId,is_ready:true};
const view={...room,members:[{account_id:accountId,username:'Alice',seat_index:0,is_ready:false,is_host:true}]};
const response=(status,value)=>({status,async json(){if(value===undefined)throw Error('No JSON');return value;}});
const inspect=(status,value)=>{let last;return {
  api:createRoomApi({baseUrl:'http://localhost:8000',fetchImpl:async(url,init)=>{last={url,init};return response(status,value);}}),
  call:()=>last
};};

test('createRoom POST /rooms: 201, cookies, no JSON body',async()=>{
 const {api,call}=inspect(201,room);
 assert.deepEqual(await api.createRoom(),room);
 assert.equal(call().url,'http://localhost:8000/rooms');
 assert.equal(call().init.method,'POST');
 assert.equal(call().init.credentials,'include');
 assert.equal(call().init.cache,'no-store');
 assert.equal(call().init.body,undefined);
 assert.equal(call().init.headers['Content-Type'],undefined);
});
test('joinRoom POST /rooms/join: exact room_code JSON',async()=>{
 const {api,call}=inspect(200,room);
 assert.deepEqual(await api.joinRoom('ABC234'),room);
 assert.equal(call().url,'http://localhost:8000/rooms/join');
 assert.equal(call().init.method,'POST');
 assert.equal(call().init.credentials,'include');
 assert.deepEqual(JSON.parse(call().init.body),{room_code:'ABC234'});
});
test('getRoom GET UUID: 200 RoomView without body',async()=>{
 const {api,call}=inspect(200,view);
 assert.deepEqual(await api.getRoom(roomId),view);
 assert.equal(call().url,'http://localhost:8000/rooms/'+roomId);
 assert.equal(call().init.method,'GET');
 assert.equal(call().init.credentials,'include');
 assert.equal(call().init.body,undefined);
});
test('setReady PUT UUID/ready: JSON ready true and false',async()=>{
 for(const value of [true,false]){
  const {api,call}=inspect(200,{account_id:accountId,is_ready:value});
  assert.deepEqual(await api.setReady(roomId,value),{account_id:accountId,is_ready:value});
  assert.equal(call().url,'http://localhost:8000/rooms/'+roomId+'/ready');
  assert.equal(call().init.method,'PUT');
  assert.equal(call().init.credentials,'include');
  assert.deepEqual(JSON.parse(call().init.body),{ready:value});
 }
});
test('leave/kick/disband POST 204 never parse empty response',async()=>{
 const cases=[
  ['leaveRoom',[roomId],'/rooms/'+roomId+'/leave'],
  ['kickMember',[roomId,accountId],'/rooms/'+roomId+'/members/'+accountId+'/kick'],
  ['disbandRoom',[roomId],'/rooms/'+roomId+'/disband']
 ];
 for(const [method,args,path] of cases){
  const {api,call}=inspect(204,undefined);
  assert.equal(await api[method](...args),null);
  assert.equal(call().url,'http://localhost:8000'+path);
  assert.equal(call().init.method,'POST');
  assert.equal(call().init.body,undefined);
  assert.equal(call().init.credentials,'include');
 }
});
test('Room errors retain sanitized backend status and business code',async()=>{
 const cases=[
  [401,'INVALID_COOKIE'],[403,'REQUESTER_WRONG'],[404,'ROOM_NOT_EXIST'],
  [404,'TARGET_MEMBER_NOT_EXIST'],[409,'ROOM_IS_FULL'],
  [409,'ACCOUNT_ALREADY_INROOM'],[409,'ROOM_STATE_NOT_LOBBY'],[422,'HTTP_ERROR']
 ];
 for(const [status,code] of cases){
  const {api}=inspect(status,{code,detail:'session_token=sensitive'});
  await assert.rejects(api.joinRoom('ABC234'),err=>
    err instanceof RoomApiError&&err.status===status&&err.code===code&&
    !err.message.includes('session_token')&&!err.outcomeUnknown);
 }
});
test('unexpected HTTP success is rejected, including wrong 200 vs 201/204',async()=>{
 await assert.rejects(inspect(200,room).api.createRoom(),err=>err.status===200);
 await assert.rejects(inspect(200,room).api.leaveRoom(roomId),err=>err.status===200);
 await assert.rejects(inspect(204,undefined).api.getRoom(roomId),err=>err.status===204);
});
test('write network/5xx outcomes stay unknown; GET failure never claims success',async()=>{
 const offline=createRoomApi({fetchImpl:async()=>{throw Error('Cookie: super-secret');}});
 await assert.rejects(offline.createRoom(),err=>err.code==='NETWORK_ERROR'&&err.outcomeUnknown&&!err.message.includes('super-secret'));
 await assert.rejects(offline.getRoom(roomId),err=>err.code==='NETWORK_ERROR'&&!err.outcomeUnknown);
 const down=inspect(503,{code:'ROOM_CODE_ALLOCATION_FAILED'}).api;
 await assert.rejects(down.createRoom(),err=>err.status===503&&err.outcomeUnknown);
 await assert.rejects(down.getRoom(roomId),err=>err.status===503&&!err.outcomeUnknown);
});
test('unexpected JSON schema fails with INVALID_RESPONSE (writes unknown)',async()=>{
 await assert.rejects(inspect(201,{id:'not a Room'}).api.createRoom(),err=>err.code==='INVALID_RESPONSE'&&err.outcomeUnknown);
 await assert.rejects(inspect(200,{members:[]}).api.getRoom(roomId),err=>err.code==='INVALID_RESPONSE'&&!err.outcomeUnknown);
});
test('path IDs reject malformed values before making a request',async()=>{
 let called=0;
 const api=createRoomApi({fetchImpl:async()=>{called++;return response(204);}});
 assert.throws(()=>api.leaveRoom('../../auth/logout'),err=>err.code==='INVALID_ID');
 assert.throws(()=>api.kickMember(roomId,'not-a-uuid'),err=>err.code==='INVALID_ID');
 assert.equal(called,0);
});
