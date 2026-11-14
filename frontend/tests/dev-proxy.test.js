import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function listen(server) {
 return new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve(server.address().port);});
 });
}
async function findPort(){
 const server=createServer();
 const port=await listen(server);
 await new Promise(resolve=>server.close(resolve));
 return port;
}
async function startProxy(backendUrl,port){
 const child=spawn(process.execPath,['scripts/dev-server.mjs'],{
  cwd:root,env:{...process.env,PORT:String(port),CABO_BACKEND_URL:backendUrl},stdio:['ignore','pipe','pipe']
 });
 await Promise.race([
  new Promise((resolve,reject)=>{
   child.stdout.on('data',chunk=>{if(chunk.toString().includes('CABO frontend:'))resolve();});
   child.once('exit',code=>reject(Error('Proxy terminated: '+code)));
  }),
  new Promise((_,reject)=>setTimeout(()=>reject(Error('Proxy start timeout')),5000))
 ]);
 return child;
}
test('development proxy preserves auth Cookie, Origin, status and separate Set-Cookie headers',async(t)=>{
 const received=[];
 const backend=createServer(async(req,res)=>{
  const chunks=[];
  for await(const chunk of req)chunks.push(chunk);
  received.push({method:req.method,path:req.url,origin:req.headers.origin,cookie:req.headers.cookie,body:Buffer.concat(chunks).toString()});
  if(req.url==='/auth/login'){
   res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':[
    'session_token=opaque; HttpOnly; Path=/; SameSite=Lax',
    'cookie_two=value; HttpOnly; Path=/; SameSite=Lax'
   ]});
   res.end(JSON.stringify({id:'i',username:'Alice',email:'alice@example.com',created_at:'2026-11-13T00:00:00Z'}));
  }else if(req.url==='/auth/me'){
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({id:'i',username:'Alice',email:'alice@example.com',created_at:'2026-11-13T00:00:00Z'}));
  }else if(req.url==='/auth/logout'){
   res.writeHead(204,{'Set-Cookie':'session_token=; HttpOnly; Max-Age=0; Path=/'});
   res.end();
  }else if(req.url==='/auth/register'){
   res.writeHead(409,{'Content-Type':'application/json'});
   res.end(JSON.stringify({code:'EMAIL_ALREADY_REGISTERED'}));
  }else if(req.url==='/auth/verification-codes'){
   res.writeHead(202);res.end();
  }else{res.writeHead(404);res.end();}
 });
 const backendPort=await listen(backend);
 t.after(()=>new Promise(resolve=>backend.close(resolve)));
 const port=await findPort();
 const child=await startProxy('http://127.0.0.1:'+backendPort,port);
 t.after(()=>{child.kill();});
 const base='http://127.0.0.1:'+port;
 const origin='http://localhost:5173';
 const login=await fetch(base+'/auth/login',{
  method:'POST',
  headers:{Origin:origin,'Content-Type':'application/json'},
  body:JSON.stringify({email:'alice@example.com',password:'secret'})
 });
 assert.equal(login.status,200);
 assert.deepEqual(login.headers.getSetCookie(),[
  'session_token=opaque; HttpOnly; Path=/; SameSite=Lax',
  'cookie_two=value; HttpOnly; Path=/; SameSite=Lax'
 ]);
 assert.equal(received.at(-1).origin,origin);
 assert.deepEqual(JSON.parse(received.at(-1).body),{email:'alice@example.com',password:'secret'});
 const me=await fetch(base+'/auth/me',{headers:{Cookie:'session_token=opaque'}});
 assert.equal(me.status,200);
 assert.equal(received.at(-1).cookie,'session_token=opaque');
 assert.equal(received.at(-1).method,'GET');
 const logout=await fetch(base+'/auth/logout',{method:'POST',headers:{Cookie:'session_token=opaque',Origin:origin}});
 assert.equal(logout.status,204);
 assert.equal(logout.headers.getSetCookie().length,1);
 assert.equal(received.at(-1).origin,origin);
 assert.equal(received.at(-1).cookie,'session_token=opaque');
 const forbidden=await fetch(base+'/auth/login',{method:'GET'});
 assert.equal(forbidden.status,405);
 const conflict=await fetch(base+'/auth/register',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});
 assert.equal(conflict.status,409);
 assert.equal((await conflict.json()).code,'EMAIL_ALREADY_REGISTERED');
 const code=await fetch(base+'/auth/verification-codes',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}});
 assert.equal(code.status,202);
 const large=await fetch(base+'/auth/login',{method:'POST',headers:{Origin:origin},body:'x'.repeat(65537)});
 assert.equal(large.status,413);
});

