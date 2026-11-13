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
