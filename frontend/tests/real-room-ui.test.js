import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRealRoomState} from '../src/real-room-state.js';

const appSource=readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replace(/^import .*$/gm,'');
const account={id:'123e4567-e89b-12d3-a456-426614174001',username:'Alice',email:'alice@example.com'};
const id='123e4567-e89b-12d3-a456-426614174000';
const baseRoom={id,room_code:'ABC234',host_account_id:account.id,state:'Lobby'};
const members=[
 {account_id:'123e4567-e89b-12d3-a456-426614174002',username:'Bob',seat_index:2,is_ready:true,is_host:false},
 {account_id:account.id,username:'Alice',seat_index:0,is_ready:false,is_host:true}
];
function storage(){
 const data=new Map();
 return {getItem:key=>data.get(key)||null,setItem:(key,v)=>data.set(key,v),removeItem:key=>data.delete(key)};
}
function boot({roomApi,storedId=null,me=account}={}){
 const events={},windowEvents={},documentEvents={};
 const store=storage();
 if(storedId)store.setItem('cabo.lastRealRoomId',storedId);
 let sent=0;
 let onRoomChanged=()=>{},onRoomClosed=()=>{};
 const root={
  innerHTML:'',
  addEventListener(type,fn){events[type]=fn;},
  querySelectorAll(){return [];},
  querySelector(){return null;}
 };
 const ctx={
  document:{querySelector:()=>root,visibilityState:'visible',addEventListener(type,fn){documentEvents[type]=fn;}},
  window:{sessionStorage:store,addEventListener(type,fn){windowEvents[type]=fn;}},
  gateway:{snapshot:()=>({account:null,room:null,game:null,connection:'disconnected'}),send:async()=>{sent++;return{status:'Accepted'};}},
  assertCompatible:v=>v,formatRemaining:()=>'-',
  passwordsMatch:(a,b)=>a===b,passwordConfirmationFeedback:()=>'',
  resendSecondsRemaining:()=>0,VERIFICATION_COOLDOWN_MS:60000,
  createAuthApi:()=>({getMe:async()=>me,logout:async()=>null}),
  createRoomApi:()=>roomApi,
  createRoomSocket:options=>{onRoomChanged=options.onChanged;onRoomClosed=options.onClosed;return {connect(){},close(){}};},
  createRealRoomState,
  createGameApi:()=>({}),
  createGameSocket:()=>({connect(){},close(){}}),
  createRealGameState:()=>({
   state:{gameId:null,view:null,pending:null,error:''},
   pause(){},reset(){},remember(){return true;},enter:async()=>false,
   sync:async()=>false,onReturn(){},validPeekPosition:()=>false,
   canComplete:()=>false,remainingMs:()=>0,peek:async()=>false,
   complete:async()=>false,retryPending:async()=>false
  }),
  realGameMarkup:()=>'<section>真实 GameView</section>',
  GAME_ID:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  setInterval(){},
  FormData:class{
   constructor(form){this.fields=form.fields;}
   *[Symbol.iterator](){yield* Object.entries(this.fields);}
  }
 };
 runInNewContext(appSource+'\n;globalThis.__testRoom=realRooms;',ctx);
 return {root,rooms:ctx.__testRoom,store,events,windowEvents,documentEvents,mockSends:()=>sent,notify:id=>onRoomChanged(id),remoteClose:id=>onRoomClosed(id)};
}
async function flush(){await new Promise(resolve=>setImmediate(resolve));}

