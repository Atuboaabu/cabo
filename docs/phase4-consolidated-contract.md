# CABO Phase 4 — 统一 Command / Event / View 契约（审计整合稿）

> 状态：**已审阅并纳入 GitHub 的 Phase 4 统一业务契约；不等于实现测试已通过**  
> 审核范围：CM-1～CM-106、CM-I1～CM-I1005（本对话确认的原则）；结合 `docs/game-rules.md`、`docs/domain-model.md`、`docs/state-machine.md`、`docs/player-views.md`（仓库 main，2026-11-05 复核同步）。  
> 优先级：`docs/game-rules.md` 为玩法 Source of Truth；在 Phase 4 对早期在线/状态/信息契约作**显式修订**的范围，适用相应已批准 CM；其他旧规则保持有效。未来分歧先审核，不能由实现自行决定。  
> 不规定 HTTP 路由、WebSocket 消息名称、数据库、事务或并发实现；本文业务名词不代表最终字段名。

## 0. 关键修订索引（应映射回既有文档）

| 来源文档与原条款 | 修订性质 | 统一后的有效契约 | 依据 |
|---|---|---|---|
| `docs/domain-model.md` §9.1、第 208 行；`docs/state-machine.md` §6、第 266 行 | **实质替换** | Peek/Spy 15 秒从“正式 Accepted 弃牌并选择使用能力”开始，而非目标确认开始；不超过原 Turn 90 秒；每次合法重新使用另有独立 15 秒窗口 | CM-37～CM-46 |
| `docs/player-views.md` §6.2 第 133 行及验收 PV-A07 | **明确化并替换时间示例** | 目标确认只开放剩余秘密查看许可，不刷新能力 15 秒；Turn 第 83 秒**开始使用**时最多 7 秒，若更早使用则截止可能更早 | CM-37、CM-38、CM-46 |
| `docs/state-machine.md` §5.2、§5.5、§6；`docs/domain-model.md` §8.2 | **新增合法转换** | Peek/Spy 弃牌使用后、目标确认前，可经单独 Accepted Undo 进行补偿；恢复原 DrawPile Card 的完整决策，每 Turn 最多成功一次，原 90 秒不变 | CM-43～CM-49、CM-81～CM-84 |
| `docs/player-views.md` §6.1、第 124–126 行 | **增加例外** | 经合法 Undo 恢复的**同一主抽牌**重新成为 Current Action Private Result 的合法当前决策值；不得重抽或恢复其他历史私人值 | CM-44、CM-16、CM-15 |
| `docs/player-views.md` §9.4 第 209 行与 §12 未决项 | **将待决变已确认** | 原 Game Participants 可在专门有限保留政策内，按 Game Identity 查询已 Completed Game 正式终局结果；新成员无自动权限 | CM-97、CM-99、CM-102 |
| `docs/state-machine.md` §3.3、§4.2 | **严格化竞合顺序** | 进入 Settling 后不得首次 Accepted 新普通 Turn Action；已资格成立的管理请求先完成 Round 成绩、全员 100→50 与 Game End，再在 Game 仍 Playing 时按权威顺序裁决 | CM-27～CM-32 |
| `docs/domain-model.md` §9.3、第 224 行；`docs/state-machine.md` §4.3 | **明确化共享截止和个人进度** | InitialReveal 共享、绝对 45 秒，玩家逐次确认至多两张不同初始牌；看满两张并不自动结束个人查看窗口；早 End 或全局截止才结束 | CM-33～CM-36 |
| `docs/state-machine.md` §2.2、第 42 行 | **补充 Start 条件** | 已 Ready 但 Disconnected 的非 Host 不阻止 Start；无有效连接的 Host 不能自动发起 Start | CM-86 |
| `docs/player-views.md` §4、§10、§12 | **新增协议分层** | Game Public Event 非完整重放；可乱序重复、一次原子提交多条独立交付；当前 View 权威；独立版本和关联身份 | CM-1～CM-103 |
| 早期 Phase 1–3 的“后续确定”提示 | **按具体项目关闭** | Command identity/retry/result、时间裁决、旧 Game 终局权限、Event/View 兼容等按本稿；观战、完整回放、基础设施仍不在 MVP 约定内 | CM-1～CM-106 |

### 0.1 CM-71 的显式修订链

