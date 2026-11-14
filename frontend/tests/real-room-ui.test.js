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
 const events={};
 const store=storage();
 if(storedId)store.setItem('cabo.lastRealRoomId',storedId);
 let sent=0;
 const root={
  innerHTML:'',
  addEventListener(type,fn){events[type]=fn;},
  querySelectorAll(){return [];},
  querySelector(){return null;}
 };
 const ctx={
  document:{querySelector:()=>root},
  window:{sessionStorage:store,addEventListener(){}},
  gateway:{snapshot:()=>({account:null,room:null,game:null,connection:'disconnected'}),send:async()=>{sent++;return{status:'Accepted'};}},
  assertCompatible:v=>v,formatRemaining:()=>'-',
  passwordsMatch:(a,b)=>a===b,passwordConfirmationFeedback:()=>'',
  resendSecondsRemaining:()=>0,VERIFICATION_COOLDOWN_MS:60000,
  createAuthApi:()=>({getMe:async()=>me,logout:async()=>null}),
  createRoomApi:()=>roomApi,
  createRealRoomState,
  setInterval(){},
  FormData:class{
   constructor(form){this.fields=form.fields;}
   *[Symbol.iterator](){yield* Object.entries(this.fields);}
  }
 };
 runInNewContext(appSource+'\n;globalThis.__testRoom=realRooms;',ctx);
 return {root,rooms:ctx.__testRoom,store,events,mockSends:()=>sent};
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
 assert.match(html,/正在踢出成员/);
 assert.match(html,/data-action="realRoomLeave" disabled/);
 assert.match(html,/data-action="realRoomDisband" disabled/);
 assert.match(html,/data-action="realRoomKick:[^"]+" disabled/);
 finish(null);
 await flush();
 assert.equal(ui.mockSends(),0);
});
