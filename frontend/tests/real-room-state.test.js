import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealRoomState} from '../src/real-room-state.js';
import {readFileSync} from 'node:fs';

const id='123e4567-e89b-12d3-a456-426614174000';
const account='123e4567-e89b-12d3-a456-426614174001';
const view={id,room_code:'ABC234',state:'Lobby',host_account_id:account,members:[
 {account_id:'123e4567-e89b-12d3-a456-426614174002',username:'Bob',seat_index:2,is_ready:true,is_host:false},
 {account_id:account,username:'Alice',seat_index:0,is_ready:false,is_host:true}
]};
const room={id,room_code:'ABC234',host_account_id:account,state:'Lobby'};
const storage=()=>{const entries=new Map();return {
 entries,getItem(key){return entries.get(key)??null;},
 setItem(key,value){entries.set(key,value);},removeItem(key){entries.delete(key);}
}};
const failure=(status,code='HTTP_ERROR',unknown=false)=>Object.assign(new Error('房间请求未完成'),{status,code,outcomeUnknown:unknown});

test('Create 201 uses server Room ID then GET authoritative RoomView',async()=>{
 const calls=[],store=storage();
 const api={
  async createRoom(){calls.push(['create']);return room;},
  async getRoom(value){calls.push(['get',value]);return view;}
 };
 const rooms=createRealRoomState({api,storage:store});
 assert.equal(await rooms.createRoom(),true);
 assert.deepEqual(calls,[['create'],['get',id]]);
 assert.equal(rooms.state.roomId,id);
 assert.equal(rooms.state.view,view);
 assert.equal(store.getItem('cabo.lastRealRoomId'),id);
 assert.equal(rooms.state.pending,null);
});
test('Join normalizes lowercase six-digit code, preserves input on failure',async()=>{
 const calls=[],api={
  async joinRoom(code){calls.push(code);if(code==='ABC234')return room;throw failure(409,'ROOM_IS_FULL');},
  async getRoom(){return view;}
 };
 const rooms=createRealRoomState({api,storage:storage()});
 rooms.setJoinCode('abc234');
 assert.equal(await rooms.joinRoom(),true);
 assert.deepEqual(calls,['ABC234']);
 assert.equal(rooms.state.view,view);
 const other=createRealRoomState({api,storage:storage()});
 other.setJoinCode('def234');
 assert.equal(await other.joinRoom(),false);
 assert.equal(other.state.joinCode,'DEF234');
 assert.equal(other.state.view,null);
 assert.equal(other.state.roomId,null);
 assert.match(other.state.error,/房间请求未完成/);
});
test('Malformed room code cannot send an HTTP request',async()=>{
 let calls=0;
 const rooms=createRealRoomState({api:{joinRoom:async()=>{calls++;}},storage:storage()});
 rooms.setJoinCode('abc');
 assert.equal(await rooms.joinRoom(),false);
 assert.equal(calls,0);
 assert.match(rooms.state.error,/六位房间码/);
});
test('An unverified stored Room ID does not imply Room membership',async()=>{
 const store=storage();store.setItem('cabo.lastRealRoomId',id);
 let finish;
 const pending=new Promise(resolve=>finish=resolve);
 const rooms=createRealRoomState({api:{getRoom:async()=>pending},storage:store});
 const restore=rooms.restore();
 assert.equal(rooms.state.view,null);
 assert.equal(rooms.state.pending,'read');
 finish(view);await restore;
 assert.equal(rooms.state.view,view);
});
test('403 / 404 revoke navigation and visible Room View',async()=>{
 for(const status of [403,404]){
  const store=storage();store.setItem('cabo.lastRealRoomId',id);
  const rooms=createRealRoomState({api:{getRoom:async()=>{throw failure(status)}},storage:store});
  assert.equal(await rooms.restore(),false);
  assert.equal(rooms.state.roomId,null);
  assert.equal(rooms.state.view,null);
  assert.equal(store.getItem('cabo.lastRealRoomId'),null);
  assert.match(rooms.state.error,/房间请求未完成/);
 }
});
test('GET network error retains Room locator and supports explicit recheck',async()=>{
 const store=storage();store.setItem('cabo.lastRealRoomId',id);
 let fails=true,calls=0;
 const rooms=createRealRoomState({api:{getRoom:async()=>{calls++;if(fails)throw failure(503);return view;}},storage:store});
 assert.equal(await rooms.restore(),false);
 assert.equal(rooms.state.roomId,id);
 assert.equal(store.getItem('cabo.lastRealRoomId'),id);
 assert.equal(rooms.state.view,null);
 fails=false;
 assert.equal(await rooms.refresh(),true);
 assert.equal(rooms.state.view,view);
 assert.equal(calls,2);
});
test('Create/Join uncertain writes are never automatically retried or fabricated',async()=>{
 for(const op of ['create','join']){
  let writes=0,reads=0;
  const api={
   async createRoom(){writes++;throw failure(0,'NETWORK_ERROR',true);},
   async joinRoom(){writes++;throw failure(503,'HTTP_ERROR',true);},
   async getRoom(){reads++;return view;}
  };
  const rooms=createRealRoomState({api,storage:storage()});
  rooms.setJoinCode('ABC234');
  assert.equal(await (op==='create'?rooms.createRoom():rooms.joinRoom()),false);
  assert.equal(rooms.state.outcomeUnknown,true);
  assert.equal(rooms.state.roomId,null);
  assert.equal(rooms.state.view,null);
  assert.equal(writes,1);
  assert.equal(reads,0);
  assert.equal(await (op==='create'?rooms.createRoom():rooms.joinRoom()),false);
  assert.equal(writes,1,'uncertain write must not repeat');
 }
});
test('401 triggers auth revalidation rather than showing an unverified Room',async()=>{
 const store=storage();store.setItem('cabo.lastRealRoomId',id);
 let checked=0;
 const rooms=createRealRoomState({
  api:{getRoom:async()=>{throw failure(401,'INVALID_COOKIE');}},
  storage:store,onUnauthorized:()=>{checked++;}
 });
 assert.equal(await rooms.restore(),false);
 await Promise.resolve();await Promise.resolve();
 assert.equal(checked,1);
 assert.equal(rooms.state.view,null);
});
test('Reset clears only the Room locator, and Mock gateway remains independent',async()=>{
 const store=storage();store.setItem('cabo.lastRealRoomId',id);
 const rooms=createRealRoomState({api:{getRoom:async()=>view},storage:store});
 await rooms.restore();
 rooms.reset();
 assert.equal(store.getItem('cabo.lastRealRoomId'),null);
 assert.equal(rooms.state.roomId,null);
 assert.equal(rooms.state.view,null);
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/member\.account_id===realAccount\.id/);
 assert.match(app,/\[\.\.\.r\.members\]\.sort\(\(a,b\)=>a\.seat_index-b\.seat_index\)/);
 assert.match(app,/realRooms\.createRoom\(\)/);
 assert.match(app,/realRooms\.joinRoom\(\)/);
 assert.match(app,/realRooms\.refresh\(\)/);
 assert.match(app,/realRooms\.restore\(\)/);
 assert.match(app,/进入本地 Mock 演示/);
 assert.doesNotMatch(app,/gateway\.send\('createRoom'\)/);
});

test('in-flight Room responses after logout cannot repopulate storage',async()=>{
 const store=storage();
 let finish;
 const pending=new Promise(resolve=>finish=resolve);
 const rooms=createRealRoomState({
  api:{createRoom:async()=>pending,getRoom:async()=>view},storage:store
 });
 const started=rooms.createRoom();
 rooms.reset();
 finish(room);
 await started;
 assert.equal(rooms.state.roomId,null);
 assert.equal(rooms.state.view,null);
 assert.equal(store.getItem('cabo.lastRealRoomId'),null);
});