原 CM-71 B 要求连接接管时作废旧连接未收到响应的请求、甚至已 Accepted 请求。该**无条件作废语义不再有效**，已被 CM-74 A（不可逆依赖边界）、CM-77 A（未确认收到≠未收到）、CM-78 A（已提交 Replace 不能补偿）、CM-81 A（接管不自动补偿）、CM-83 A（封闭补偿许可）、CM-84 A（原结果不可改）明确限制。最终有效语义：**接管只使旧连接的当前资格失效；原 Accepted / Rejected 永久不变；不自动补偿；唯一相关可申请补偿是普通 Peek/Spy 前置弃牌的既有合法 Undo，须满足所有原窗口和额度限制。** 不因接管新增特殊 Undo 能力。

## 1. 共同边界与服务器裁决

1. **服务器权威**：客户端不能直接改变牌值、牌位或业务阶段。Command 与服务器截止动作由可信 Player、Game/Lobby 身份、现阶段和原绝对截止裁决。
2. **正式受理点**：在截止前完成合法性检查并正式 Accepted 才有业务效力；传输、发送、收到响应的先后不替代裁决。Accepted / Rejected 历史最终结局不可变；接受不等于复杂领域效果已经提交。重复与超时竞争只允许一个相容的权威结果。
3. **游戏固定参与者**：Game Start 冻结 2–4 人及顺时针座次；Playing 期间不因掉线、Room Kick 或之后 Lobby 人员变化自动替换身份。Game Aborted 无当前 Round 分数；已完成 Round 历史不改写。
4. **时间**：每轮 InitialReveal 共享 45 秒；Turn 从正式授予行动权起 90 秒；每次正式弃置能力牌并选择 Peek/Spy 使用起 15 秒，截止 `min(ability_start+15s, turn_deadline)`。断线、二次确认、接管、重连、客户端升级不得重置或暂停。
5. **位置**：客户端目标是 Player Identity + 当前序号，固定在 Decision 所属布局；旧位置不能自动映射至插牌/Swap 后同编号不同 Card。内部 Card ID 不公开。
6. **秘密隔离**：普通公共投影绝不发送未授权背面真实数字；Peek/Spy/InitialReveal 临时结果的原授权、原目标、原 deadline 与可信接收者同时成立才可访问。已经合法发送且过期后送达的数据不延长客户端展示期限；服务器不再发送新秘密。不可通过错误、Event 来源、时间戳、调试内容旁路。

## 2. 游戏生命周期与领域效果

### 2.1 Room、Game 与管理

- Lobby：Join 满足人数；Ready 仅非 Host；Host Start 隐含 Host Ready。Lobby 普通 Leave 与 Host Leave 根据既有成员/继任规则执行。Host 转移不改变当前 Lobby epoch；新 Game/返回 Lobby 后采用新 epoch。
- Start：2–4 合法成员、全部非 Host Ready，**不强制全部成员 Connected**；发起 Host 自身必须有有效连接资格；冻结 Game Participants。
- Playing：普通 Join/Leave 不合法；Host Kick 目标将当前 Playing Game Aborted、移除目标、Room 返回 Lobby；Host Disband 将 Game Aborted、Room Closed。Host Leave Playing 不合法。
- Round Settling：禁止首次受理新的普通 Turn 动作；已在正式截止前获得资格的管理请求，先完成正常 Round Score→全员累计→精确 100 重置→Game End，只有 Game 仍 Playing 时才按权威先后逐项动态重新验证管理资格；Game Completed 不能被 Abort。
- 所有 Playing→Lobby 后的非 Host Ready 按既有规则重置；离线本身不取消 Ready/Host/成员资格。

### 2.2 InitialReveal

- 一轮发牌后开放同一共享 45 秒窗口，每位玩家最多正式确认两个**不同初始牌**，可先确认一张再选择另一张。每个位置确认/个人提前 End/超时完成可以公开相应进度，不公开数字。
- **两张配额用满不等于个人自动 End**：原本人秘密展示可持续至用户 End、共享截止或有效 Abort。全员 End 或截止后才进入首个正常 Turn；掉线不重新开始窗口。

### 2.3 Turn 与牌的来源

