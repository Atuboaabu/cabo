import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoomSocket,roomWebSocketUrl} from '../src/room-ws.js';
import {createRealRoomState} from '../src/real-room-state.js';

const a='123e4567-e89b-12d3-a456-426614174000';
const b='123e4567-e89b-12d3-a456-426614174002';
const member='123e4567-e89b-12d3-a456-426614174001';
const view=id=>({id,room_code:'ABC234',state:'Lobby',host_account_id:member,
 members:[{account_id:member,username:'Alice',seat_index:0,is_ready:false,is_host:true}]});
const store=()=>{const values=new Map();return{
 setItem:(k,v)=>values.set(k,v),getItem:k=>values.get(k)||null,removeItem:k=>values.delete(k)
}};
class FakeWebSocket{
 static sockets=[];
 constructor(url){this.url=url;this.closed=false;FakeWebSocket.sockets.push(this);}
 close(){this.closed=true;}
 sendMessage(data){this.onmessage?.({data:JSON.stringify(data)});}
 serverClose(code=1008){this.closed=true;this.onclose?.({code});}
}
const setup=({api,storage=store(),onChange=()=>{}}={})=>{
 FakeWebSocket.sockets=[];
 const rooms=createRealRoomState({
  api,storage,onChange,getAccountId:()=>member,
  createSocket:opts=>createRoomSocket({...opts,WebSocketImpl:FakeWebSocket,baseUrl:'http://localhost:8000'})
 });
 return {rooms,storage,sockets:FakeWebSocket.sockets};
};
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};

