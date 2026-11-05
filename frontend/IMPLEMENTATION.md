# Frontend Milestone 1 Implementation Plan

Goal: 实现已冻结 Phase 4 范围内的 Lobby、InitialReveal、牌桌展示与恢复/错误界面。
Architecture: React 只消费接收者投影与 Decision，提交逻辑 Command。可替换 Gateway 隔离数据访问；Node Mock 仅模拟此里程碑必要响应，不是核心后端实现。
Tech Stack: React、TypeScript、Vite、Vitest、Testing Library、Playwright。
Spec: ../AGENTS.md 及用户指定的六份 docs 文档，尤其统一契约与验收矩阵。

## 选择与边界

采用独立 Node Mock，避免浏览器包携带完整底牌。未选择浏览器内游戏引擎（越过权威边界），未接入真实传输（协议未批准）。类型为本地展示模型，mock transport 为仅本地演示设施，不是 API 提案。全部代码、说明与配置仅在 frontend/。

## 实施步骤

- [x] 数据边界：Gateway 的 read/command/lookup/reconnect；普通投影、Decision、临时授权分别建模。测试确认两张不自动结束、拒绝第三张、过期授权不恢复、幂等与接管不回写 Accepted。
- [x] 展示与交互：Lobby、InitialReveal、GameTable、ConnectionBanner。先测试非 Host Ready、Host Start、提前结束确认、取消与共享截止，再实现组件。
- [x] 恢复：断线清理私人值与草稿；重新获取当前快照；未知结果保留原请求身份查询；拒绝旧 Decision；未知必需版本停止操作。测试晚到快照与私人结果不能复活授权。
- [x] 验证：npm test、npm run build、Playwright 浏览器测试；检查提交仅 frontend/；独立分支 PR，不合并。

## Review Focus

- 晚到秘密值、过期确认提示与接管同时发生：禁止重新展示或提交旧位置。
- 请求失败可能已 Accepted：不生成新身份盲重试，不乐观推进领域阶段。
- Ready 离线成员不阻止 Start，Host 无有效连接不能操作。
- 两张配额用尽后仍保留原窗口，全部个人 End 才提前进入 Turn。
- 时钟仅展示；浏览器不能创建 Turn、结算或判断胜负。

## 契约待接入事项

真实 HTTP/WS 路径与编码、鉴权/连接身份、版本值、服务器时钟同步机制、错误码具体值、保留期限与 ACK 传输均未批准；本里程碑不决定它们。只通过本地 Gateway 表达已确认业务语义。

## 验证记录

- 26 项 Vitest 测试：通过（数据边界、组件、同步控制器与 Gateway）。
- 8 项 Playwright 场景：桌面/移动端通过；截图人工检查无横向溢出。
- TypeScript 检查、Vite build、Prettier 检查通过。
- 独立审查发现的 End/轮询竞态、未知请求无法恢复、JSON 属性顺序导致身份变化，以及慢轮询饥饿均增加回归测试并修复。
- 决定：普通 Turn 展示到期时终止本地演示数据源，不自行实现后端超时/计分引擎。真实生产实现仍须批准传输契约。
- npm 10 解析 Vitest 可选 browser peers 发生内部异常；核实兼容性后显式固定测试 peers 并通过 .npmrc 使用 legacy-peer-deps，锁定安装结果。最终依赖审计无已报告漏洞。
