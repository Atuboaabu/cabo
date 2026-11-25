import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealRoomState} from '../src/real-room-state.js';
import {createRealGameState} from '../src/real-game-state.js';
const room='123e4567-e89b-12d3-a456-426614174000',gameId='123e4567-e89b-12d3-a456-426614174100';
const alice='123e4567-e89b-12d3-a456-426614174001',bob='123e4567-e89b-12d3-a456-426614174002';
const members=[{account_id:alice,username:'Alice',seat_index:0,is_host:true,is_ready:false},{account_id:bob,username:'Bob',seat_index:1,is_host:false,is_ready:true}];
const lobby={id:room,room_code:'ABC234',state:'Lobby',host_account_id:alice,members};
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
const gameView=account=>({
 id:gameId,room_id:room,viewer_account_id:account,state:'Playing',phase:'PlayerTurn',
 schema_version:1,state_revision:3,server_time:'2026-11-25T10:01:00Z',
 initial_peek_deadline_at:null,players:members.map(p=>({
  account_id:p.account_id,username:p.username,seat_index:p.seat_index,
  hand_cards:[{position:0,face_up:false}],initial_peek_completed:true,
  initial_peek_confirmed_positions:[]
 })),
 draw_pile:{card_count:40},discard_pile:{card_count:2,top_card_value:7},
 active_turn:{id:'123e4567-e89b-12d3-a456-426614174102',turn_number:1,
  acting_account_id:alice,started_at:'2026-11-25T10:01:00Z',deadline_at:'2026-11-25T10:02:30Z'}
});
const asyncFlush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function games(account,storage,api){
 return createRealGameState({api,storage,getAccountId:()=>account,
  createSocket:()=>({connect:()=>true,reconnect:()=>true,close(){},get gameId(){return gameId;}})});
}
test('Host Start 201 gives actual Game ID, GET Room Playing and authorized GameView',async()=>{
 const storage=store(),reads=[];
 const controller=games(alice,storage,{
  async getGame(id){reads.push(id);return gameView(alice);}
 });
 let activated;
 const rooms=createRealRoomState({
  api:{startGame:async()=>({id:gameId,room_id:room,state:'Playing',started_at:'2026-11-25T10:00:00Z'}),
   getRoom:async()=>({...lobby,state:'Playing'})},
  storage,getAccountId:()=>alice,
  onStartAccepted:id=>controller.remember(id),
  onPlaying:()=>{activated=controller.enter(gameId,{roomId:room});}
 });
 rooms.state.roomId=room;rooms.state.view=lobby;
 assert.equal(await rooms.startGame(),true);
 await activated;
 assert.deepEqual(reads,[gameId]);
 assert.equal(controller.state.gameId,gameId);
 assert.notEqual(controller.state.gameId,rooms.state.roomId);
 assert.equal(controller.state.view.room_id,room);
 assert.equal(storage.getItem('cabo.lastRealGameId'),gameId);
});
test('non-Host cannot infer GameSession ID from Playing Room; explicit ID requires authorized GET',async()=>{
 const storage=store();let requests=0;
 const controller=games(bob,storage,{getGame:async id=>{requests++;assert.equal(id,gameId);return gameView(bob);}});
 const rooms=createRealRoomState({storage,api:{getRoom:async()=>({...lobby,state:'Playing'})},getAccountId:()=>bob});
 storage.setItem('cabo.lastRealRoomId',room);
 await rooms.restore();
 assert.equal(controller.state.gameId,null,'RoomView alone does not identify GameSession');
 assert.equal(requests,0);
 assert.equal(await controller.enter(gameId,{roomId:room}),true);
 assert.equal(requests,1);
 assert.equal(controller.state.view.viewer_account_id,bob);
});
test('GameSession ID is never authorization: rejected GET clears locator',async()=>{
 const storage=store();
 const controller=games(bob,storage,{getGame:async()=>{throw Object.assign(new Error('Forbidden'),{status:403,code:'GAME_NOT_ACCESSIBLE'});}});
 assert.equal(await controller.enter(gameId,{roomId:room}),false);
 assert.equal(controller.state.view,null);
 assert.equal(controller.state.gameId,null);
 assert.equal(storage.getItem('cabo.lastRealGameId'),null);
});