test('real account Create calls POST then authoritative GET before rendering members',async()=>{
 const calls=[];
 const roomApi={
  async createRoom(){calls.push('create');return baseRoom;},
  async getRoom(roomId){calls.push('get:'+roomId);return {...baseRoom,members};}
 };
 const ui=boot({roomApi});
 await flush();
 assert.match(ui.root.innerHTML,/创建房间/);
 assert.match(ui.root.innerHTML,/六位房间码/);
 assert.match(ui.root.innerHTML,/进入本地 Mock 演示/);
 assert.doesNotMatch(ui.root.innerHTML,/Bob/);
 await ui.rooms.createRoom();
 assert.deepEqual(calls,['create','get:'+id]);
 const html=ui.root.innerHTML;
 assert.match(html,/ABC234/);
 assert.match(html,/Lobby/);
 assert.match(html,/2 \/ 4/);
 assert.match(html,/房主账号/);
 assert.match(html,/Bob/);
 assert.match(html,/座位 2/);
 assert.match(html,/座位 0/);
 assert.match(html,/已准备/);
 assert.match(html,/未准备/);
 assert.match(html,/房主/);
 const memberHtml=html.slice(html.indexOf('<div class="member-list">'));
 assert.ok(memberHtml.indexOf('Alice')<memberHtml.indexOf('Bob'),'order by server seat_index');
 assert.equal(ui.mockSends(),0);
});
test('Join normalizes lowercase input and renders only verified GET',async()=>{
 const calls=[];
 const ui=boot({roomApi:{
  async joinRoom(code){calls.push('join:'+code);return baseRoom;},
  async getRoom(roomId){calls.push('get:'+roomId);return {...baseRoom,members};}
 }});
 await flush();
 ui.rooms.setJoinCode('abc234');
 assert.equal(await ui.rooms.joinRoom(),true);
 assert.deepEqual(calls,['join:ABC234','get:'+id]);
 assert.match(ui.root.innerHTML,/ABC234/);
 assert.match(ui.root.innerHTML,/成员与座位/);
});
test('pending restored Room displays no members until server confirms GET',async()=>{
 let release;
 const pending=new Promise(resolve=>release=resolve);
 const ui=boot({roomApi:{getRoom:async()=>pending},storedId:id});
 await flush();
 assert.equal(ui.rooms.state.pending,'read');
 assert.match(ui.root.innerHTML,/服务器尚未确认房间访问权限/);
 assert.doesNotMatch(ui.root.innerHTML,/Bob/);
 release({...baseRoom,members});
 await flush();
 assert.match(ui.root.innerHTML,/Bob/);
 assert.equal(ui.store.getItem('cabo.lastRealRoomId'),id);
});
test('403 during restore clears navigation and returns entrance, never fabricates membership',async()=>{
 const ui=boot({storedId:id,roomApi:{getRoom:async()=>{throw Object.assign(new Error('无权限'),{status:403});}}});
 await flush();
 assert.equal(ui.rooms.state.roomId,null);
 assert.equal(ui.store.getItem('cabo.lastRealRoomId'),null);
 assert.match(ui.root.innerHTML,/创建房间/);
 assert.doesNotMatch(ui.root.innerHTML,/Bob/);
});
test('refresh is a new GET and replaces all server Room member data',async()=>{
 let calls=0;
 const ui=boot({roomApi:{
  createRoom:async()=>baseRoom,
  getRoom:async()=>{calls++;return {...baseRoom,members:calls===1?members:[{...members[1],is_ready:true}]};}
 }});
 await flush();
 await ui.rooms.createRoom();
 assert.match(ui.root.innerHTML,/Bob/);
 await ui.rooms.refresh();
 assert.doesNotMatch(ui.root.innerHTML,/Bob/);
 assert.equal(ui.rooms.state.view.members.length,1);
 assert.match(ui.root.innerHTML,/已准备/);
});
test('uncertain Create offers revalidation but never auto-retries the write',async()=>{
 let attempts=0;
 const ui=boot({roomApi:{
  async createRoom(){attempts++;throw Object.assign(new Error('网络中断，操作结果未知'),{outcomeUnknown:true,status:0});}
 }});
 await flush();
 await ui.rooms.createRoom();
 assert.equal(attempts,1);
 assert.match(ui.root.innerHTML,/操作结果尚不能确认/);
 assert.match(ui.root.innerHTML,/重新验证登录状态/);
 assert.doesNotMatch(ui.root.innerHTML,/data-action="realRoomCreate"/);
 assert.equal(ui.rooms.state.roomId,null);
});

test('delegated Create click invokes real Room client, not Mock command',async()=>{
 let created=0;
 const ui=boot({roomApi:{
  async createRoom(){created++;return baseRoom;},
  async getRoom(){return {...baseRoom,members};}
 }});
 await flush();
 ui.events.click({target:{closest(selector){
  if(selector==='[data-auth]')return null;
  if(selector==='[data-action]')return {disabled:false,dataset:{action:'realRoomCreate'}};
  return null;
 }}});
 await flush();
 assert.equal(created,1);
 assert.equal(ui.mockSends(),0);
 assert.match(ui.root.innerHTML,/成员与座位/);
});
test('delegated Join form sends normalized backend code',async()=>{
 let joined=null;
 const ui=boot({roomApi:{
  async joinRoom(code){joined=code;return baseRoom;},
  async getRoom(){return {...baseRoom,members};}
 }});
 await flush();
 ui.events.submit({
  preventDefault(){},
  target:{id:'real-room-join-form',fields:{roomCode:'abc234'}}
 });
 await flush();
 assert.equal(joined,'ABC234');
 assert.equal(ui.mockSends(),0);
 assert.match(ui.root.innerHTML,/房间码/);
});