test('Room proxy strict methods/UUIDs, POST+PUT Origin, Cookie, body and Auth regression',async(t)=>{
 const room='123e4567-e89b-12d3-a456-426614174000';
 const account='123e4567-e89b-12d3-a456-426614174001';
 const received=[];
 const backend=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  received.push({method:req.method,path:req.url,origin:req.headers.origin,cookie:req.headers.cookie,body:Buffer.concat(chunks).toString()});
  const path=req.url;
  if(path==='/auth/me'){
   res.writeHead(401,{'Content-Type':'application/json'});
   res.end(JSON.stringify({code:'INVALID_COOKIE'}));return;
  }
  if(path==='/rooms'){
   res.writeHead(201,{'Content-Type':'application/json','Set-Cookie':[
    'session_token=one; HttpOnly; Path=/',
    'aux=two; HttpOnly; Path=/'
   ]});
   res.end(JSON.stringify({id:room,room_code:'ABC234',host_account_id:account,state:'Lobby'}));return;
  }
  if(path==='/rooms/'+room+'/ready'){
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({account_id:account,is_ready:true}));return;
  }
  if(path==='/rooms/'+room){
   res.writeHead(200,{'Content-Type':'application/json'});
   res.end(JSON.stringify({id:room,room_code:'ABC234',host_account_id:account,state:'Lobby',members:[]}));return;
  }
  if(path==='/rooms/'+room+'/leave'||path==='/rooms/'+room+'/members/'+account+'/kick'||path==='/rooms/'+room+'/disband'){
   res.writeHead(204);res.end();return;
  }
  if(path==='/rooms/join'){
   res.writeHead(409,{'Content-Type':'application/json'});
   res.end(JSON.stringify({code:'ROOM_IS_FULL'}));return;
  }
  res.writeHead(404);res.end();
 });
 const upstreamPort=await listen(backend);
 t.after(()=>new Promise(resolve=>backend.close(resolve)));
 const port=await findPort();
 const child=await startProxy('http://127.0.0.1:'+upstreamPort,port);
 t.after(()=>{child.kill();});
 const base='http://127.0.0.1:'+port;
 const origin='http://localhost:5173';
 const credentials={Origin:origin,Cookie:'session_token=browser-opaque'};
 const created=await fetch(base+'/rooms',{method:'POST',headers:credentials});
 assert.equal(created.status,201);
 assert.equal(received.at(-1).origin,origin);
 assert.equal(received.at(-1).cookie,'session_token=browser-opaque');
 assert.equal(received.at(-1).body,'');
 assert.equal(created.headers.getSetCookie().length,2);
 const joined=await fetch(base+'/rooms/join',{
  method:'POST',headers:{...credentials,'Content-Type':'application/json'},
  body:JSON.stringify({room_code:'ABC234'})
 });
 assert.equal(joined.status,409);
 assert.equal((await joined.json()).code,'ROOM_IS_FULL');
 assert.deepEqual(JSON.parse(received.at(-1).body),{room_code:'ABC234'});
 const ready=await fetch(base+'/rooms/'+room+'/ready',{
  method:'PUT',headers:{...credentials,'Content-Type':'application/json'},
  body:JSON.stringify({ready:true})
 });
 assert.equal(ready.status,200);
 assert.equal(received.at(-1).method,'PUT');
 assert.equal(received.at(-1).origin,origin);
 assert.equal(received.at(-1).cookie,'session_token=browser-opaque');
 assert.deepEqual(JSON.parse(received.at(-1).body),{ready:true});
 const view=await fetch(base+'/rooms/'+room,{headers:{Cookie:'session_token=browser-opaque'}});
 assert.equal(view.status,200);
 assert.equal(received.at(-1).method,'GET');
 assert.equal(received.at(-1).cookie,'session_token=browser-opaque');
 for(const path of ['/rooms/'+room+'/leave','/rooms/'+room+'/members/'+account+'/kick','/rooms/'+room+'/disband']){
  const answer=await fetch(base+path,{method:'POST',headers:credentials});
  assert.equal(answer.status,204);
  assert.equal(received.at(-1).body,'');
  assert.equal(received.at(-1).origin,origin);
 }
 const count=received.length;
 const rejected=[
  ['/rooms/'+room+'/ready','POST',405],
  ['/rooms/'+room,'PUT',405],
  ['/rooms/'+room+'/members/'+account+'/kick','DELETE',405],
  ['/rooms/not-a-uuid','GET',404],
  ['/rooms/'+room+'/members/not-uuid/kick','POST',404],
  ['/rooms/'+room+'/other','POST',404],
  ['/rooms/anything/extra','GET',404],
  ['/roomsX','POST',405]
 ];
 for(const [path,method,status] of rejected){
  const answer=await fetch(base+path,{method});
  assert.equal(answer.status,status,method+' '+path);
 }
 assert.equal(received.length,count,'Rejected routes must not reach FastAPI');
 const auth=await fetch(base+'/auth/me',{headers:{Cookie:'session_token=opaque'}});
 assert.equal(auth.status,401);
 assert.equal((await auth.json()).code,'INVALID_COOKIE');
 const oversized=await fetch(base+'/rooms/'+room+'/ready',{
  method:'PUT',headers:credentials,body:'X'.repeat(65537)
 });
 assert.equal(oversized.status,413);
});