test('ws/wss constructed from configured API origin without hardcoded hostname',()=>{
 assert.equal(roomWebSocketUrl(a,'http://api.example.test:8000'),'ws://api.example.test:8000/ws/rooms/'+a);
 assert.equal(roomWebSocketUrl(a,'https://api.example.test'),'wss://api.example.test/ws/rooms/'+a);
 assert.equal(roomWebSocketUrl(a,'http://api.example.test','https:'),'wss://api.example.test/ws/rooms/'+a);
 assert.throws(()=>roomWebSocketUrl('../../auth/login','http://api.example.test'));
});
test('room.changed triggers authoritative GET, not rendering WS payload',async()=>{
 let reads=0;
 const {rooms,sockets}=setup({api:{getRoom:async()=>{reads++;return view(a);}}});
 rooms.state.roomId=a;
 assert.equal(await rooms.refresh(),true);
 assert.equal(sockets.length,1);
 sockets[0].sendMessage({type:'room.changed',room_id:a,members:[{username:'Fake'}]});
 await tick();
 assert.equal(reads,2);
 assert.equal(rooms.state.view.members[0].username,'Alice');
});
test('ignore invalid JSON, unrelated type, or a different room id',async()=>{
 let reads=0;
 const {rooms,sockets}=setup({api:{getRoom:async()=>{reads++;return view(a);}}});
 rooms.state.roomId=a;await rooms.refresh();
 sockets[0].onmessage({data:'{invalid'});
 sockets[0].sendMessage({type:'room.other',room_id:a});
 sockets[0].sendMessage({type:'room.changed',room_id:b});
 await tick();
 assert.equal(reads,1);
});
test('repeated verification does not open duplicate WebSockets',async()=>{
 const {rooms,sockets}=setup({api:{getRoom:async()=>view(a)}});
 rooms.state.roomId=a;
 await rooms.refresh();
 await rooms.refresh();
 await rooms.refresh();
 assert.equal(sockets.length,1);
});
test('close old socket on room switch and ignore late messages/GET',async()=>{
 let oldReadResolve;
 let reads=0;
 const {rooms,sockets}=setup({api:{
  createRoom:async()=>({id:b,room_code:'NEW234',host_account_id:member,state:'Lobby'}),
  getRoom:async id=>{
   reads++;
   if(id===a && reads===2)return new Promise(resolve=>oldReadResolve=resolve);
   return view(id);
  }
 }});
 rooms.state.roomId=a;await rooms.refresh();
 const old=sockets[0];
 const previousHandler=old.onmessage;
 old.sendMessage({type:'room.changed',room_id:a});
 await tick();
 rooms.reset();
 assert.equal(old.closed,true);
 assert.equal(await rooms.createRoom(),true);
 assert.equal(sockets.length,2);
 const after=reads;
 previousHandler({data:JSON.stringify({type:'room.changed',room_id:a})});
 oldReadResolve(view(a));
 await tick();
 assert.equal(reads,after);
 assert.equal(rooms.state.roomId,b);
 assert.equal(rooms.state.view.id,b);
});
test('multiple notifications during GET are coalesced without concurrent reads',async()=>{
 let reads=0,finish;
 const {rooms,sockets}=setup({api:{getRoom:async()=>{
  reads++;
  if(reads===2)return new Promise(resolve=>finish=resolve);
  return view(a);
 }}});
 rooms.state.roomId=a;await rooms.refresh();
 for(let i=0;i<4;i++)sockets[0].sendMessage({type:'room.changed',room_id:a});
 assert.equal(reads,2,'a single GET must be pending');
 finish(view(a));await tick();
 assert.equal(reads,3,'only one follow-up GET for changes during read');
});
test('notification during Ready mutation is deferred until pending write/read completes',async()=>{
 let reads=0,resolveReady;
 const {rooms,sockets}=setup({api:{
  setReady:async()=>new Promise(resolve=>resolveReady=resolve),
  getRoom:async()=>{reads++;return view(a);}
 }});
 rooms.state.roomId=a;
 rooms.state.view={...view(a),members:[{...view(a).members[0],is_host:false}]};
 await rooms.refresh();
 // Ready requires non-Host membership in the authoritative GET.
 rooms.state.view={...view(a),members:[{...view(a).members[0],is_host:false}]};
 const pending=rooms.setReady(true);
 sockets[0].sendMessage({type:'room.changed',room_id:a});
 assert.equal(reads,1);
 resolveReady({account_id:member,is_ready:true});
 await pending;await tick();
 assert.equal(reads,3,'post-write GET plus one queued notification GET');
});
test('room GET 403 closes socket and clears invalid navigation',async()=>{
 let forbidden=false;const storage=store();
 const {rooms,sockets}=setup({storage,api:{getRoom:async()=>{
  if(forbidden)throw Object.assign(new Error('forbidden'),{status:403});
  return view(a);
 }}});
 rooms.state.roomId=a;await rooms.refresh();
 forbidden=true;
 sockets[0].sendMessage({type:'room.changed',room_id:a});
 await tick();
 assert.equal(sockets[0].closed,true);
 assert.equal(rooms.state.roomId,null);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
});
test('pause in Mock closes socket and resume opens exactly one fresh connection',async()=>{
 const {rooms,sockets}=setup({api:{getRoom:async()=>view(a)}});
 rooms.state.roomId=a;await rooms.refresh();
 rooms.pauseNotifications();
 assert.equal(sockets[0].closed,true);
 rooms.resumeNotifications();
 rooms.resumeNotifications();
 assert.equal(sockets.length,2);
});
test('logout reset closes socket and invalidates in-flight GET',async()=>{
 let resolveGet,reads=0;
 const {rooms,sockets}=setup({api:{getRoom:async()=>{
  reads++;
  if(reads===2)return new Promise(resolve=>resolveGet=resolve);
  return view(a);
 }}});
 rooms.state.roomId=a;await rooms.refresh();
 sockets[0].sendMessage({type:'room.changed',room_id:a});
 rooms.reset();
 resolveGet(view(a));
 await tick();
 assert.equal(sockets[0].closed,true);
 assert.equal(rooms.state.view,null);
 assert.equal(rooms.state.roomId,null);
});

test('create, join, and stored Room recovery connect only after authoritative GET',async()=>{
 for(const mode of ['create','join','restore']){
  let resolveRead;
  const pending=new Promise(resolve=>resolveRead=resolve);
  const storage=store();
  if(mode==='restore')storage.setItem('cabo.lastRealRoomId',a);
  const {rooms,sockets}=setup({storage,api:{
   createRoom:async()=>({id:a,room_code:'ABC234',host_account_id:member,state:'Lobby'}),
   joinRoom:async()=>({id:a,room_code:'ABC234',host_account_id:member,state:'Lobby'}),
   getRoom:async()=>pending
  }});
  if(mode==='join')rooms.setJoinCode('ABC234');
  const operation=mode==='create'?rooms.createRoom():mode==='join'?rooms.joinRoom():rooms.restore();
  await tick();
  assert.equal(sockets.length,0,'must not connect before verified Room GET');
  resolveRead(view(a));
  assert.equal(await operation,true);
  assert.equal(sockets.length,1,mode+' should connect exactly once');
 }
});

