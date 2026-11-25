import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameApi,GameApiError,validGameView} from '../src/game-api.js';
const id='123e4567-e89b-12d3-a456-426614174100',roomId='123e4567-e89b-12d3-a456-426614174000';
const alice='123e4567-e89b-12d3-a456-426614174001',bob='123e4567-e89b-12d3-a456-426614174002';
const req='123e4567-e89b-12d3-a456-426614174777';
export const gameView={
 id,room_id:roomId,state:'Playing',phase:'InitialPeek',viewer_account_id:alice,
 schema_version:1,state_revision:1,
 server_time:'2026-11-25T10:00:00Z',initial_peek_deadline_at:'2026-11-25T10:00:45Z',
 players:[
 {account_id:alice,username:'Alice',seat_index:0,hand_cards:[0,1,2,3].map(position=>({position,face_up:false})),initial_peek_completed:false,initial_peek_confirmed_positions:[]},
 {account_id:bob,username:'Bob',seat_index:1,hand_cards:[0,1,2,3].map(position=>({position,face_up:false})),initial_peek_completed:false,initial_peek_confirmed_positions:[]}
 ],draw_pile:{card_count:43},discard_pile:{card_count:1,top_card_value:7},active_turn:null
};
const fake=(body,status=200)=>({status,async json(){return body;}});
test('GameView validation enforces schema and hiding for face-down cards',()=>{
 assert.equal(validGameView(gameView),true);
 assert.equal(validGameView({...gameView,schema_version:2}),false);
 assert.equal(validGameView({...gameView,players:[{...gameView.players[0],hand_cards:[{position:0,face_up:false,value:8}]},gameView.players[1]]}),false);
});
test('Game API uses correct URL, HttpOnly credentials and no response caching',async()=>{
 const calls=[];
 const api=createGameApi({baseUrl:'http://localhost:5173',fetchImpl:async(url,init)=>{calls.push({url,init});return fake(gameView);}});
 assert.deepEqual(await api.getGame(id),gameView);
 assert.equal(calls[0].url,'http://localhost:5173/games/'+id);
 assert.equal(calls[0].init.method,'GET');
 assert.equal(calls[0].init.credentials,'include');
 assert.equal(calls[0].init.cache,'no-store');
 assert.equal(calls[0].init.body,undefined);
});
test('InitialPeek and Complete send exactly original request UUID',async()=>{
 const calls=[];
 const api=createGameApi({fetchImpl:async(url,init)=>{
  calls.push({url,init});return fake(url.endsWith('complete-initial-peek')
   ?{status:'Accepted',replayed:true,reason:null,complete_result:{all_players_completed:false}}
   :{status:'Accepted',replayed:false,reason:null,peek_result:null});
 }});
 assert.equal((await api.initialPeek(id,req,2)).peek_result,null);
 assert.equal((await api.completeInitialPeek(id,req)).complete_result.all_players_completed,false);
 assert.deepEqual(JSON.parse(calls[0].init.body),{request_id:req,position:2});
 assert.deepEqual(JSON.parse(calls[1].init.body),{request_id:req});
 assert.equal(calls[0].init.credentials,'include');
});
test('PrivateView is distinct from GameView and rejects malformed secret data',async()=>{
 const privateView={game_session_id:id,account_id:alice,
  revealed_cards:[{position:1,value:8}],remaining_peek_count:1,
  deadline_at:gameView.initial_peek_deadline_at,server_time:gameView.server_time};
 const api=createGameApi({fetchImpl:async()=>fake(privateView)});
 assert.deepEqual(await api.getInitialPeekView(id),privateView);
 const broken=createGameApi({fetchImpl:async()=>fake({...privateView,revealed_cards:[{position:0,value:14}]})});
 await assert.rejects(broken.getInitialPeekView(id),err=>err.code==='INVALID_RESPONSE');
});
test('Game command network uncertainty is represented without exposing secrets',async()=>{
 const api=createGameApi({fetchImpl:async()=>{throw Error('Cookie: value 12');}});
 await assert.rejects(api.initialPeek(id,req,1),err=>err instanceof GameApiError&&err.outcomeUnknown&&!err.message.includes('Cookie'));
 await assert.rejects(api.getGame(id),err=>!err.outcomeUnknown);
});
