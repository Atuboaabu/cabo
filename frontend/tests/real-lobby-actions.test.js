import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealRoomState} from '../src/real-room-state.js';

const id='123e4567-e89b-12d3-a456-426614174000';
const host='123e4567-e89b-12d3-a456-426614174001';
const guest='123e4567-e89b-12d3-a456-426614174002';
const hostMember={account_id:host,username:'Alice',seat_index:0,is_ready:false,is_host:true};
const guestMember={account_id:guest,username:'Bob',seat_index:2,is_ready:false,is_host:false};
const lobby={id,room_code:'ABC234',state:'Lobby',host_account_id:host,members:[hostMember,guestMember]};
const store=()=>{const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const fail=(status,unknown=false)=>Object.assign(new Error('后端拒绝或请求不确定'),{status,outcomeUnknown:unknown,code:'HTTP_ERROR'});
function setup({api={},identity=guest,view=lobby,storage=store(),onUnauthorized=()=>{}}={}){
 const rooms=createRealRoomState({api,storage,getAccountId:()=>identity,onUnauthorized});
 rooms.state.roomId=id;rooms.state.view=view;storage.setItem('cabo.lastRealRoomId',id);
 return {rooms,storage};
}
test('non-Host Ready / Unready writes boolean and waits for authoritative GET',async()=>{
 const calls=[];let current=false,finish;
 const {rooms}=setup({api:{
  async setReady(room,ready){calls.push(['PUT',room,ready]);current=ready;return {account_id:guest,is_ready:ready};},
  async getRoom(room){calls.push(['GET',room]);return new Promise(resolve=>{finish=()=>resolve({...lobby,members:[hostMember,{...guestMember,is_ready:current}]});});}
 }});
 const first=rooms.setReady(true);
 await Promise.resolve();await Promise.resolve();
 assert.deepEqual(calls,[['PUT',id,true],['GET',id]]);
 assert.equal(rooms.state.view.members[1].is_ready,false,'no optimistic ready');
 assert.equal(rooms.state.pending,'read');
 assert.equal(rooms.allowedMutation('ready'),false,'in-flight write/read blocks duplicates');
 finish();assert.equal(await first,true);
 assert.equal(rooms.state.view.members[1].is_ready,true);
 const second=rooms.setReady(false);
 await Promise.resolve();await Promise.resolve();
 assert.deepEqual(calls.slice(-2),[['PUT',id,false],['GET',id]]);
 finish();assert.equal(await second,true);
 assert.equal(rooms.state.view.members[1].is_ready,false);
});
test('only a non-Host can Ready; a non-Host cannot Kick/Disband',async()=>{
 let writes=0;const api={setReady:async()=>{writes++;},kickMember:async()=>{writes++;},disbandRoom:async()=>{writes++;}};
 const owner=setup({api,identity:host}).rooms;
 assert.equal(owner.allowedMutation('ready'),false);
 assert.equal(await owner.setReady(true),false);
 const visitor=setup({api}).rooms;
 assert.equal(await visitor.kickMember(host),false);
 assert.equal(await visitor.disbandRoom(),false);
 assert.equal(writes,0);
});
test('Leave 204 clears room navigation for guest and Host without touching auth',async()=>{
 for(const identity of [host,guest]){
  const calls=[];const {rooms,storage}=setup({identity,api:{async leaveRoom(room){calls.push(room);return null;}}});
  assert.equal(await rooms.leaveRoom(),true);
  assert.deepEqual(calls,[id]);
  assert.equal(rooms.state.roomId,null);
  assert.equal(rooms.state.view,null);
  assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
 }
});
test('Host Kick targets only existing non-Host member and GETs server list',async()=>{
 const calls=[];
 const {rooms}=setup({identity:host,api:{
  async kickMember(room,account){calls.push(['kick',room,account]);return null;},
  async getRoom(room){calls.push(['get',room]);return {...lobby,members:[hostMember]};}
 }});
 assert.equal(await rooms.kickMember(host),false);
 assert.equal(await rooms.kickMember('123e4567-e89b-12d3-a456-426614174999'),false);
 assert.equal(await rooms.kickMember(guest),true);
 assert.deepEqual(calls,[['kick',id,guest],['get',id]]);
 assert.deepEqual(rooms.state.view.members,[hostMember]);
});
test('Host Disband 204 clears state, guest cannot disband',async()=>{
 let writes=0;const api={async disbandRoom(room){writes++;assert.equal(room,id);return null;}};
 assert.equal(await setup({api}).rooms.disbandRoom(),false);
 const {rooms,storage}=setup({api,identity:host});
 assert.equal(await rooms.disbandRoom(),true);
 assert.equal(writes,1);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
 assert.equal(rooms.state.view,null);
});
test('Ready/Kick acknowledged, subsequent GET failed: do not claim write failed or repeat',async()=>{
 for(const action of ['ready','kick']){
  let writes=0,reads=0;
  const {rooms}=setup({identity:action==='ready'?guest:host,api:{
   async setReady(){writes++;return {account_id:guest,is_ready:true};},
   async kickMember(){writes++;return null;},
   async getRoom(){reads++;throw fail(503);}
  }});
  assert.equal(await (action==='ready'?rooms.setReady(true):rooms.kickMember(guest)),false);
  assert.equal(writes,1);assert.equal(reads,1);
  assert.match(rooms.state.error,/操作可能已完成，但暂时无法确认最新房间状态，请刷新房间/);
  assert.equal(rooms.state.stale,true);
  assert.equal(rooms.state.view.members.length,2,'old view not optimistically changed');
  assert.equal(await (action==='ready'?rooms.setReady(true):rooms.kickMember(guest)),false);
  assert.equal(writes,1,'no repeated write while stale');
 }
});
test('401/403/404/409 errors do not fabricate success, 404 kick prompts refresh',async()=>{
 for(const status of [401,403,404,409]){
  let unauthorized=0;
  const {rooms}=setup({identity:host,onUnauthorized:()=>{unauthorized++;},api:{
   async kickMember(){throw fail(status);}
  }});
  assert.equal(await rooms.kickMember(guest),false);
  assert.equal(rooms.state.pending,null);
  assert.notEqual(rooms.state.error,'');
  assert.equal(rooms.state.view===null,status===401);
  if(status===404)assert.match(rooms.state.error,/刷新房间/);
  await Promise.resolve();await Promise.resolve();
  assert.equal(unauthorized,status===401?1:0);
 }
});
test('network/5xx writes are indeterminate: keep locator and disable writes until GET',async()=>{
 for(const error of [fail(0,true),fail(503,true)]){
  let writes=0;
  const {rooms,storage}=setup({api:{
   async setReady(){writes++;throw error;},
   async getRoom(){return lobby;}
  }});
  assert.equal(await rooms.setReady(true),false);
  assert.equal(rooms.state.outcomeUnknown,true);
  assert.equal(rooms.state.stale,true);
  assert.equal(storage.getItem('cabo.lastRealRoomId'),id);
  assert.equal(await rooms.setReady(true),false);
  assert.equal(writes,1);
  assert.equal(await rooms.refresh(),true);
  assert.equal(rooms.state.outcomeUnknown,false);
 }
});
test('non-Lobby states and missing membership cannot mutate',async()=>{
 let called=0;const api={leaveRoom:async()=>{called++;}};
 for(const view of [{...lobby,state:'Playing'},{...lobby,members:[hostMember]}]){
  const {rooms}=setup({view,api});
  assert.equal(await rooms.leaveRoom(),false);
 }
 assert.equal(called,0);
});
test('Reset/logout invalidates in-flight mutation and subsequent read response',async()=>{
 let finish;
 const inFlight=new Promise(resolve=>finish=resolve);
 let reads=0;const {rooms,storage}=setup({identity:host,api:{
  kickMember:async()=>inFlight,
  getRoom:async()=>{reads++;return lobby;}
 }});
 const pending=rooms.kickMember(guest);
 rooms.reset();
 finish(null);
 assert.equal(await pending,false);
 assert.equal(reads,0);
 assert.equal(rooms.state.view,null);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
});

test('acknowledged Ready/Kick followed by 403/404 clears Room and never suggests an impossible refresh',async()=>{
 for(const status of [403,404]){
  for(const action of ['ready','kick']){
   const {rooms,storage}=setup({
    identity:action==='kick'?host:guest,
    api:{
     async setReady(){return {account_id:guest,is_ready:true};},
     async kickMember(){return null;},
     async getRoom(){throw fail(status);}
    }
   });
   const success=await (action==='ready'?rooms.setReady(true):rooms.kickMember(guest));
   assert.equal(success,false);
   assert.equal(rooms.state.roomId,null);
   assert.equal(rooms.state.view,null);
   assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
   assert.match(rooms.state.error,/房间已无法访问/);
   assert.doesNotMatch(rooms.state.error,/请刷新房间/);
  }
 }
});

test('Host Start requires 2–4 Lobby members and every non-Host Ready',async()=>{
 const api={startGame:async()=>{throw Error('unexpected Start request');}};
 const hostReady={...lobby,members:[hostMember,{...guestMember,is_ready:true}]};
 const valid=setup({api,identity:host,view:hostReady}).rooms;
 assert.equal(valid.allowedMutation('start'),true);
 assert.equal(setup({api,identity:guest,view:hostReady}).rooms.allowedMutation('start'),false);
 assert.equal(setup({api,identity:host,view:lobby}).rooms.allowedMutation('start'),false);
 assert.equal(setup({api,identity:host,view:{...lobby,members:[hostMember]}}).rooms.allowedMutation('start'),false);
 const another={...guestMember,account_id:'123e4567-e89b-12d3-a456-426614174003',seat_index:1,is_ready:false};
 assert.equal(setup({api,identity:host,view:{...lobby,members:[hostMember,{...guestMember,is_ready:true},another]}}).rooms.allowedMutation('start'),false);
 const tooMany={...lobby,members:[hostMember,...[2,3,4,5].map((x)=>({...guestMember,account_id:'123e4567-e89b-12d3-a456-42661417400'+x,seat_index:x,is_ready:true}))]};
 assert.equal(setup({api,identity:host,view:tooMany}).rooms.allowedMutation('start'),false);
 assert.equal(setup({api,identity:host,view:{...hostReady,state:'Playing'}}).rooms.allowedMutation('start'),false);
});
test('Start 201 waits for authoritative GET Playing, prevents duplicate writes, preserves Room locator',async()=>{
 const readyView={...lobby,members:[hostMember,{...guestMember,is_ready:true}]};
 let writes=0,finish;
 const storage=store();
 const {rooms}=setup({identity:host,view:readyView,storage,api:{
  async startGame(room){writes++;assert.equal(room,id);return {id:'123e4567-e89b-12d3-a456-426614174006',room_id:id,state:'InitialReveal',started_at:'2026-11-17T09:00:00Z'};},
  async getRoom(room){assert.equal(room,id);return new Promise(resolve=>finish=()=>resolve({...readyView,state:'Playing'}));}
 }});
 const pending=rooms.startGame();
 await Promise.resolve();await Promise.resolve();
 assert.equal(writes,1);
 assert.equal(rooms.state.view.state,'Lobby','no optimistic Playing before GET');
 assert.equal(rooms.state.pending,'read');
 assert.equal(await rooms.startGame(),false,'cannot send duplicate Start');
 assert.equal(writes,1);
 finish();
 assert.equal(await pending,true);
 assert.equal(rooms.state.view.state,'Playing');
 assert.equal(rooms.state.roomId,id);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),id);
 assert.equal(rooms.allowedMutation('start'),false);
 assert.equal(await rooms.startGame(),false);
});
test('Start unknown result retains Lobby locator and blocks unsafe repeated request',async()=>{
 let writes=0;
 const view={...lobby,members:[hostMember,{...guestMember,is_ready:true}]};
 const {rooms,storage}=setup({identity:host,view,api:{
  async startGame(){writes++;throw fail(0,true);}
 }});
 assert.equal(await rooms.startGame(),false);
 assert.equal(writes,1);
 assert.equal(rooms.state.roomId,id);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),id);
 assert.equal(rooms.state.outcomeUnknown,true);
 assert.equal(await rooms.startGame(),false);
 assert.equal(writes,1);
});