test('confirmed Leave and Disband close the existing Room WebSocket',async()=>{
 for(const method of ['leaveRoom','disbandRoom']){
  const {rooms,sockets}=setup({api:{
   getRoom:async()=>view(a),
   [method]:async()=>null
  }});
  rooms.state.roomId=a;
  await rooms.refresh();
  assert.equal(sockets.length,1);
  assert.equal(await rooms[method](),true);
  assert.equal(sockets[0].closed,true);
  assert.equal(rooms.state.roomId,null);
 }
});
test('restoring another Room closes the old socket before the new GET finishes',async()=>{
 const storage=store();
 let finish;
 const pending=new Promise(resolve=>finish=resolve);
 let target=a;
 const {rooms,sockets}=setup({storage,api:{getRoom:async id=>{
  if(id===b)return pending;
  return view(a);
 }}});
 rooms.state.roomId=a;
 await rooms.refresh();
 storage.setItem('cabo.lastRealRoomId',b);
 const restoring=rooms.restore();
 assert.equal(sockets[0].closed,true);
 assert.equal(rooms.state.view,null);
 assert.equal(sockets.length,1);
 finish(view(b));
 assert.equal(await restoring,true);
 assert.equal(sockets.length,2);
 assert.equal(rooms.state.roomId,b);
});

test('notification GET is silent until an authoritative changed Room View arrives',async()=>{
 let finish,requests=0;
 const emitted=[];
 const next={...view(a),members:[{...view(a).members[0],username:'Alice Updated'}]};
 const {rooms,sockets}=setup({onChange:(state,options)=>emitted.push({
  pending:state.pending,stale:state.stale,error:state.error,
  username:state.view?.members[0].username,silent:options?.silent===true
 }),api:{getRoom:async()=>{
  requests++;
  if(requests===2)return new Promise(resolve=>finish=resolve);
  return view(a);
 }}});
 rooms.state.roomId=a;
 await rooms.refresh();
 emitted.length=0;
 sockets[0].sendMessage({type:'room.changed',room_id:a});
 assert.equal(rooms.state.pending,'read');
 assert.equal(rooms.state.stale,false);
 assert.equal(rooms.state.error,'');
 assert.equal(emitted.length,0,'no loading event while WebSocket GET is pending');
 finish(next);await tick();
 assert.equal(emitted.length,1,'only one UI update for the completed GET');
 assert.equal(emitted[0].silent,true);
 assert.equal(emitted[0].pending,null);
 assert.equal(emitted[0].username,'Alice Updated');
});
test('notification with identical Room View causes no UI rerender',async()=>{
 let emissions=0;
 const {rooms,sockets}=setup({
  onChange:()=>emissions++,
  api:{getRoom:async()=>view(a)}
 });
 rooms.state.roomId=a;await rooms.refresh();
 emissions=0;
 sockets[0].sendMessage({type:'room.changed',room_id:a});
 await tick();
 assert.equal(emissions,0);
});
test('transient notification GET failure keeps old Room and avoids error flash',async()=>{
 let reads=0,emissions=0;
 const {rooms,sockets}=setup({
  onChange:()=>emissions++,
  api:{getRoom:async()=>{
   reads++;
   if(reads>1)throw Object.assign(new Error('temporary outage'),{status:503});
   return view(a);
  }}
 });
 rooms.state.roomId=a;await rooms.refresh();
 emissions=0;
 sockets[0].sendMessage({type:'room.changed',room_id:a});
 await tick();
 assert.equal(emissions,0,'silent failure must not show a temporary error');
 assert.equal(rooms.state.error,'');
 assert.equal(rooms.state.stale,false);
 assert.equal(rooms.state.view.members[0].username,'Alice');
 assert.equal(await rooms.refresh(),false,'manual refresh still reports a real error');
 assert.match(rooms.state.error,/temporary outage/);
});

