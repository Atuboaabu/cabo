import test from 'node:test';
import assert from 'node:assert/strict';
import { MockGateway } from '../src/mock.js';
import { formatRemaining, assertCompatible, evaluateEvent } from '../src/adapter.js';
const setup = async () => { let now = 100000; const mock = new MockGateway(()=>now); await mock.send('enterDemo'); return {mock,advance:(n)=>{now+=n;},now:()=>now}; };
test('one account cannot create or join second Room and cannot duplicate seat', async()=>{
  const {mock}=await setup(); assert.equal((await mock.send('createRoom')).status,'Accepted');
  assert.equal((await mock.send('joinRoom',{code:'other'})).code,'ROOM_CONFLICT');
  assert.equal((await mock.send('createRoom')).code,'ROOM_CONFLICT');
  assert.equal(mock.snapshot().room.members.filter(m=>m.id==='demo-me').length,1);
});
test('Host cannot Ready, Start requires two and ready non-host',async()=>{
  const {mock}=await setup(); await mock.send('createRoom');
  assert.equal((await mock.send('ready',{ready:true})).status,'Rejected');
  assert.equal((await mock.send('start')).status,'Rejected');
  await mock.send('addDemoMembers');assert.equal((await mock.send('start')).status,'Accepted');
});
test('InitialReveal accepts distinct two, not a third, and does not auto end',async()=>{
  const {mock}=await setup();await mock.send('createRoom');await mock.send('addDemoMembers');await mock.send('start');
  assert.equal((await mock.send('reveal',{index:0})).status,'Accepted');
  assert.equal((await mock.send('reveal',{index:0})).status,'Rejected');
  assert.equal((await mock.send('reveal',{index:2})).status,'Accepted');
  assert.equal(mock.snapshot().game.phase,'InitialReveal');
  assert.equal((await mock.send('reveal',{index:3})).status,'Rejected');
  assert.equal((await mock.send('endReveal')).status,'Accepted');
});
test('secret never appears in ordinary face down slots, expires at original deadline',async()=>{
  const {mock,advance}=await setup();await mock.send('createRoom');await mock.send('addDemoMembers');await mock.send('start');
  await mock.send('reveal',{index:0});let v=mock.snapshot();
  assert.equal(v.privateResult.value,4);
  assert.equal(Object.hasOwn(v.game.players[0].hand[0],'value'),false);
  assert.equal(Object.hasOwn(v.game.players[1].hand[0],'value'),false);
  advance(46000);v=mock.snapshot();assert.equal(v.privateResult,null);
});
test('expired session rejects commands without deleting room or resetting clock',async()=>{
  const {mock}=await setup();await mock.send('createRoom');await mock.send('addDemoMembers');await mock.send('start');
  const deadline=mock.game.revealDeadline;
  await mock.send('expireSession');assert.equal((await mock.send('reveal',{index:0})).code,'SESSION_EXPIRED');
  assert.equal(mock.room.state,'Playing');assert.equal(mock.game.revealDeadline,deadline);
});
test('takeover blocks old connection, preserves original turn deadline',async()=>{
  const {mock}=await setup();await mock.send('createRoom');await mock.send('addDemoMembers');await mock.send('start');await mock.send('endReveal');
  const deadline=mock.game.turnDeadline;
  await mock.send('takeover');assert.equal((await mock.send('draw')).code,'CONNECTION_REPLACED');
  await mock.send('reclaim');assert.equal(mock.game.turnDeadline,deadline);
});
test('Playing blocks ordinary account change and Leave',async()=>{
  const {mock}=await setup();await mock.send('createRoom');await mock.send('addDemoMembers');await mock.send('start');
  assert.equal((await mock.send('changeName',{name:'changed'})).code,'PLAYING_LOCK');
  assert.equal((await mock.send('deleteAccount')).code,'PLAYING_LOCK');
  assert.equal((await mock.send('leave')).status,'Rejected');
});
test('delete requires Leave; Leave is not undone by failed deletion',async()=>{
  const {mock}=await setup();await mock.send('createRoom');
  assert.equal((await mock.send('deleteAccount')).code,'ROOM_CONFLICT');
  assert.equal((await mock.send('leave')).status,'Accepted');
  assert.equal((await mock.send('deleteAccount')).code,'MOCK_LIMIT');
  assert.equal(mock.snapshot().room,null);
});
test('duplicate request identity returns same result without applying twice',async()=>{
  const {mock}=await setup();const a=await mock.send('createRoom',{},'request-1');
  assert.equal(a.status,'Accepted');assert.deepEqual(await mock.send('createRoom',{},'request-1'),a);
  assert.equal(mock.snapshot().room.id,'42');
  assert.equal((await mock.send('joinRoom',{code:'2'},'request-1')).code,'CONFLICT');
});
test('deadline formatting reads absolute server timestamp',()=>{assert.equal(formatRemaining(190000,100000),'01:30');assert.equal(formatRemaining(100000,190000),'00:00');});
test('unknown semantic version stops work; event cannot replace View',()=>{assert.throws(()=>assertCompatible({semanticVersion:2}));assert.equal(evaluateEvent({semanticVersion:1,sequence:9},1),'resync');});

