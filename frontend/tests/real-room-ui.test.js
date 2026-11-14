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
