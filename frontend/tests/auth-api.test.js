import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthApi, getAuthApiBaseUrl, AuthApiError } from '../src/auth-api.js';
import { readFileSync } from 'node:fs';
const response=(status,body=null)=>({status,async json(){if(body===null)throw Error('no JSON');return body;}});
const account={id:'00000000-0000-4000-8000-000000000001',username:'Alice',email:'alice@example.com',created_at:'2026-11-11T00:00:00Z'};
test('verification-code endpoint and request body are exact; HTTP 202 is accepted',async()=>{
 let captured;
 const api=createAuthApi({baseUrl:'http://localhost:8000',fetchImpl:async(url,init)=>{captured={url,init};return response(202);}});
 assert.deepEqual(await api.requestRegistrationCode('alice@example.com'),{accepted:true});
 assert.equal(captured.url,'http://localhost:8000/auth/verification-codes');
 assert.deepEqual(JSON.parse(captured.init.body),{email_address:'alice@example.com',purpose:'registration'});
 assert.equal(captured.init.method,'POST');
 assert.equal(captured.init.credentials,'omit');
 assert.equal(captured.init.cache,'no-store');
});
test('registration sends expected field mapping without confirm password or creating a session',async()=>{
 let captured;
 const api=createAuthApi({fetchImpl:async(url,init)=>{captured={url,init};return response(201,account);}});
 assert.deepEqual(await api.register({nickname:'Alice',email:'alice@example.com',password:'your-password',code:'012345',confirmPassword:'your-password'}),account);
 assert.equal(captured.url,'http://localhost:8000/auth/register');
 assert.deepEqual(JSON.parse(captured.init.body),{username:'Alice',email:'alice@example.com',password:'your-password',verification_code:'012345'});
 assert.ok(!captured.init.body.includes('confirmPassword'));
});
test('HTTP 409 provides backend-specific conflict guidance',async()=>{
 for(const [code,part] of [['USERNAME_TAKEN','注册名'],['EMAIL_ALREADY_REGISTERED','邮箱']]){
  const api=createAuthApi({fetchImpl:async()=>response(409,{code})});
  await assert.rejects(api.register({nickname:'x',email:'e',password:'secret',code:'123456'}),error=>
   error instanceof AuthApiError && error.status===409 && error.code===code && error.message.includes(part));
 }
});
test('HTTP 429, 503, and expired verification code yield actionable guidance',async()=>{
 const cases=[[429,'VERIFICATION_CODE_RATE_LIMIT','频繁'],[503,'EMAIL_SEND_ERROR','发送失败'],[400,'INVALID_VERIFICATION_CODE','过期']];
 for(const [status,code,word] of cases){
  const api=createAuthApi({fetchImpl:async()=>response(status,{code})});
  const action=code==='INVALID_VERIFICATION_CODE'?api.register({nickname:'x',email:'e',password:'p',code:'0'}):api.requestRegistrationCode('e');
  await assert.rejects(action,error=>error.status===status && error.code===code && error.message.includes(word));
 }
});
test('generic HTTP validation, malformed error, network outage do not leak server detail',async()=>{
 let api=createAuthApi({fetchImpl:async()=>response(422,{detail:[{msg:'secret & specific'}]})});
 await assert.rejects(api.register({nickname:'x',email:'e',password:'p',code:'0'}),error=>error.status===422&&!error.message.includes('secret'));
 api=createAuthApi({fetchImpl:async()=>response(500,{detail:'password=foo'})});
 await assert.rejects(api.requestRegistrationCode('e'),error=>error.status===500&&!error.message.includes('password=foo'));
 api=createAuthApi({fetchImpl:async()=>{throw Error('request body password: super-secret');}});
 await assert.rejects(api.requestRegistrationCode('e'),error=>error.code==='NETWORK_ERROR'&&!error.message.includes('super-secret'));
});
test('HTTP success status must match exactly; malformed 201 Account is not treated as confirmed registration',async()=>{
 let api=createAuthApi({fetchImpl:async()=>response(200,{})});
 await assert.rejects(api.requestRegistrationCode('a'),error=>error.status===200);
 api=createAuthApi({fetchImpl:async()=>response(201,{username:'Alice'})});
 await assert.rejects(api.register({nickname:'a',email:'a',password:'a',code:'1'}),error=>error.code==='INVALID_RESPONSE');
});
test('API base URL is configurable and excludes credentials / unsafe schemes',()=>{
 assert.equal(getAuthApiBaseUrl({}),'http://localhost:8000');
 assert.equal(getAuthApiBaseUrl({CABO_API_BASE_URL:'https://dev.cabo.example/'}),'https://dev.cabo.example');
 for(const value of ['javascript:alert(1)','https://user:pass@example.com/','https://api.example.com/auth','https://example.com/?token=x']){
  assert.throws(()=>getAuthApiBaseUrl({CABO_API_BASE_URL:value}));
 }
});
test('app keeps Mock demo separate from real registration and shows return to login',()=>{
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/api\.requestRegistrationCode\(email\.value\)/);
 assert.match(app,/api\.register\(\{nickname:data\.nickname/);
 assert.match(app,/authMode='registered'/);
 assert.match(app,/账号已创建，请返回登录页面/);
 assert.match(app,/进入本地 Mock 演示/);
 assert.doesNotMatch(app,/gateway\.send\('register'/);
 assert.doesNotMatch(app,/gateway\.send\('requestRegistrationCode'/);
});

test('registered email reports explicit already-registered message',async()=>{
 const api=createAuthApi({fetchImpl:async()=>response(409,{code:'EMAIL_ALREADY_REGISTERED'})});
 await assert.rejects(
   api.register({nickname:'Alice',email:'alice@example.com',password:'test-secret',code:'012345'}),
   error=>error instanceof AuthApiError && error.status===409 &&
     error.code==='EMAIL_ALREADY_REGISTERED' &&
     error.message==='该邮箱已注册，请直接登录或使用其他邮箱注册。'
 );
});

test('taken nickname displays the agreed Chinese message',async()=>{
 const api=createAuthApi({fetchImpl:async()=>response(409,{code:'USERNAME_TAKEN'})});
 await assert.rejects(api.register({nickname:'Alice',email:'alice@example.com',password:'secret',code:'123456'}),
  error=>error instanceof AuthApiError && error.status===409 && error.code==='USERNAME_TAKEN' && error.message==='该昵称已被占用，请更换昵称。');
});
