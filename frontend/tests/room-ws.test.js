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
}
const setup=({api,storage=store()}={})=>{
 FakeWebSocket.sockets=[];
 const rooms=createRealRoomState({
  api,storage,getAccountId:()=>member,
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