test('registration requires numeric code and cannot create account in Mock', async()=>{
 const mock=new MockGateway();
 assert.equal((await mock.send('register',{email:'person@example.com',password:'secret'})).code,'INVALID_INPUT');
 assert.equal((await mock.send('register',{email:'person@example.com',nickname:'小竹',password:'secret',code:'not-numeric'})).code,'INVALID_INPUT');
 assert.equal((await mock.send('register',{email:'person@example.com',password:'secret',code:'123456'})).code,'INVALID_INPUT');
 assert.equal((await mock.send('register',{email:'person@example.com',nickname:'   ',password:'secret',code:'123456'})).code,'INVALID_INPUT');
 assert.equal((await mock.send('register',{email:'person@example.com',nickname:'小竹',password:'secret',code:'123456'})).code,'MOCK_LIMIT');
 assert.equal(mock.snapshot().account,null);
 assert.equal(mock.snapshot().session,'expired');
 assert.equal((await mock.send('createRoom')).code,'SESSION_EXPIRED');
});
test('request code never claims mail sent or produces credentials', async()=>{
 const mock=new MockGateway();
 assert.equal((await mock.send('requestRegistrationCode',{email:'bad'})).code,'INVALID_INPUT');
 const result=await mock.send('requestRegistrationCode',{email:'person@example.com'});
 assert.equal(result.status,'Rejected');
 assert.equal(result.code,'MOCK_LIMIT');
 assert.equal(mock.snapshot().account,null);
 assert.equal(mock.snapshot().room,null);
});
test('login is not a bypass for pending email verification',async()=>{
 const mock=new MockGateway();
 assert.equal((await mock.send('login',{email:'person@example.com',password:'secret'})).code,'MOCK_LIMIT');
 assert.equal(mock.snapshot().session,'expired');
 assert.equal((await mock.send('enterDemo')).status,'Accepted');
 assert.equal(mock.snapshot().account.email,'demo@example.invalid');
 assert.equal(mock.snapshot().account.verified,true);
});

test('login UI offers registration and recovery only; other auth screens return to login',async()=>{
 const {readFileSync}=await import('node:fs');
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/\[\['register','注册账号'\],\['forgot','忘记密码？'\]\]/);
 assert.match(app,/\[\['login','返回登录'\]\]/);
 assert.match(app,/name="nickname" required/);
 assert.match(app,/api\.register\(\{nickname:data\.nickname/);
});

test('registration password confirmation must match and never gets sent as credentials', async()=>{
 const { passwordsMatch } = await import('../src/registration.js');
 assert.equal(passwordsMatch('password123','password123'),true);
 assert.equal(passwordsMatch('password123','password321'),false);
 assert.equal(passwordsMatch('password123',''),false);
 assert.equal(passwordsMatch('',''),false);
 const { readFileSync } = await import('node:fs');
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/name="confirmPassword" required/);
 assert.match(app,/!passwordsMatch\(p\.password,p\.confirmPassword\)/);
 assert.match(app,/setCustomValidity\('两次输入的密码不一致'\)/);
 assert.match(app,/api\.register\(\{nickname:data\.nickname,email:data\.email,password:data\.password,code:data\.code\}\)/);
});