function clickReal(ui,action){
 ui.events.click({target:{closest(selector){
  if(selector==='[data-auth]')return null;
  if(selector==='[data-action]')return {disabled:false,dataset:{action}};
  return null;
 }}});
}
test('Host controls: no Ready, can Kick others and Disband, Leave warns room will dissolve',async()=>{
 const calls=[];const ui=boot({storedId:id,roomApi:{
  async getRoom(){return {...baseRoom,members};},
  async kickMember(room,member){calls.push(['kick',room,member]);return null;},
  async leaveRoom(room){calls.push(['leave',room]);return null;},
  async disbandRoom(room){calls.push(['disband',room]);return null;}
 }});
 await flush();
 const html=ui.root.innerHTML;
 assert.doesNotMatch(html,/data-action="realRoomReady"/);
 assert.match(html,/data-action="realRoomKick:123e4567-e89b-12d3-a456-426614174002"/);
 assert.doesNotMatch(html,/data-action="realRoomKick:123e4567-e89b-12d3-a456-426614174001"/);
 assert.match(html,/data-action="realRoomDisband"/);
 clickReal(ui,'realRoomLeave');
 assert.match(ui.root.innerHTML,/你是房主，离开将解散整个房间，所有成员都会退出。确定继续吗？/);
 assert.deepEqual(calls,[]);
 clickReal(ui,'realRoomCancel');
 assert.doesNotMatch(ui.root.innerHTML,/real-room-modal-title/);
 clickReal(ui,'realRoomKick:123e4567-e89b-12d3-a456-426614174002');
 assert.match(ui.root.innerHTML,/确定将「Bob」踢出当前房间吗？/);
 clickReal(ui,'realRoomApprove');
 await flush();
 assert.deepEqual(calls,[['kick',id,members[0].account_id]]);
 assert.equal(ui.mockSends(),0);
});
test('Guest controls: Ready/Unready and Leave, never Kick or Disband',async()=>{
 const guest=members[0].account_id;
 const own={id:guest,username:'Bob',email:'bob@example.com'};
 let readyValue;
 const ui=boot({me:own,storedId:id,roomApi:{
  async getRoom(){return {...baseRoom,members};},
  async setReady(room,ready){readyValue=ready;return {account_id:guest,is_ready:ready};},
  async leaveRoom(){return null;}
 }});
 await flush();
 let html=ui.root.innerHTML;
 assert.match(html,/data-action="realRoomReady"/);
 assert.match(html,/取消准备/);
 assert.doesNotMatch(html,/data-action="realRoomKick:/);
 assert.doesNotMatch(html,/data-action="realRoomDisband"/);
 clickReal(ui,'realRoomReady');
 await flush();
 assert.equal(readyValue,false);
 clickReal(ui,'realRoomLeave');
 assert.match(ui.root.innerHTML,/确定离开当前房间吗？/);
 clickReal(ui,'realRoomApprove');
 await flush();
 assert.equal(ui.rooms.state.roomId,null);
 assert.equal(ui.store.getItem('cabo.lastRealRoomId'),null);
 assert.equal(ui.mockSends(),0);
});
test('Disband requires confirmation and 204 returns to real Room entry',async()=>{
 let count=0;
 const ui=boot({storedId:id,roomApi:{
  getRoom:async()=>({...baseRoom,members}),
  disbandRoom:async()=>{count++;return null;}
 }});
 await flush();
 clickReal(ui,'realRoomDisband');
 assert.match(ui.root.innerHTML,/解散后房间将关闭，所有成员退出，无法恢复。确定解散吗？/);
 assert.equal(count,0);
 clickReal(ui,'realRoomApprove');
 await flush();
 assert.equal(count,1);
 assert.equal(ui.rooms.state.roomId,null);
 assert.match(ui.root.innerHTML,/创建房间/);
 assert.equal(ui.mockSends(),0);
});
test('non-Lobby view never renders executable write actions',async()=>{
 const ui=boot({storedId:id,roomApi:{
  getRoom:async()=>({...baseRoom,state:'Playing',members})
 }});
 await flush();
 for(const action of ['realRoomReady','realRoomLeave','realRoomKick:','realRoomDisband']){
  assert.doesNotMatch(ui.root.innerHTML,new RegExp('data-action="'+action));
 }
});

test('in-flight real Lobby mutation disables all conflicting controls',async()=>{
 let finish;
 const pending=new Promise(resolve=>finish=resolve);
 const ui=boot({storedId:id,roomApi:{
  getRoom:async()=>({...baseRoom,members}),
  kickMember:async()=>pending
 }});
 await flush();
 clickReal(ui,'realRoomKick:'+members[0].account_id);
 clickReal(ui,'realRoomApprove');
 await flush();
 const html=ui.root.innerHTML;
 assert.doesNotMatch(html,/正在踢出成员/,'Lobby mutations must not show a loading banner');
 assert.match(html,/data-action="realRoomLeave" disabled/);
 assert.match(html,/data-action="realRoomDisband" disabled/);
 assert.match(html,/data-action="realRoomKick:[^"]+" disabled/);
 finish(null);
 await flush();
 assert.equal(ui.mockSends(),0);
});

test('WebSocket Room update patches only Room area, without full-screen flicker',async()=>{
 let reads=0;
 const ui=boot({storedId:id,roomApi:{
  async getRoom(){
   reads++;
   return {...baseRoom,members:reads===1?members:[...members,{account_id:'123e4567-e89b-12d3-a456-426614174003',username:'Carol',seat_index:3,is_ready:false,is_host:false}]};
  }
 }});
 await flush();
 await flush(); // Allow initial /auth/me and stored Room restore to finish.
 let fullRedraws=0;
 let html=ui.root.innerHTML;
 Object.defineProperty(ui.root,'innerHTML',{
  configurable:true,get:()=>html,set:value=>{fullRedraws++;html=value;}
 });
 const patches=[];
 ui.root.querySelector=selector=>selector==='.real-room-area'
  ? {set outerHTML(value){patches.push(value);}}
  : null;
 ui.notify(id);
 assert.equal(fullRedraws,0,'no intermediate full render on notification');
 await flush();
 assert.equal(reads,2);
 assert.equal(fullRedraws,0,'account page and dialogs must remain intact');
 assert.equal(patches.length,1);
 assert.match(patches[0],/Carol/);
 assert.doesNotMatch(patches[0],/正在同步服务器房间信息/);
 ui.notify(id);
 await flush();
 assert.equal(patches.length,1,'identical Room View should not redraw');
});

test('Ready and Unready update only Room region without full-page loading redraw',async()=>{
 const guest={id:members[0].account_id,username:'Bob',email:'bob@example.com'};
 let ready=false,reads=0;
 const ui=boot({me:guest,storedId:id,roomApi:{
  async getRoom(){reads++;return {...baseRoom,members:[{...members[0],is_ready:ready},members[1]]};},
  async setReady(room,value){assert.equal(room,id);ready=value;return {account_id:guest.id,is_ready:value};}
 }});
 await flush();await flush();
 let html=ui.root.innerHTML,fullRedraws=0;
 Object.defineProperty(ui.root,'innerHTML',{
  configurable:true,get:()=>html,set:value=>{fullRedraws++;html=value;}
 });
 const patches=[];
 ui.root.querySelector=selector=>selector==='.real-room-area'
  ? {set outerHTML(value){patches.push(value);}}
  : null;
 assert.equal(await ui.rooms.setReady(true),true);
 assert.equal(await ui.rooms.setReady(false),true);
 assert.equal(reads,3,'initial + two authoritative post-mutation GETs');
 assert.equal(fullRedraws,0,'mutation must not redraw account page');
 assert.ok(patches.length>=2,'Room-local updates are permitted');
 for(const patch of patches){
  assert.doesNotMatch(patch,/正在更新准备状态|正在同步服务器房间信息/);
 }
 assert.match(patches.at(-1),/○ 未准备/);
});
test('Kick and Leave confirmation do not rebuild the full account page',async()=>{
 const ui=boot({storedId:id,roomApi:{
  async getRoom(){return {...baseRoom,members};},
  async kickMember(){return null;}
 }});
 await flush();await flush();
 let html=ui.root.innerHTML,fullRedraws=0,modalOpened=0,modalClosed=0;
 Object.defineProperty(ui.root,'innerHTML',{
  configurable:true,get:()=>html,set:value=>{fullRedraws++;html=value;}
 });
 const patches=[];
 ui.root.querySelector=selector=>{
  if(selector==='.app-shell')return {insertAdjacentHTML(position,value){
   assert.equal(position,'beforeend');
   assert.match(value,/realRoomApprove/);
   modalOpened++;
  }};
  if(selector==='[data-real-room-dialog]')return {remove(){modalClosed++;}};
  if(selector==='.real-room-area')return {set outerHTML(value){patches.push(value);}};
  return null;
 };
 clickReal(ui,'realRoomKick:'+members[0].account_id);
 assert.equal(modalOpened,1);
 assert.equal(fullRedraws,0,'opening confirmation should not replace shell');
 clickReal(ui,'realRoomCancel');
 assert.equal(modalClosed,1);
 assert.equal(fullRedraws,0,'cancel should not redraw');
 clickReal(ui,'realRoomKick:'+members[0].account_id);
 clickReal(ui,'realRoomApprove');
 await flush();
 assert.equal(modalClosed,2);
 assert.equal(fullRedraws,0,'confirmed Kick and follow-up GET remain Room-local');
 assert.ok(patches.length>0);
});

test('confirmed Leave switches to Room entry with one local patch and no page rebuild',async()=>{
 const guest={id:members[0].account_id,username:'Bob',email:'bob@example.com'};
 let leaves=0;
 const ui=boot({me:guest,storedId:id,roomApi:{
  async getRoom(){return {...baseRoom,members};},
  async leaveRoom(){leaves++;return null;}
 }});
 await flush();await flush();
 let html=ui.root.innerHTML,fullRedraws=0,closed=0;
 Object.defineProperty(ui.root,'innerHTML',{
  configurable:true,get:()=>html,set:value=>{fullRedraws++;html=value;}
 });
 const patches=[];
 ui.root.querySelector=selector=>{
  if(selector==='.app-shell')return {insertAdjacentHTML(){}};
  if(selector==='[data-real-room-dialog]')return {remove(){closed++;}};
  if(selector==='.real-room-area')return {set outerHTML(value){patches.push(value);}};
  return null;
 };
 clickReal(ui,'realRoomLeave');
 clickReal(ui,'realRoomApprove');
 await flush();
 assert.equal(leaves,1);
 assert.equal(closed,1);
 assert.equal(fullRedraws,0,'Leave success must not reconstruct account shell');
 assert.equal(ui.rooms.state.roomId,null);
 assert.equal(ui.store.getItem('cabo.lastRealRoomId'),null);
 assert.match(patches.at(-1),/创建房间/);
 assert.doesNotMatch(patches.at(-1),/正在离开房间/);
});

test('1008 remote close followed by authoritative 403 transitions real account UI to entrance',async()=>{
 const guest={id:members[0].account_id,username:'Bob',email:'bob@example.com'};
 let reads=0;
 const ui=boot({me:guest,storedId:id,roomApi:{
  async getRoom(){
   if(++reads===1)return {...baseRoom,members};
   throw Object.assign(new Error('无权访问房间'),{status:403});
  }
 }});
 await flush();await flush();
 assert.match(ui.root.innerHTML,/真实房间/);
 assert.match(ui.root.innerHTML,/Bob/);
 ui.remoteClose(id);
 await flush();await flush();
 assert.equal(reads,2);
 assert.equal(ui.rooms.state.roomId,null);
 assert.equal(ui.rooms.state.view,null);
 assert.equal(ui.store.getItem('cabo.lastRealRoomId'),null);
 assert.match(ui.root.innerHTML,/创建房间/);
 assert.match(ui.root.innerHTML,/当前房间已关闭或你已不在房间/);
 assert.doesNotMatch(ui.root.innerHTML,/data-action="realRoomRefresh"/);
 assert.equal(ui.mockSends(),0);
});

test('kicked member rechecks silently on window focus even when WebSocket close is missed',async()=>{
 const bob={id:members[0].account_id,username:'Bob',email:'bob@example.com'};
 let reads=0;
 const ui=boot({me:bob,storedId:id,roomApi:{
  async getRoom(){
   if(++reads===1)return {...baseRoom,members};
   throw Object.assign(new Error('无权限访问该房间'),{status:403});
  }
 }});
 await flush();await flush();
 assert.equal(ui.rooms.state.roomId,id);
 assert.match(ui.root.innerHTML,/真实房间/);
 assert.ok(ui.windowEvents.focus,'window focus revalidation must be registered');
 ui.windowEvents.focus();
 await flush();
 assert.equal(reads,2);
 assert.equal(ui.rooms.state.roomId,null);
 assert.equal(ui.rooms.state.view,null);
 assert.equal(ui.store.getItem('cabo.lastRealRoomId'),null);
 assert.match(ui.root.innerHTML,/创建房间/);
 assert.doesNotMatch(ui.root.innerHTML,/服务器尚未确认房间访问权限/);
 assert.equal(ui.mockSends(),0);
});
test('focus and visibilitychange close together cause a single silent Room verification',async()=>{
 let reads=0;
 const ui=boot({storedId:id,roomApi:{
  async getRoom(){reads++;return {...baseRoom,members};}
 }});
 await flush();await flush();
 assert.equal(reads,1);
 ui.windowEvents.focus();
 ui.documentEvents.visibilitychange();
 await flush();
 assert.equal(reads,2);
 assert.equal(ui.rooms.state.roomId,id);
});

test('Host Start button enabled only for verified eligible Lobby, hidden for guest and Playing',async()=>{
 const readyMembers=members;
 const hostUI=boot({storedId:id,roomApi:{getRoom:async()=>({...baseRoom,members:readyMembers})}});
 await flush();await flush();
 assert.match(hostUI.root.innerHTML,/data-action="realRoomStart"/);
 assert.match(hostUI.root.innerHTML,/开始游戏/);
 assert.doesNotMatch(hostUI.root.innerHTML,/data-action="realRoomStart" disabled/);
 const notReady=boot({storedId:id,roomApi:{getRoom:async()=>({...baseRoom,members:[{...members[0],is_ready:false},members[1]]})}});
 await flush();await flush();
 assert.match(notReady.root.innerHTML,/data-action="realRoomStart" disabled/);
 const alone=boot({storedId:id,roomApi:{getRoom:async()=>({...baseRoom,members:[members[1]]})}});
 await flush();await flush();
 assert.match(alone.root.innerHTML,/data-action="realRoomStart" disabled/);
 const guest=boot({me:{id:members[0].account_id,username:'Bob',email:'bob@example.com'},storedId:id,
  roomApi:{getRoom:async()=>({...baseRoom,members:readyMembers})}});
 await flush();await flush();
 assert.doesNotMatch(guest.root.innerHTML,/data-action="realRoomStart"/);
 const playing=boot({storedId:id,roomApi:{getRoom:async()=>({...baseRoom,state:'Playing',members:readyMembers})}});
 await flush();await flush();
 assert.match(playing.root.innerHTML,/游戏已开始/);
 assert.match(playing.root.innerHTML,/真实 Game View、发牌和回合功能尚未接入/);
 assert.doesNotMatch(playing.root.innerHTML,/data-action="realRoomStart"/);
 assert.doesNotMatch(playing.root.innerHTML,/data-action="realRoomDisband"/);
 assert.equal(playing.store.getItem('cabo.lastRealRoomId'),id);
});
test('Host Start click issues exactly one POST, renders Playing only after authoritative GET',async()=>{
 let starts=0,finishGet,reads=0;
 const ui=boot({storedId:id,roomApi:{
  async getRoom(){
   reads++;
   if(reads===1)return {...baseRoom,members};
   return new Promise(resolve=>finishGet=()=>resolve({...baseRoom,state:'Playing',members}));
  },
  async startGame(roomId){
   assert.equal(roomId,id);starts++;
   return {id:'123e4567-e89b-12d3-a456-426614174006',room_id:id,state:'InitialReveal',started_at:'2026-11-17T09:00:00Z'};
  }
 }});
 await flush();await flush();
 clickReal(ui,'realRoomStart');
 await flush();
 assert.equal(starts,1);
 assert.equal(reads,2);
 assert.equal(ui.rooms.state.view.state,'Lobby');
 assert.equal(ui.rooms.state.pending,'read');
 clickReal(ui,'realRoomStart');
 assert.equal(starts,1);
 finishGet();await flush();
 assert.equal(ui.rooms.state.view.state,'Playing');
 assert.match(ui.root.innerHTML,/游戏已开始/);
 assert.doesNotMatch(ui.root.innerHTML,/data-action="realRoomStart"/);
 assert.equal(ui.store.getItem('cabo.lastRealRoomId'),id);
 assert.equal(ui.mockSends(),0);
});
