import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealGameState} from '../src/real-game-state.js';
import {realGameMarkup} from '../src/real-game-ui.js';
const id='123e4567-e89b-12d3-a456-426614174100',roomId='123e4567-e89b-12d3-a456-426614174000';
const me='123e4567-e89b-12d3-a456-426614174001',bob='123e4567-e89b-12d3-a456-426614174002';
const requestId='123e4567-e89b-12d3-a456-426614174777';
const initial=Date.parse('2026-11-25T10:00:00Z'),deadline=new Date(initial+45000).toISOString();
const store=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),dump:()=>JSON.stringify([...values])};};
class Clock{
 constructor(){this.now=initial;this.next=1;this.timers=new Map();}
 set=(fn,ms)=>{const id=this.next++;this.timers.set(id,{fn,due:this.now+ms});return id;};
 clear=id=>this.timers.delete(id);
 async advance(ms){
  const end=this.now+ms;
  for(let i=0;i<40;i++){
   const entries=[...this.timers.entries()].filter(([,v])=>v.due<=end).sort((a,b)=>a[1].due-b[1].due);
   if(!entries.length)break;
   const [id,x]=entries[0];this.timers.delete(id);this.now=x.due;
   await x.fn();await tick();
  }
  this.now=end;await tick();
 }
}
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
const game=(revision=0,clock=new Clock(),phase='InitialPeek',confirmed=[],completed=false)=>{
 const player=(accountId,seat)=>({account_id:accountId,username:seat===0?'Alice':'Bob',
  seat_index:seat,hand_cards:[0,1,2,3].map(position=>({position,face_up:false})),
  initial_peek_completed:seat===0?completed:false,
  initial_peek_confirmed_positions:seat===0?confirmed:[]});
 return {id,room_id:roomId,state:'Playing',phase,viewer_account_id:me,
  players:[player(me,0),player(bob,1)],draw_pile:{card_count:43},discard_pile:{card_count:1,top_card_value:5},
  active_turn:phase==='PlayerTurn'?{id:'123e4567-e89b-12d3-a456-426614174333',turn_number:1,acting_account_id:bob,
   started_at:deadline,deadline_at:new Date(initial+135000).toISOString()}:null,
  initial_peek_deadline_at:phase==='InitialPeek'?deadline:null,
  server_time:new Date(clock.now).toISOString(),schema_version:1,state_revision:revision};
};
function setup({api,clock=new Clock(),storage=store()}={}){
 const fake={id:null,connects:0,closed:0,opts:null,
  connect(id){this.id=id;this.connects++;return true;},
  reconnect(id){this.id=id;this.connects++;return true;},
  close(){this.id=null;this.closed++;},
  get gameId(){return this.id;},
  open(){this.opts.onOpen(this.id);},
  changed(){this.opts.onChanged(this.id);},
  disconnect(){this.opts.onClosed(this.id);}
 };
 const controller=createRealGameState({api,storage,createSocket:opts=>{fake.opts=opts;return fake;},
  getAccountId:()=>me,uuid:()=>requestId,now:()=>clock.now,
  setTimeoutFn:clock.set,clearTimeoutFn:clock.clear,random:()=>1});
 return {controller,socket:fake,storage,clock};
}
test('Game locator is verified via GET before rendering and never contains secret values',async()=>{
 const clock=new Clock(),storage=store();
 const {controller,socket}=setup({clock,storage,api:{
  getGame:async()=>game(0,clock),
  getInitialPeekView:async()=>({game_session_id:id,account_id:me,revealed_cards:[],remaining_peek_count:2,deadline_at:deadline,server_time:new Date(clock.now).toISOString()})
 }});
 assert.equal(await controller.enter(id,{roomId}),true);
 await tick();
 assert.equal(controller.state.gameId,id);
 assert.equal(socket.connects,1);
 assert.equal(controller.state.view.phase,'InitialPeek');
 assert.equal(storage.getItem('cabo.lastRealGameId'),id);
 assert.doesNotMatch(storage.dump(),/revealed_cards|privateCards|value/);
});
test('Accepted Peek shows own private number only inside window; two cards do not auto-End',async()=>{
 const clock=new Clock();let rev=0,positions=[],completed=0;
 const {controller,storage}=setup({clock,api:{
  getGame:async()=>game(rev,clock,'InitialPeek',positions),
  getInitialPeekView:async()=>({game_session_id:id,account_id:me,
   revealed_cards:positions.map(position=>({position,value:position===0?8:10})),
   remaining_peek_count:2-positions.length,deadline_at:deadline,server_time:new Date(clock.now).toISOString()}),
  initialPeek:async(_id,request,pos)=>{assert.equal(request,requestId);positions.push(pos);rev++;return {status:'Accepted',replayed:false,reason:null,peek_result:{position:pos,value:pos===0?8:10,remaining_peek_count:2-positions.length,deadline_at:deadline}};},
  completeInitialPeek:async()=>{completed++;return {status:'Accepted',replayed:false,complete_result:{all_players_completed:false}};}
 }});
 await controller.enter(id,{roomId});await tick();
 assert.equal(await controller.peek(0),true);await tick();
 assert.equal(controller.state.privateCards[0],8);
 let html=realGameMarkup(controller,{id:me});
 assert.match(html,/位置 0 · 8/);
 assert.match(html,/Bob/);
 assert.match(html,/位置 0 · 背面/);
 assert.equal(controller.validPeekPosition(0),false);
 assert.equal(await controller.peek(1),true);await tick();
 assert.equal(controller.canComplete(),true,'two peeks do not automatically End');
 assert.equal(completed,0);
 assert.doesNotMatch(storage.dump(),/"value":8/);
 assert.equal(await controller.complete(),true);
 assert.deepEqual(controller.state.privateCards,{});
 html=realGameMarkup(controller,{id:me});
 assert.doesNotMatch(html,/位置 0 · 8/);
 assert.equal(controller.canComplete(),false);
});
test('unknown command retries original UUID and does not invent a new action',async()=>{
 const clock=new Clock();let calls=0;
 const {controller,storage}=setup({clock,api:{
  getGame:async()=>game(0,clock),
  getInitialPeekView:async()=>({game_session_id:id,account_id:me,revealed_cards:[],remaining_peek_count:2,deadline_at:deadline,server_time:new Date(clock.now).toISOString()}),
  initialPeek:async(_id,uuid,pos)=>{assert.equal(uuid,requestId);assert.equal(pos,0);calls++;if(calls===1)throw Object.assign(new Error('unavailable'),{outcomeUnknown:true});return {status:'Accepted',replayed:true,peek_result:null};}
 }});
 await controller.enter(id,{roomId});await tick();
 assert.equal(await controller.peek(0),false);
 assert.equal(controller.state.pendingCommand.requestId,requestId);
 assert.equal(controller.validPeekPosition(1),false);
 assert.equal(await controller.retryPending(),true);
 assert.equal(calls,2);assert.equal(controller.state.pendingCommand,null);
 assert.equal(storage.getItem('cabo.pendingRealGameCommand'),null);
});
test('deadline immediately clears secret values and only GameView moves to PlayerTurn',async()=>{
 const clock=new Clock();let phase='InitialPeek',rev=2;
 const {controller}=setup({clock,api:{
  getGame:async()=>game(rev,clock,phase,[0]),
  getInitialPeekView:async()=>({game_session_id:id,account_id:me,revealed_cards:[{position:0,value:7}],remaining_peek_count:1,deadline_at:deadline,server_time:new Date(clock.now).toISOString()})
 }});
 await controller.enter(id,{roomId});await tick();
 assert.equal(controller.state.privateCards[0],7);
 await clock.advance(45000);
 assert.deepEqual(controller.state.privateCards,{});
 assert.equal(controller.state.view.phase,'InitialPeek','client timer never advances phase');
 phase='PlayerTurn';rev=3;
 await clock.advance(1500);
 assert.equal(controller.state.view.phase,'PlayerTurn');
 assert.equal(controller.state.privateCards[0],undefined);
 assert.equal(controller.state.deadlineMs,null);
});
test('old lower revision and private results cannot override newer Game state',async()=>{
 const clock=new Clock();let rev=3,resolveOld;
 const {controller,socket}=setup({clock,api:{
  getGame:async()=>rev===4?game(4,clock,'PlayerTurn'):game(3,clock),
  getInitialPeekView:async()=>new Promise(resolve=>resolveOld=resolve)
 }});
 await controller.enter(id,{roomId});
 rev=4;await controller.sync();
 resolveOld({game_session_id:id,account_id:me,revealed_cards:[{position:0,value:10}],remaining_peek_count:1,deadline_at:deadline,server_time:new Date(clock.now).toISOString()});
 await tick();
 assert.equal(controller.state.view.phase,'PlayerTurn');
 assert.deepEqual(controller.state.privateCards,{});
 assert.match(realGameMarkup(controller,{id:me}),/PlayerTurn/);
});
test('pause and logout-like reset immediately clear private data, socket and timers',async()=>{
 const clock=new Clock();
 const {controller,socket,storage}=setup({clock,api:{
  getGame:async()=>game(1,clock,'InitialPeek',[1]),
  getInitialPeekView:async()=>({game_session_id:id,account_id:me,revealed_cards:[{position:1,value:6}],remaining_peek_count:1,deadline_at:deadline,server_time:new Date(clock.now).toISOString()})
 }});
 await controller.enter(id,{roomId});await tick();
 assert.equal(controller.state.privateCards[1],6);
 controller.pause();assert.deepEqual(controller.state.privateCards,{});
 assert.equal(socket.gameId,null);
 controller.reset();
 assert.equal(storage.getItem('cabo.lastRealGameId'),null);
 assert.equal(clock.timers.size,0);
});
