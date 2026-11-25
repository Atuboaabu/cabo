import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameSocket,gameWebSocketUrl} from '../src/game-ws.js';
const a='123e4567-e89b-12d3-a456-426614174100',b='123e4567-e89b-12d3-a456-426614174101';
class FakeWS{
 static all=[];
 constructor(url){this.url=url;this.closed=false;FakeWS.all.push(this);}
 close(){this.closed=true;}
 open(){this.onopen?.();}
 notify(x){this.onmessage?.({data:typeof x==='string'?x:JSON.stringify(x)});}
 remoteClose(code=1006){this.closed=true;this.onclose?.({code});}
}
test('Game WS URL uses actual FastAPI origin and respects HTTPS',()=>{
 assert.equal(gameWebSocketUrl(a,{CABO_ROOM_WS_BASE_URL:'http://localhost:8000',location:{protocol:'http:'}}),
  'ws://localhost:8000/ws/games/'+a);
 assert.equal(gameWebSocketUrl(a,{CABO_ROOM_WS_BASE_URL:'https://api.example.test',location:{protocol:'https:'}}),
  'wss://api.example.test/ws/games/'+a);
});
test('game.changed only notifies current Game and never transmits private cards',()=>{
 FakeWS.all.length=0;let count=0;
 const ws=createGameSocket({WebSocketImpl:FakeWS,baseUrl:'http://localhost:8000',onChanged:()=>count++});
 assert.equal(ws.connect(a),true);
 const first=FakeWS.all[0];
 first.notify({type:'room.changed',room_id:a});
 first.notify({type:'game.changed',game_session_id:b});
 first.notify('broken');
 first.notify({type:'game.changed',game_session_id:a});
 assert.equal(count,1);
 assert.equal(ws.connect(a),false);
 assert.equal(FakeWS.all.length,1);
});
test('reconnect drops stale WebSocket callbacks; local close does not report kick',()=>{
 FakeWS.all.length=0;let changes=0,closed=0,opened=0;
 const ws=createGameSocket({WebSocketImpl:FakeWS,baseUrl:'http://localhost:8000',
  onChanged:()=>changes++,onClosed:()=>closed++,onOpen:()=>opened++});
 ws.connect(a);const old=FakeWS.all[0],lateClose=old.onclose,lateMessage=old.onmessage;
 ws.reconnect(b);const current=FakeWS.all[1];
 lateClose?.({code:1008});
 lateMessage?.({data:JSON.stringify({type:'game.changed',game_session_id:a})});
 current.open();current.notify({type:'game.changed',game_session_id:b});
 assert.equal(opened,1);assert.equal(changes,1);assert.equal(closed,0);
 current.remoteClose(1006);
 assert.equal(closed,1);
 ws.close();assert.equal(closed,1);
});