test('server 1008 Kick close rechecks Room, then revokes access on GET 403',async()=>{
 let reads=0;const storage=store(),emitted=[];
 const {rooms,sockets}=setup({storage,onChange:(state)=>emitted.push({roomId:state.roomId,error:state.error}),api:{
  getRoom:async()=>{if(++reads===1)return view(a);throw Object.assign(new Error('forbidden'),{status:403});}
 }});
 rooms.state.roomId=a;await rooms.refresh();
 sockets[0].serverClose(1008);await tick();
 assert.equal(reads,2);
 assert.equal(rooms.state.roomId,null);
 assert.equal(rooms.state.view,null);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
 assert.match(rooms.state.error,/当前房间已关闭或你已不在房间/);
 assert.equal(sockets.length,1,'closed socket cannot auto reconnect');
});
test('Host Disband or Leave close revalidates and revokes Room on GET 404',async()=>{
 for(const code of [1008,1000]){
  let reads=0;
  const {rooms,sockets}=setup({api:{getRoom:async()=>{
   if(++reads===1)return view(a);
   throw Object.assign(new Error('missing'),{status:404});
  }}});
  rooms.state.roomId=a;await rooms.refresh();
  sockets[0].serverClose(code);await tick();
  assert.equal(reads,2);
  assert.equal(rooms.state.roomId,null);
  assert.equal(sockets.length,1);
 }
});
test('unexpected network WS close with GET 200 keeps Room and does not reconnect',async()=>{
 let reads=0;const {rooms,sockets}=setup({api:{getRoom:async()=>{reads++;return view(a);}}});
 rooms.state.roomId=a;await rooms.refresh();
 sockets[0].serverClose(1006);await tick();
 assert.equal(reads,2);
 assert.equal(rooms.state.roomId,a);
 assert.equal(rooms.state.view.members[0].username,'Alice');
 assert.equal(sockets.length,1);
 await rooms.refresh();
 assert.equal(reads,3);
 assert.equal(sockets.length,1,'manual GET must not reconnect a closed socket');
});
test('local Leave, Disband, and pause do not trigger verification from local close',async()=>{
 for(const action of ['leaveRoom','disbandRoom','pauseNotifications']){
  let reads=0;
  const {rooms,sockets}=setup({api:{
   getRoom:async()=>{reads++;return view(a);},
   leaveRoom:async()=>null,disbandRoom:async()=>null
  }});
  rooms.state.roomId=a;await rooms.refresh();
  const oldClose=sockets[0].onclose;
  if(action==='pauseNotifications')rooms.pauseNotifications();
  else await rooms[action]();
  oldClose?.({code:1000});await tick();
  assert.equal(reads,1,action+' must not cause a redundant GET');
  assert.equal(sockets[0].closed,true);
 }
});
test('late close event from old Room cannot invalidate new Room',async()=>{
 let reads=0;const {rooms,sockets}=setup({api:{
  createRoom:async()=>({id:b,room_code:'ABC234',host_account_id:member,state:'Lobby'}),
  getRoom:async id=>{reads++;return view(id);}
 }});
 rooms.state.roomId=a;await rooms.refresh();
 const oldClose=sockets[0].onclose;
 rooms.reset();
 await rooms.createRoom();
 assert.equal(rooms.state.roomId,b);
 const before=reads;
 oldClose?.({code:1008});await tick();
 assert.equal(reads,before);
 assert.equal(rooms.state.roomId,b);
 assert.equal(rooms.state.view.id,b);
});
test('server close during pending GET invalidates old response, then revalidates',async()=>{
 let reads=0,resolveOld,resolveNew;
 const {rooms,sockets}=setup({api:{getRoom:async()=>{
  reads++;
  if(reads===1)return view(a);
  if(reads===2)return new Promise(resolve=>resolveOld=resolve);
  if(reads===3)return new Promise((resolve,reject)=>resolveNew=()=>reject(Object.assign(new Error('kicked'),{status:403})));
 }}});
 rooms.state.roomId=a;await rooms.refresh();
 const pending=rooms.refresh();
 sockets[0].serverClose(1008);
 assert.equal(reads,2,'close does not start concurrent GET');
 resolveOld({...view(a),members:[{...view(a).members[0],username:'Stale'}]});
 await pending;await tick();
 assert.equal(reads,3,'one queued verification GET');
 assert.equal(rooms.state.view.members[0].username,'Alice','late 200 must not overwrite state');
 resolveNew();await tick();
 assert.equal(rooms.state.roomId,null);
 assert.equal(rooms.state.view,null);
});