- `AwaitingAction`：正常 Turn 开始可 DrawPile、DiscardPile 或 CABO；FinalTurns 中不能 CABO。DrawPile 私下取得主牌；DiscardPile 只能取公开顶牌且强制 Replace，不能使用能力。
- DrawPile 主牌 `AwaitingCardDecision`：弃掉（可放弃能力或合法使用 7–12），或者 Replace；不允许同次抽牌同时 Replace 与能力。普通截止默认弃掉、不使用能力。
- Swap：一次性确认自己及对方合法目标，牌的原正/背面状态随牌移动；正式提交后立即结束 Turn。Peek/Spy：见下一节。
- CABO：正常 Turn 开始呼叫后自己本轮不再行动，其他玩家按顺时针至多各一次 Final Turn；FinalTurns 中再次 CABO 非法；DrawPile 在合法当前 Turn 中耗尽，完整处理当前 Turn 后直接 Settling，无需完成剩余 FinalTurns。

### 2.4 Peek / Spy 与可逆前置弃牌

1. 仅 DrawPile 主牌 7–8 Peek / 9–10 Spy，弃牌并正式选择使用能力时开启一段**独立** 15 秒能力窗口，不得将起点后移到目标确认。
2. 在该窗口及 Turn 原 90 秒以内，合法确认一个背面目标（Peek 自己，Spy 其他玩家）；冻结具体目标 Card，公开目标位置而不公开数字；临时数字只对原授权 Player 在剩余窗口内有效。确认后不能改选、不能 Undo；自动/主动结束都立即完成 Turn。
3. 目标确认前，允许独立的 `UndoAbilityDiscard` Command：必须同一 Turn、原主抽牌、仍为该段能力窗口、DiscardPile 顶部仍为该正式弃牌、没有确认目标、Turn 撤销次数尚为 0。它的补偿正式成立后恢复**同一主抽牌**到 DrawPile 决策完整选项（Replace 或重新弃置/合法使用能力），恢复原私有主牌值的现阶段授权；Turn 90 秒不刷新。
4. 每 Turn **最多一次成功 Undo**；失败的 Undo 不消耗配额。重复使用该能力牌可开启新的独立 15 秒窗口，但第二次使用后不能再成功 Undo。已确认目标、已超时、已结束 Turn、已 Aborted 均不可 Undo。
5. 原弃牌 Accepted 与原公开弃牌 Event 保留；新 Undo 独立 Accepted、独立 Event，引用原弃牌完整 Event Identity，并报告恢复的公开 DiscardPile 顶部。不得回写或抹掉历史。
6. 使用能力但未选目标时允许主动 End；到能力窗口/Turn 截止按跳过目标、完成 Turn，不公开 Peek/Spy 的主动结束还是 15 秒/90 秒原因（CM-39）。最后主抽牌耗尽时也先完成此合法能力/Undo 选择，然后 Settling。

### 2.5 Replace 与 DrawPile 耗尽

- 正式目标选择冻结旧牌集合及服务器内部同值结果；客户端草稿不冻结。成功时新牌落于指定的一个旧目标位置，其他旧牌弃掉；失败时旧目标保持原位翻开，新主牌按确认方向插到左/右端，若所选旧牌至少三张且需要罚牌则另取一张**不可看**的 DrawPile 罚牌按第二次左/右选择插入。已定方向不能改；未决方向超时默认左侧。全部必要选择结束后**一次原子提交**。
- 正常抽走 DrawPile **最后一张主牌**且尝试替换至少三张旧牌、数值不全相同时：旧牌原位翻开，**主牌直接弃掉**、无主牌/罚牌插入、本轮 +10；提交后 Turn Completed、Round Settling。两旧牌失败不是该特例。
- 正常抽牌后牌堆还余一张且罚牌恰好抽空时：按正常三张以上失败插入主牌和罚牌，无特殊 +10，Turn 后 Settling。
- 已原子提交的 Replace **任何时候不能因连接接管补偿**。尚在 AwaitingPlacement 的 Replace 若 Game Aborted，不能提交尚未形成的中间牌列效果，已公开的先前取牌事实仍是历史。

### 2.6 正式计分