test('Start HTTP 409 does not invent Playing or retry the write; refresh remains authoritative',async()=>{
 let writes=0,reads=0;
 const ready={...lobby,members:[hostMember,{...guestMember,is_ready:true}]};
 const {rooms,storage}=setup({identity:host,view:ready,api:{
  async startGame(){writes++;throw fail(409);},
  async getRoom(){reads++;return {...ready,state:'Playing'};}
 }});
 assert.equal(await rooms.startGame(),false);
 assert.equal(writes,1);
 assert.equal(rooms.state.view.state,'Lobby');
 assert.equal(rooms.state.stale,true);
 assert.equal(rooms.allowedMutation('start'),false);
 assert.equal(await rooms.startGame(),false);
 assert.equal(writes,1);
 assert.equal(await rooms.refresh(),true);
 assert.equal(reads,1);
 assert.equal(rooms.state.view.state,'Playing');
 assert.equal(rooms.state.roomId,id);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),id);
});

test('Start POST 404 does not show Kick member refresh advice or clear Room locator',async()=>{
 const ready={...lobby,members:[hostMember,{...guestMember,is_ready:true}]};
 for(const error of [
  Object.assign(new Error('开始游戏接口不可用或房间不存在，请检查服务地址和房间状态。'),{status:404,code:'HTTP_ERROR'}),
  Object.assign(new Error('房间不存在或已不可访问。'),{status:404,code:'ROOM_NOT_EXIST'})
 ]){
  let writes=0,reads=0;
  const {rooms,storage}=setup({identity:host,view:ready,api:{
   async startGame(){writes++;throw error;},
   async getRoom(){reads++;return ready;}
  }});
  assert.equal(await rooms.startGame(),false);
  assert.equal(writes,1);
  assert.equal(reads,0,'POST failure must not be mistaken for post-201 GET failure');
  assert.equal(rooms.state.roomId,id);
  assert.equal(storage.getItem('cabo.lastRealRoomId'),id);
  assert.equal(rooms.state.stale,true);
  assert.match(rooms.state.error,new RegExp(error.message.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(rooms.state.error,/目标成员|最新成员|操作可能已完成/);
  assert.equal(await rooms.startGame(),false,'stale Room cannot repeat Start');
  assert.equal(writes,1);
 }
});
test('Kick POST 404 keeps member-specific refresh hint while Ready does not',async()=>{
 const {rooms:hostRooms}=setup({identity:host,api:{
  async kickMember(){throw fail(404);}
 }});
 assert.equal(await hostRooms.kickMember(guest),false);
 assert.match(hostRooms.state.error,/请刷新房间查看最新成员/);
 const {rooms:guestRooms}=setup({identity:guest,api:{
  async setReady(){throw fail(404);}
 }});
 assert.equal(await guestRooms.setReady(true),false);
 assert.doesNotMatch(guestRooms.state.error,/最新成员/);
});
test('Start 201 followed by transient GET failure explicitly warns Start may already have succeeded',async()=>{
 const ready={...lobby,members:[hostMember,{...guestMember,is_ready:true}]};
 for(const getError of [fail(503),fail(0)]){
  let starts=0,reads=0;
  const {rooms,storage}=setup({identity:host,view:ready,api:{
   async startGame(){starts++;return {id:'123e4567-e89b-12d3-a456-426614174006',room_id:id,state:'InitialReveal',started_at:'2026-11-17T09:00:00Z'};},
   async getRoom(){reads++;throw getError;}
  }});
  assert.equal(await rooms.startGame(),false);
  assert.equal(starts,1);assert.equal(reads,1);
  assert.match(rooms.state.error,/开始游戏请求已返回 201/);
  assert.match(rooms.state.error,/游戏可能已成功开始/);
  assert.match(rooms.state.error,/勿重复点击「开始游戏」/);
  assert.doesNotMatch(rooms.state.error,/目标成员|最新成员/);
  assert.equal(rooms.state.roomId,id);
  assert.equal(rooms.state.view.state,'Lobby','never fabricate Playing');
  assert.equal(storage.getItem('cabo.lastRealRoomId'),id);
  assert.equal(rooms.state.stale,true);
  assert.equal(await rooms.startGame(),false);
  assert.equal(starts,1);
 }
});
test('Start 201 then GET 404 is an access check, not a POST endpoint or member error',async()=>{
 const ready={...lobby,members:[hostMember,{...guestMember,is_ready:true}]};
 let starts=0;
 const {rooms,storage}=setup({identity:host,view:ready,api:{
  async startGame(){starts++;return {id:'123e4567-e89b-12d3-a456-426614174006',room_id:id,state:'InitialReveal',started_at:'2026-11-17T09:00:00Z'};},
  async getRoom(){throw fail(404);}
 }});
 assert.equal(await rooms.startGame(),false);
 assert.equal(starts,1);
 assert.equal(rooms.state.roomId,null);
 assert.equal(rooms.state.view,null);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
 assert.match(rooms.state.error,/开始游戏请求已返回 201/);
 assert.match(rooms.state.error,/当前房间已无法访问/);
 assert.doesNotMatch(rooms.state.error,/目标成员|最新成员|接口不可用|刷新房间/);
});