test('opt-in WS diagnostics log lifecycle and GET status without sensitive headers',async()=>{
 const logs=[],oldInfo=console.info,oldDebug=globalThis.CABO_DEBUG_ROOM_WS;
 let reads=0;
 try{
  console.info=(...args)=>logs.push(args);
  globalThis.CABO_DEBUG_ROOM_WS=true;
  const {rooms,sockets}=setup({api:{getRoom:async()=>{
   if(++reads===1)return view(a);
   throw Object.assign(new Error('forbidden'),{status:403});
  }}});
  rooms.state.roomId=a;
  await rooms.refresh();
  sockets[0].onopen?.();
  sockets[0].serverClose(1008);
  await tick();
  assert.equal(rooms.state.roomId,null);
  const summary=JSON.stringify(logs);
  assert.match(summary,/connecting/);
  assert.match(summary,/open/);
  assert.match(summary,/close-callback/);
  assert.match(summary,/close-recheck-get/);
  assert.match(summary,/close-recheck-result/);
  assert.match(summary,/"status":403/);
  assert.match(summary,/room-access-revoked/);
  assert.doesNotMatch(summary,/Cookie|session_token|Authorization|password|request_body/i);
 }finally{
  console.info=oldInfo;
  if(oldDebug===undefined)delete globalThis.CABO_DEBUG_ROOM_WS;
  else globalThis.CABO_DEBUG_ROOM_WS=oldDebug;
 }
});

test('returning to foreground revokes kicked Room even if WebSocket close was missed',async()=>{
 let reads=0;const storage=store();
 const {rooms,sockets}=setup({storage,api:{getRoom:async()=>{
  if(++reads===1)return view(a);
  throw Object.assign(new Error('no longer a member'),{status:403});
 }}});
 rooms.state.roomId=a;await rooms.refresh();
 assert.equal(sockets.length,1);
 assert.equal(rooms.verifyOnReturn(),true);
 await tick();
 assert.equal(reads,2);
 assert.equal(rooms.state.roomId,null);
 assert.equal(rooms.state.view,null);
 assert.equal(storage.getItem('cabo.lastRealRoomId'),null);
 assert.equal(sockets[0].closed,true);
});
test('foreground check with GET 200 keeps Room without duplicate socket',async()=>{
 let reads=0;
 const {rooms,sockets}=setup({api:{getRoom:async()=>{reads++;return view(a);}}});
 rooms.state.roomId=a;await rooms.refresh();
 assert.equal(rooms.verifyOnReturn(),true);
 await tick();
 assert.equal(reads,2);
 assert.equal(rooms.state.roomId,a);
 assert.equal(sockets.length,1);
});
test('foreground verification during an old GET discards stale 200 and checks again',async()=>{
 let reads=0,finishOld;
 const {rooms,sockets}=setup({api:{getRoom:async()=>{
  reads++;
  if(reads===1)return view(a);
  if(reads===2)return new Promise(resolve=>finishOld=resolve);
  throw Object.assign(new Error('kicked'),{status:403});
 }}});
 rooms.state.roomId=a;await rooms.refresh();
 const earlier=rooms.refresh();
 assert.equal(reads,2);
 rooms.verifyOnReturn();
 finishOld({...view(a),members:[{...view(a).members[0],username:'Outdated'}]});
 await earlier;await tick();
 assert.equal(reads,3);
 assert.equal(rooms.state.view,null);
 assert.equal(rooms.state.roomId,null);
 assert.equal(sockets[0].closed,true);
});
test('foreground check is ignored while real Room notifications are paused or Room absent',async()=>{
 let reads=0;
 const {rooms}=setup({api:{getRoom:async()=>{reads++;return view(a);}}});
 assert.equal(rooms.verifyOnReturn(),false);
 rooms.state.roomId=a;await rooms.refresh();
 rooms.pauseNotifications();
 assert.equal(rooms.verifyOnReturn(),false);
 await tick();
 assert.equal(reads,1);
});
