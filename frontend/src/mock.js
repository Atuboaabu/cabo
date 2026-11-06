import { REQUIRED_SEMANTICS } from './adapter.js';

/**
 * A constrained UI demonstration. Not a rule engine or security implementation.
 * All objects returned to UI are fresh, recipient-limited projections.
 * Never use mock account/session/local state to assert backend security.
 */
const membersSeed = [
  { id: 'demo-me', name: '你', host: true, ready: false },
  { id: 'demo-lin', name: '小林', host: false, ready: true },
  { id: 'demo-nan', name: '阿南', host: false, ready: true },
  { id: 'demo-wan', name: '晚风', host: false, ready: true }
];
const sampleHands = {
  'demo-me': [null, null, null, null],
  'demo-lin': [null, null, null, null],
  'demo-nan': [null, null, null, null],
  'demo-wan': [null, null, null, null]
};
const clone = (v) => structuredClone(v);
const fail = (message, code = 'REJECTED') => ({ status: 'Rejected', code, message });
const ok = (message = '操作已确认') => ({ status: 'Accepted', message });
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export class MockGateway {
  constructor(clock = () => Date.now()) {
    this.clock = clock;
    this.account = null;
    this.session = false;
    this.room = null;
    this.game = null;
    this.secret = null;
    this.takeover = false;
    this.connection = true;
    this.sequence = 0;
    this.processed = new Map();
    this.nextRoom = 42;
  }
  snapshot() {
    this.expire();
    const view = {
      semanticVersion: REQUIRED_SEMANTICS,
      sequence: this.sequence,
      account: this.session && this.account ? { id: this.account.id, name: this.account.name, email: this.account.email, verified: this.account.verified } : null,
      session: this.session ? 'valid' : 'expired',
      connection: this.connection ? (this.takeover ? 'taken-over' : 'connected') : 'disconnected',
      room: this.session && this.room ? clone(this.room) : null,
      game: this.session && this.game ? this.projectGame() : null,
      privateResult: this.session && this.connection && !this.takeover && this.secret && this.secret.deadline > this.clock() ? clone(this.secret) : null,
      mode: 'MOCK · 受限演示'
    };
    return view;
  }
  projectGame() {
    const game = this.game;
    return {
      id: game.id, state: game.state, round: game.round,
      phase: game.phase, turnStep: game.step, actingPlayerId: game.acting,
      deadline: game.phase === 'InitialReveal' ? game.revealDeadline : game.turnDeadline,
      abilityDeadline: game.abilityDeadline,
      revealCount: game.revealed.size, revealFinished: game.revealFinished,
      maxReveal: 2, discardTop: game.discardTop, drawCount: game.drawCount,
      players: this.room.members.map((m) => ({ ...m, hand: game.hands[m.id].map(card => card === null ? { faceUp: false } : { faceUp: true, value: card }) })),
      caboCaller: game.caboCaller, finalOrder: [...game.finalOrder],
      drawnValue: game.step === 'card' && game.acting === 'demo-me' ? game.drawn : undefined,
      drawnSource: game.step === 'card' ? game.drawnSource : undefined,
      legalActions: this.legalActions(),
      result: game.result ? clone(game.result) : null,
      lastResult: game.lastResult || null
    };
  }
  legalActions() {
    const g = this.game;
    if (!g || g.state !== 'Playing' || !this.connection || this.takeover || !this.session) return [];
    if (g.phase === 'InitialReveal') return g.revealFinished ? [] : ['reveal', 'endReveal'];
    if (g.phase === 'Settling') return [];
    if (g.acting !== 'demo-me') return [];
    if (g.step === 'action') return ['draw', 'takeDiscard', ...(g.phase === 'Playing' ? ['cabo'] : [])];
    if (g.step === 'card') return ['replace', ...(g.drawnSource === 'draw' ? ['discard', ...(g.drawn >= 7 && g.drawn <= 12 ? ['ability'] : [])] : [])];
    if (g.step === 'ability') return ['endAbility', ...(g.drawn >= 7 && g.drawn <= 10 ? ['targetAbility'] : []), ...(g.drawn >= 7 && g.drawn <= 10 && !g.undoUsed ? ['undoAbility'] : [])];
    return [];
  }
  expire() {
    const g = this.game;
    if (!g || g.state !== 'Playing') return;
    if (g.phase === 'InitialReveal' && this.clock() >= g.revealDeadline) {
      g.revealFinished = true;
      this.secret = null;
      this.openTurn();
    } else if (g.phase !== 'InitialReveal' && g.phase !== 'Settling' && g.turnDeadline && this.clock() >= g.turnDeadline) {
      // Constrained mock avoids guessing complex server defaults. Force a resync-able demo state.
      g.lastResult = '演示时限已到：真实超时默认操作须由 FastAPI 权威处理；此受限 Mock 不模拟复杂自动落牌。';
      g.step = 'waiting';
      this.secret = null;
    } else if (g.step === 'ability' && g.abilityDeadline && this.clock() >= g.abilityDeadline) {
      this.secret = null;
      this.endTurn();
    }
  }
  openTurn() {
    const g = this.game;
    g.phase = 'Playing'; g.step = 'action'; g.acting = 'demo-me';
    g.turnDeadline = this.clock() + 90000;
    g.abilityDeadline = null;
    this.sequence++;
  }
  endTurn() {
    const g = this.game;
    this.secret = null;
    g.step = 'waiting';
    g.acting = 'demo-lin';
    g.turnDeadline = this.clock() + 90000;
    if (g.caboCaller) { g.phase = 'FinalTurns'; g.finalOrder = ['demo-nan','demo-wan']; }
    this.sequence++;
  }
  async send(command, payload = {}, requestId = '') {
    if (requestId && this.processed.has(requestId)) {
      const prior = this.processed.get(requestId);
      return JSON.stringify(prior.command) === JSON.stringify({command,payload}) ? clone(prior.result) : fail('同一请求身份不能用于不同操作', 'CONFLICT');
    }
    let result = this.dispatch(command, payload);
    if (requestId) this.processed.set(requestId, { command: { command, payload: clone(payload) }, result: clone(result) });
    return clone(result);
  }
  dispatch(cmd, p) {
    if (cmd === 'requestRegistrationCode') {
      if (!isEmail(p.email || '')) return fail('请输入有效的邮箱地址', 'INVALID_INPUT');
      // No mail service is connected. A successful-looking fake send is forbidden.
      return fail('Mock 不发送真实验证码。邮件发送与限流需要 FastAPI 支持。', 'MOCK_LIMIT');
    }
    if (cmd === 'register') {
      if (!isEmail(p.email || '') || !p.password || !/^[0-9]+$/.test(p.code || '')) {
        return fail('注册需提供有效邮箱、密码和数字验证码', 'INVALID_INPUT');
      }
      // Do not invent a valid verification code or create an unverified account.
      return fail('需要 FastAPI 验证注册验证码后原子创建 Verified 账号；Mock 不执行注册。', 'MOCK_LIMIT');
    }
    if (cmd === 'login') {
      return fail('Mock 无法验证正式账号的邮箱与密码，请使用独立的演示入口。', 'MOCK_LIMIT');
    }
    if (cmd === 'enterDemo') {
      // An isolated, explicitly marked fixture. Not an authenticated registration.
      this.account = { id: 'demo-account', name: '演示玩家', email: 'demo@example.invalid', verified: true };
      this.session = true; this.takeover = false; this.connection = true;
      return ok('已进入本地演示身份。未进行注册、邮箱验证或真实认证。');
    }
    if (cmd === 'requestRecovery' || cmd === 'requestVerification') return ok('如符合条件，将发送相应邮件；演示模式不会发送真实邮件');
    if (cmd === 'resetPassword' || cmd === 'verifyEmail' || cmd === 'confirmEmail') return fail('此流程需要真实服务器验证一次性凭据；Mock 不授予该权限', 'MOCK_LIMIT');
    if (!this.session) return fail('会话已失效，请重新登录', 'SESSION_EXPIRED');
    if (cmd === 'logout') { this.session = false; this.secret = null; return ok('已退出本次演示会话，Room 资格未被移除'); }
    if (cmd === 'expireSession') { this.session = false; this.secret = null; return ok('会话已失效，游戏时钟不变'); }
    if (cmd === 'disconnect') { this.connection = false; this.secret = null; return ok('连接已断开，成员身份保留'); }
    if (cmd === 'reconnect') { this.connection = true; this.takeover = false; this.secret = null; return ok('已重新同步当前公开视图；过期秘密不恢复'); }
    if (cmd === 'takeover') { this.takeover = true; this.secret = null; return ok('演示：另一个设备已接管当前游戏连接'); }
    if (cmd === 'reclaim') { this.takeover = false; this.connection = true; this.secret = null; return ok('已重新接管并同步当前视图；不恢复旧秘密'); }
    if (cmd === 'createRoom' || cmd === 'joinRoom') {
      if (this.room) return fail('此账号已属于一个 Room，请返回当前房间', 'ROOM_CONFLICT');
      if (cmd === 'joinRoom' && !p.code?.trim()) return fail('请输入 Room 编号');
      this.room = { id: String(cmd === 'joinRoom' ? p.code.trim() : this.nextRoom++), state: 'Lobby', members: cmd === 'joinRoom' ? [{...membersSeed[1],host:true},{...membersSeed[0],host:false},{...membersSeed[2]}] : clone(membersSeed.slice(0,1)) };
      // Joined-room membership is a constrained local scenario; no multi-account network sync.
      this.sequence++; return ok('已进入演示 Room');
    }
    if (cmd === 'clearClosed') {
      if (this.room?.state !== 'Closed') return fail('Room 尚未关闭');
      this.room = null; this.game = null; this.secret = null; this.sequence++; return ok('已返回大厅');
    }
    if (cmd === 'addDemoMembers') {
      if (!this.room || this.room.state !== 'Lobby') return fail('只能在 Lobby 添加演示席位');
      this.room.members = clone(membersSeed); this.sequence++; return ok('已载入演示对手（非真实在线玩家）');
    }
    if (cmd === 'leave') {
      if (!this.room || this.room.state !== 'Lobby') return fail('Playing 阶段无法普通 Leave');
      this.room = null; this.game = null; this.secret = null; this.sequence++; return ok('已正式退出演示 Room（与注销分别处理）');
    }
    if (cmd === 'ready') {
      if (!this.room || this.room.state !== 'Lobby') return fail('当前不能准备');
      const me = this.room.members.find(m => m.id === 'demo-me');
      if (!me || me.host) return fail('Host 不需要 Ready');
      me.ready = !!p.ready; this.sequence++; return ok();
    }
    if (cmd === 'kick' || cmd === 'disband') {
      if (!this.room || !this.room.members.some(m => m.id === 'demo-me' && m.host)) return fail('只有 Host 可执行该操作');
      if (cmd === 'disband') {
        if (this.game?.state === 'Playing') this.abort('ROOM_DISBANDED');
        this.room.state = 'Closed'; this.room.members = [];
      } else {
        if (p.memberId === 'demo-me' || !this.room.members.some(m => m.id === p.memberId)) return fail('无效的 Kick 目标');
        if (this.game?.state === 'Playing') this.abort('PLAYER_KICKED');
        this.room.members = this.room.members.filter(m => m.id !== p.memberId);
        if (this.room.state === 'Lobby') this.room.members.filter(m=>!m.host).forEach(m=>m.ready=false);
      }
      this.secret = null; this.sequence++; return ok(cmd === 'kick' ? '已移除演示成员' : 'Room 已关闭');
    }
    if (cmd === 'start') {
      if (!this.room || this.room.state !== 'Lobby') return fail('只能从 Lobby 开始');
      if (!this.room.members.some(m=>m.id==='demo-me' && m.host)) return fail('只有 Host 可以开始');
      if (this.room.members.length < 2 || this.room.members.length > 4 || this.room.members.some(m=>!m.host && !m.ready)) return fail('需要 2–4 人且所有非 Host Ready');
      if (!this.connection || this.takeover) return fail('当前连接不能发起 Start');
      this.room.state = 'Playing'; this.game = {
        id: 'demo-game', state: 'Playing', round: 1, phase: 'InitialReveal', step: 'initial', acting: null,
        revealDeadline: this.clock() + 45000, turnDeadline: null, abilityDeadline: null,
        revealed: new Set(), revealFinished: false, hands: clone(sampleHands),
        discardTop: 6, drawCount: 35, drawn: null, drawnSource: null,
        caboCaller: null, finalOrder: [], undoUsed: false, lastResult: null, result: null
      }; this.sequence++; return ok('InitialReveal 已开启，45 秒共享窗口');
    }
    if (cmd === 'completeDemoGame') {
      if (!this.game || this.game.state !== 'Playing') return fail('没有正在进行的游戏');
      // Showcase only: result intentionally labeled as non-authoritative illustrative data.
      this.game.state = 'Completed'; this.game.phase = 'Completed'; this.game.step = 'done'; this.game.result = { illustrative: true, scores: [{id:'demo-me',score:12},{id:'demo-lin',score:19},{id:'demo-nan',score:27},{id:'demo-wan',score:35}], winners:['demo-me'] };
      this.room.state = 'Lobby'; this.room.members.filter(m=>!m.host).forEach(m=>m.ready=false);
      this.secret = null; this.sequence++; return ok('已进入示意结算页（不代表真实 CABO 计分）');
    }
    if (cmd === 'changeName' || cmd === 'changeEmail' || cmd === 'changePassword' || cmd === 'deleteAccount') {
      if (this.room?.state === 'Playing') return fail('正在游戏中，禁止普通账号设置', 'PLAYING_LOCK');
      if (cmd === 'deleteAccount' && this.room && this.room.state !== 'Closed') return fail('必须先合法 Leave 当前 Room，再单独提交注销', 'ROOM_CONFLICT');
      if (cmd === 'changeName') { if (!p.name?.trim()) return fail('展示名不能为空'); this.account.name = p.name.trim(); this.sequence++; return ok('演示展示名已更新（重名合法）'); }
      return fail('敏感账号变更需要真实服务端重新认证和验证；Mock 不执行', 'MOCK_LIMIT');
    }
    if (!this.room || !this.game || this.game.state !== 'Playing') return fail('当前没有可操作的游戏');
    if (!this.connection || this.takeover) return fail('当前游戏连接已失效，请重新接管', 'CONNECTION_REPLACED');
    const g = this.game;
    if (cmd === 'reveal') {
      if (g.phase !== 'InitialReveal' || g.revealFinished || g.revealed.size >= 2 || !Number.isInteger(p.index) || p.index < 0 || p.index >= 4 || g.revealed.has(p.index) || this.clock() >= g.revealDeadline) return fail('初始查看目标或次数不合法');
      g.revealed.add(p.index); this.secret = { purpose:'initial', position:p.index, value:[4,9,2,11][p.index], deadline:g.revealDeadline }; this.sequence++; return ok('仅在当前初始查看窗口临时展示该牌');
    }
    if (cmd === 'endReveal') {
      if (g.phase !== 'InitialReveal' || g.revealFinished) return fail('查看窗口已关闭');
      g.revealFinished = true; this.secret = null; this.openTurn(); return ok('已结束个人初始查看；演示其余成员已完成查看');
    }
    if (g.phase === 'InitialReveal' || g.step === 'waiting') return fail('不是当前可操作的回合');
    if (this.clock() >= g.turnDeadline) return fail('本回合权威截止已过');
    if (cmd === 'draw' || cmd === 'takeDiscard') {
      if (g.step !== 'action') return fail('当前回合已经选过取牌来源');
      g.drawnSource = cmd === 'draw' ? 'draw' : 'discard';
      g.drawn = cmd === 'draw' ? 9 : g.discardTop;
      if (cmd === 'draw') g.drawCount--;
      g.step = 'card'; this.sequence++; return ok('已进入当前牌决策');
    }
    if (cmd === 'discard') {
      if (g.step !== 'card' || g.drawnSource !== 'draw') return fail('弃牌堆取牌必须 Replace');
      g.discardTop = g.drawn; this.endTurn(); return ok('演示弃牌已确认');
    }
    if (cmd === 'replace') {
      if (g.step !== 'card') return fail('当前没有待 Replace 的牌');
      if (!Array.isArray(p.positions) || p.positions.length !== 1 || !Number.isInteger(p.positions[0]) || p.positions[0] < 0 || p.positions[0] >= g.hands['demo-me'].length) return fail('当前 Mock 仅支持单张 Replace；多牌需正式服务器裁决', 'MOCK_LIMIT');
      const i = p.positions[0];
      g.hands['demo-me'][i] = g.drawnSource === 'discard' ? g.drawn : null;
      g.discardTop = 4; // illustrative old-card public value, NOT inferred from hidden UI card
      this.endTurn(); return ok('单张 Replace 演示已确认');
    }
    if (cmd === 'ability') {
      if (g.step !== 'card' || g.drawnSource !== 'draw' || g.drawn < 7 || g.drawn > 12) return fail('此牌不能发动能力');
      g.discardTop = g.drawn; g.step = 'ability'; g.abilityDeadline = g.drawn <= 10 ? Math.min(this.clock()+15000,g.turnDeadline) : g.turnDeadline; this.sequence++;
      return ok(g.drawn <= 10 ? '能力窗口从本次弃牌正式确认起计 15 秒' : 'Swap 目标选择受原 Turn 截止约束');
    }
    if (cmd === 'undoAbility') {
      if (g.step !== 'ability' || g.drawn > 10 || g.undoUsed || this.clock() >= g.abilityDeadline) return fail('不具备该次 Undo 资格');
      g.undoUsed = true; g.step = 'card'; g.abilityDeadline = null; g.discardTop = 6; this.secret = null; this.sequence++; return ok('已单独确认 Undo；原弃牌的正式结果不被改写');
    }
    if (cmd === 'endAbility') { if (g.step !== 'ability') return fail('能力阶段未开启'); this.endTurn(); return ok('能力窗口已关闭'); }
    if (cmd === 'targetAbility') return fail('当前 Mock 不模拟秘密目标的服务器授权和 Swap 原子提交', 'MOCK_LIMIT');
    if (cmd === 'cabo') {
      if (g.phase !== 'Playing' || g.step !== 'action') return fail('只有普通 Turn 起点可呼叫 CABO');
      g.caboCaller = 'demo-me'; g.phase = 'FinalTurns'; g.step = 'waiting'; g.acting = 'demo-lin'; g.finalOrder = this.room.members.filter(m=>m.id!=='demo-me').map(m=>m.id);
      g.turnDeadline = this.clock()+90000; this.sequence++; return ok('已进入 FinalTurns；演示不自动裁决其他玩家回合');
    }
    return fail('未知或当前 Mock 未覆盖的命令', 'MOCK_LIMIT');
  }
  abort(reason) {
    if (this.game?.state !== 'Playing') return;
    this.game.state = 'Aborted'; this.game.phase = 'Aborted'; this.game.step = 'done';
    this.game.result = { reason, winners: [], scores: [] };
    this.room.state = 'Lobby';
  }
}
export const gateway = new MockGateway();
