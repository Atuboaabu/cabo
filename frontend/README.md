# CABO · Frontend Milestone 1

基于 React + TypeScript 的可运行前端演示，遵循根目录 `AGENTS.md` 及已冻结的 Phase 4 业务/可见性语义。**不是完整可联机游戏，也不是 FastAPI API 契约。** 所有新增内容仅位于 `frontend/`。

## 启动

需要 Node.js 22+、npm 10+。在仓库根目录运行：

```bash
cd frontend
npm ci
npm run dev
```

打开终端显示的本地地址（默认 `http://127.0.0.1:5173`）。Vite 启动独立于浏览器代码的 Node Mock；不需要真实后端、数据库、账号或环境密钥。不要把此开发演示服务公开部署。

```bash
npm run build          # TypeScript 检查 + 浏览器资源构建
npm run preview        # 本地构建预览，仍由 Node 插件提供 Mock
npm test               # 数据边界、同步控制器、React 组件测试
npm run format:check
npx playwright install chromium
npm run test:e2e        # 桌面 Chrome + 390px 移动视口
```

已有 Chrome 时可指定可执行路径，例如：

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome npm run test:e2e
```

`dist/` 只有前端资源。单独静态托管 `dist/` 不会获得 Mock 服务；本阶段使用 `dev` 或 `preview` 演示。`.npmrc` 跳过 npm 10 对 Vitest 可选 browser peers 的有缺陷自动解析，所需运行/测试 peers 已显式固定；`npm ci` 按锁文件安装。

## 可验收交互

| 场景               | 操作与边界                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 默认 `?scene=host` | 显示成员、Host、Ready、在线状态。房主 Start，不展示 Host Ready；已 Ready 的离线晚风不阻止开局。                          |
| `?scene=member`    | 非 Host 可准备/取消准备，不能 Start。不会自动代替房主开始游戏。                                                          |
| `?scene=initial`   | 自己四张背面牌，先选一张再确认；最多两张不同位置。两张用满仍可在原共享 45 秒内查看，不自动个人 End。                     |
| 提前结束           | 尚有次数时二次确认，可取消；确认不会暂停截止。End 接受后清除临时值，等待他人 End 或共享截止。                            |
| 首个 Turn          | 初始查看全员结束或共享 45 秒截止后，由 Node Mock 返回第一 Turn，原截止不因重连重置。                                     |
| `?scene=table`     | 独立的稍后牌桌快照：玩家可变长度牌列、公开 3、隐藏牌背、DrawPile 34、DiscardPile 顶部 9/数量 7、当前行动者与 90 秒截止。 |
| Reconnect/Error    | 本端断线、连接接管、过期 Decision、响应丢失、必需版本不兼容均有独立状态和安全交互。                                      |

页面底部「演示场景与连接测试」可触发：

- 模拟本端断线 → 私人值/Decision 清除 → 重新连接 → 只获取当前合法授权与原截止。
- 模拟接管 → 原端不可操作；重新连接明确模拟该端重新取得有效资格。接管不回写原 Accepted/Rejected。
- 下次响应丢失 → 执行一个操作 → 核对原请求结果。也支持按**原身份、原内容**重试，不自动新建身份重做。
- 使当前 Decision 过期 → 在下一轮询前提交 → 显示安全拒绝并同步，不把旧位置自动套到新 Decision。
- 模拟其他玩家结束查看 → 自己也 End 后进入牌桌。
- 未知必需版本 → 停止操作、清除私人值，重新载入场景可重置演示。

场景链接每次建立独立演示会话，不共享跨标签页牌局，不用客户端声明的玩家 ID 充当真实鉴权。刷新页面是重开演示；「重新连接」按钮才是同会话恢复测试。服务重启清空演示会话。

普通 Turn **只展示，不提供抽牌、替换、能力或 CABO 命令**。展示窗口到期后 Mock 明确停止提供该场景快照，并显示「演示快照已到边界」，不会伪造超时领域效果。可重新载入演示；这不是新的 CABO 业务阶段。

## 结构与替换边界

```text
src/App.tsx                     页面组合与生命周期
src/components/Lobby.tsx        成员/房主/Ready/Start
src/components/InitialReveal.tsx 初始选牌、确认与提前结束
src/components/GameTable.tsx    公开牌桌
src/components/ConnectionBanner.tsx 恢复与请求状态
src/components/CardTile.tsx     牌背/公开牌/授权临时值显示
src/components/Countdown.tsx    截止展示，不触发领域动作
src/data/model.ts              本地展示类型、Gateway 接口
src/data/session.ts            请求与快照同步、授权清理、陈旧响应防护
src/data/demoGateway.ts        可替换的 Mock 数据适配器
mock/service.ts                仅 Node 的有界场景响应源
mock/plugin.ts                 dev/preview 的本地演示通信
 tests/                        组件、同步与浏览器验收
```

`Gateway` 提供 `read / command / lookup / reconnect`。后续增加 FastAPI adapter，在入口替换 `DemoGateway` 即可复用组件；真实适配器还须负责已批准 wire schema 的运行时验证、鉴权、版本转换与安全投影映射。`model.ts` 中字段名、`demo-*` 版本值与 `/__cabo_demo` RPC **仅是本地演示实现，不是已批准 HTTP 路由或 WS 格式，也不要求后端照此实现**。

Node Mock 只返回接收者普通投影、本人 Decision、独立临时授权；不向浏览器发完整牌组或内部 Card ID。服务器侧演示牌值仅在确认后进入授权的 `reveal`。Vite 禁止通过源码请求读取 `mock/` 和测试文件，浏览器构建不包含该服务模块。

React 不按规则计算 Start 条件、回合推进、胜负或计分，只根据 Decision 展示操作。前端计时仅用于倒计时与到期隐藏私人内容；它不会创建 Turn、发送超时裁决命令或改变公共业务阶段。

同步控制器不从事件重放领域状态。命令结果和当前 View 分离；命令结果后作废旧代读取，已应用读取序号防回退且不饿死慢轮询。断线、接管和过期清除临时值/操作草稿；私人值不写入 localStorage、日志或请求历史。`OutsideScope` 不表示未执行，只有同步到新的 Decision/业务上下文后才允许放下旧 pending；同上下文保持保守阻断。

## 冻结契约覆盖与未接入能力

测试对应：L04/L05/F01、T01–T03/F03/F04、A07/A09/A10/A13、F33/F34/F38/F39。另有晚到秘密、End 与在飞轮询竞态、慢轮询、重复会话创建、同身份规范化重试、确认框跨截止以及浏览器源码隔离测试。这里验证的是前端与 Mock，**不代表后端或真实多人端到端验收通过**。

真实后端待接入：

- 玩家认证、单有效连接与接管通知、真实 Room 多人共享及 presence 宽限。
- HTTP/WS 编码、请求 ACK、事件版本/身份/进展、断线同步与生产时钟同步方案。
- 真实 Command 受理、并发/幂等、结果保留期限及稳定错误码。
- 完整 Draw/Discard/Replace/Peek/Spy/Swap/Undo/CABO、服务端 Turn 超时、结算与历史终局查询。

这些传输和基础设施细节未在冻结业务文档中定义，留待双方批准；本实现不自行决定。未发现需要新增玩法决定才能完成本里程碑的契约缺口。未修改 `backend/`、`contracts/`、`docs/`。