- Settling 中不提前披露全手牌；Round Completed 且已计算并应用 Game 累计/重置/终局后统一公开正式结果。
- 手中精确 `[12,12,13,13]` 的 Kamikaze 优先：本人 0、其他玩家 50，覆盖普通 CABO 及最后主抽牌替代 +10。
- 其他情况下：CABO 呼叫者实际手牌总和不高于全体任何人（包含并列）时 0，否则真实总和 +10；其他人为真实手牌总和；最后主抽牌特例额外 +10 独立相加，不参与 CABO 成败比较。
- 全员计入 Round Score → 从未使用过重置且加分后**恰好 100** 者 100→50 → 若任一最终累计 **>100** 则 Game Completed → 全体最低累计者胜；平分再比最后 Round Score，仍平分共同获胜。下一轮起始者取上轮 Round Score 最低，平分从上轮起始者自己开始顺时针找第一人。

## 3. Command / Result 契约

### 3.1 请求与作用域

- 游戏 Command 明确绑定 Game/Round/Turn/Decision（对不适用层级不编造），规范化操作、目标、选择；Room 管理 Command 绑定 Room/Lobby epoch 或 Room/当前 Game。Requester 的可信 Player Identity 单独验证；完整 Request Identity 只在已界定业务上下文内唯一，不要求全局唯一 local ID。
- 同一完整 Request Identity 与相同规范化请求可安全重复，不能重新执行；同 ID 不同请求内容必须安全拒绝身份冲突，即使旧请求曾 Rejected。无序目标集合按规范化后处理；重复目标本身仍非法。
- 业务合法性在**服务器正式接受**时检查原绝对截止及当下角色/Host/Decision，不能由浏览器倒计时或传输发送时刻替代。Game Settling 阶段不得 Accepted 新普通 Turn Action。

### 3.2 四类结果

- `Accepted` / `Rejected` 一旦正式成立永久不变。`Not Yet Determined` 不是 Rejected，也不能据此安全改 Request Identity 重复执行旧内容。`Outside Scope` 是到期/不可查询，不表示请求从未发生或可以重做。
- 原 Requester 可在保留与权限范围内按完整身份核对；身份与规范化请求的识别期限**区别**于详细 Result 可查询期限。服务器政策公开、有限、可配置，旧业务上下文不能在保留记录过期后重启。
- Rejected 有稳定、秘密隔离的机器可识别原因类别；不通过差异透露隐藏值、其他玩家秘密 Decision 或其他 Game 是否存在。
- Result 语义版本独立；可同时区分**原结局归属进展**（存在才给，历史稳定）和**本次响应的当前同步参考进展**（可随当前可授权状态变化）。Rejected 不得虚构领域提交；Not Yet Determined / Outside Scope 不得虚构原结局。Accepted 受理不表示所有后续方向和领域效果已完成。
- 接收确认由原连接经服务器可验证方式，精确绑定完整 Request Identity、具体结果和原接收连接；无确认只说明是否收到未知，晚到确认不改结局或连接资格。

## 4. 信息投影与事件

### 4.1 权威 Player View / Room View / Decision Context

- Game Player View 是最新当前真相：成员牌列位置、朝向、已翻公开数字、DiscardPile 顶部、DrawPile 数量、阶段、行动者、截止、最新正式 Round/Game 结果及有权看到的信息。背面值与内部 Card ID 不出现。
- Decision Context 仅给当前可信行动者，包括当前合法选项、冻结事实及引用，显式绑定 Game/Round/Turn/Decision 和适用状态基准。View 进展较新不必然意味着 Decision 失效（例如仅连接状态变化），但旧 Decision 身份或截止不能和新 View 拼接。
- Room Lobby View 向当前有权成员公开成员、Host、Ready、逻辑 Connected/Disconnected；在线通知可携带当前 Lobby epoch、可比较进展、成员及新逻辑连接状态。仅在能证明安全应用时更新本地连接展示，未知缺口/冲突取完整权威 View；不能借通知修改 Ready/Host。
- Player View、Room View、Decision Context、Command Result、Game Public Event、Lobby 在线通知**各有必需语义版本**。同一 Game 的 Player View / Decision Context / Public Event 必需语义稳定；同一 Lobby 的 Room View 必需语义稳定。未知必需语义不得猜测操作；允许真正可选的兼容扩展。

### 4.2 Game Public Event