test('registration shows concise verification label without repeated demo guidance', async()=>{
 const { readFileSync } = await import('node:fs');
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 assert.match(app,/<label for="registration-code">验证码<\/label>/);
 assert.doesNotMatch(app,/<label for="registration-code">邮箱数字验证码<\/label>/);
 assert.doesNotMatch(app,/当前 Mock 无法真正发送邮件或注册账号/);
 assert.match(app,/data-action="requestRegistrationCode"/);
 assert.match(app,/进入本地 Mock 演示/);
 assert.match(app,/MOCK · 受限演示/);
});

test('AUTH-18-R1: registration name is required and demo collisions never create an account', async()=>{
 const mock=new MockGateway();
 const base={email:'person@example.com',password:'test-secret',code:'123456'};
 assert.equal((await mock.send('register',base)).code,'INVALID_INPUT');
 assert.equal((await mock.send('register',{...base,nickname:'  '})).code,'INVALID_INPUT');
 const conflict=await mock.send('register',{...base,nickname:'小林'});
 assert.equal(conflict.code,'DEMO_NAME_CONFLICT');
 assert.match(conflict.message,/演示/);
 assert.equal((await mock.send('register',{...base,nickname:'自由名字'})).code,'MOCK_LIMIT');
 assert.equal(mock.snapshot().account,null);
 assert.equal(mock.snapshot().room,null);
});

test('AUTH-18-R1: demo name collision rejects rename without altering account or room', async()=>{
 const {mock}=await setup();
 const original=mock.snapshot().account.name;
 await mock.send('createRoom');await mock.send('addDemoMembers');
 const roomId=mock.snapshot().room.id;
 const result=await mock.send('changeName',{name:'小林'});
 assert.equal(result.code,'DEMO_NAME_CONFLICT');
 assert.match(result.message,/并非全局查询/);
 const view=mock.snapshot();
 assert.equal(view.account.name,original);
 assert.equal(view.room.id,roomId);
 assert.equal(view.room.members.find(m=>m.id==='demo-me').name,original);
 assert.equal(view.room.members.find(m=>m.id==='demo-lin').name,'小林');
});

test('AUTH-18-R1: arbitrary rename does not claim global uniqueness in Mock', async()=>{
 const {mock}=await setup();
 const original=mock.snapshot().account.name;
 const result=await mock.send('changeName',{name:'没被演示席位使用的名字'});
 assert.equal(result.code,'MOCK_LIMIT');
 assert.match(result.message,/更名未生效/);
 assert.equal(mock.snapshot().account.name,original);
 assert.equal((await mock.send('changeName',{name:'  '})).code,'INVALID_INPUT');
 assert.equal((await mock.send('changeName',{name:original})).code,'UNCHANGED');
});

test('AUTH-18-R1: Playing forbids rename and cannot change player identity or deadline',async()=>{
 const {mock}=await setup();
 await mock.send('createRoom');await mock.send('addDemoMembers');await mock.send('start');
 const before=mock.snapshot(),deadline=before.game.deadline;
 assert.equal((await mock.send('changeName',{name:'小林'})).code,'PLAYING_LOCK');
 assert.equal(mock.snapshot().account.name,before.account.name);
 assert.equal(mock.snapshot().game.players.find(m=>m.id==='demo-me').name,before.account.name);
 assert.equal(mock.snapshot().game.deadline,deadline);
 assert.equal(mock.snapshot().game.players.find(m=>m.id==='demo-me').id,'demo-me');
});

test('AUTH-18-R1: UI and README contain no duplicate-name or unverified-play claims',async()=>{
 const {readFileSync}=await import('node:fs');
 const app=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
 const readme=readFileSync(new URL('../README.md',import.meta.url),'utf8');
 const mock=readFileSync(new URL('../src/mock.js',import.meta.url),'utf8');
 assert.match(app,/注册名（游戏展示名）/);
 assert.match(app,/新名称必须全局唯一/);
 assert.match(app,/未验证（需完成验证）/);
 assert.doesNotMatch(app,/未验证（仍可参与游戏）/);
 assert.doesNotMatch(mock,/重名合法/);
 assert.doesNotMatch(readme,/non-unique display label/);
 assert.match(readme,/AUTH-18-R1/);
});
