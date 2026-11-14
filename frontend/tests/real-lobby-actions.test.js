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
  async getRoom(room){calls.push(['GET',room]);return new Promise(resolve=>finish=()=>resolve({...lobby,members:[hostMember,{...guestMember,is_ready:current}]});}
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