- 公共 Event：至少 Game Identity + Game 内唯一 Event Identity、可比较同 Game 公开业务进展、服务器**秒级**正式提交时间、稳定事件类型、独立事件语义版本，真实适用 Round/Turn 身份；无对应层级不虚构。
- 已正式提交的公开事实可产生多条 Event，甚至共享业务进展；可独立送达、重复或乱序，不能逐条模拟 Replace 原子中间状态，也不承诺查询或完整回放。以完整 Event Identity 去重，最新 View 作为领域真相。来源（Player/Server）仅在该区别允许公开时表达；Peek/Spy 正常结束不可通过来源、类型及事件组合额外披露主动/15 秒/90 秒原因。
- Undo Event 独立引用原弃牌 Event 的完整 `(Game Identity, Event Identity)`，即使原 Event 不再可查询亦保持合法引用。禁止泄露内部 Card ID 或过期秘密。
- Game Playing 期间每次正式**逻辑** Connected/Disconnected 变化产生 Game Public Event；Game Completed/Aborted 后停止新增该 Game 的连接事件。单 Player 只认可一条当前有效连接；新连接接管旧连接，Connected→Connected 不伪造断线 Event。

### 4.3 私人结果

- DrawPile Current Action Private Result 仅当前拥有主抽牌处理决策的行动者有权读取本次数字；阶段终结时失效；合法 Undo 后同牌恢复新当前阶段的授权。
- InitialReveal / Peek / Spy Temporary Reveal 仅原 Player、原能力和原目标 Card、原合法窗口有效时提供；过期不再发送新秘密，不能通过 Result 查询、Event 历史或 Completed Game 独立终局查询重新获取。
- 最新 Completed Round 可看全手牌与计分明细；更旧 Round 只摘要；Settling 和 Aborted Round 不提前/自动揭牌。

## 5. Presence、断线和历史

- 当前 Player 只有一个有效连接，新连接正式接管旧连接立即失效；旧端尽力收到私有失效通知，未送达也不延迟接管。旧端接管后不能首次 Accepted 新 Command 或再新发送私人结果；接管前已正式成立的结果维持。
- 底层断线判定可设有限、公开、可配置宽限；单次宽限截止确定后不因重试暗中延长；宽限内恢复无正式离线/上线变更；届满仍无有效连接才逻辑 Disconnected。所有 45/90/15 秒原截止照常。
- Completed Game 的原 Participants 可在专门有限、公开、可配置的结果保留政策内按 Game Identity 查询**正式完成的**终局分数与胜负；新 Room/Game 成员不因当前成员身份取得旧 Game 资格。此查询不等于 Aborted Game 正常终局查询，也不开放秘密 Replay。

## 6. 正式冻结验收要求（CM-104～CM-106）

1. 后续决定只有**明确声明的修订范围**可覆盖旧 CM；其他旧决策仍有效。修订关系必须可追踪。
2. 所有业务 Command、管理 Command、服务器自动动作需完成合法前提、可信权限、受理、Rejected、截止、重试幂等、领域提交、公开 Event、私人输出、终局/Aborted 竞合审查；无意义项目标注 N/A 而非留空。
3. 存在正确性或秘密隔离的未定义路径，**不可冻结**。关键场景覆盖且无阻断冲突后才冻结；后续破坏性改变需显式版本及影响说明。

**配套验收证据**：`docs/phase4-command-acceptance-matrix.md`。

## 7. 原有仓库的同步和维护边界

1. `docs/domain-model.md`：修正 Peek/Spy 15 秒起点、共享 InitialReveal、Undo 例外与重连/接管边界；更新 Phase 1 待决说明。
2. `docs/state-machine.md`：新增 Undo 转换及资格、修改 Peek/Spy 的能力截止，完善 Settling/Host 管理权威顺序、离线 Ready Start；保留原 Replace 原子规则。
3. `docs/player-views.md`：修正私人查看与 Undo 后主牌恢复例外、补充公共 Undo Event、历史 Game 终局访问与版本体系；移除已解决的待决标记。
4. `docs/game-rules.md`：仅对由用户明确批准的在线能力时钟和 Undo House Rule 作**明示修订提案**，保持原玩法 SoT 地位；不得默默把线上协议变化当成原版 CABO 规则。
5. 将本稿与验收矩阵作为待审阅的 Phase 4 合同，已获本轮用户明确授权后同步至仓库，未来改动仍须获得具体授权。
