# CABO Phase 4 — Command / Automatic Action 验收矩阵（契约级）

> 状态：**已完成契约级静态复核并纳入仓库；未运行后端及端到端测试**。  
> 对照文件：`docs/phase4-consolidated-contract.md`、仓库 `docs/game-rules.md`、`docs/domain-model.md`、`docs/state-machine.md`、`docs/player-views.md`。  
> 覆盖基线：CM-1～CM-106，CM-I1～CM-I1005。命令名为逻辑名称而非 HTTP 或 WS 路径/字段。  
> 本矩阵不授权修改后端代码、数据库或规则。

## A. 全局核对列（适用于以下所有行）

每行的 **G：Guard**、**S：Accepted/效果**、**R：Rejected/截止**、**V：输出**、**C：竞合/重复** 均已给出。统一规则：

- **身份**：Command 由可信原 Player 身份绑定合法 Room/Lobby epoch 或 Game/Round/Turn/Decision。完整 Request Identity+规范化请求内容用于幂等；同身份不同内容拒绝冲突。旧连接接管后不得首次接受新请求。
- **正式受理**：服务器以权威状态和原截止裁决。Accepted 与领域最终提交不是同义；已 Accepted/Rejected 的历史结局永久不变。同一竞争只能有一个合法效果。正式 Rejected 不产生未发生的普通领域事件或私人授权。
- **异常优先级**：Game 正式 Aborted 时未提交的当前领域步骤不再正常提交；Game Completed 永不可 Abort；已 Completed Round Score 不重复应用。Settling 阻止新普通 Turn 命令。
- **输出**：V 中的 `Pub` 只含已正式公开的事实、身份、进展/版本；`Priv` 只含原已获授权的秘密；`View` 永远是当前权威状态。`—` 表示无对应输出，而不是实现者任意决定。
- **超时**：只应用本行定义的服务器默认；其余情况下无额外超时效果。过期请求安全拒绝，绝不默默重开原上下文。
- **Result**：可安全区分 Accepted、Rejected、Not Yet Determined、Outside Scope；后两种不是新领域决定。拒绝原因保密；结果语义版本与历史进展/当前同步参考分离。
- **测试状态**：以下均为**契约预期已覆盖**；不是已运行、已通过的后端测试。

## B. Room / Lobby Command

| ID | Command / 服务器事实 | G：合法前提 | S：正式效果 | R：拒绝/默认 | V：Public/Private | C：重试、竞合与终局 |
|---|---|---|---|---|---|---|
| L01 | Join | Room Lobby、容量<4、可信新成员资格，正确 Lobby epoch | 加入成员并确定排序；产生新权威 Room View | Closed/Playing、满员、旧 epoch 拒绝；无超时默认 | Room 状态通知及安全 View；无牌面秘密 | 同请求不可重复加入；Playing 禁止 Join |
| L02 | Member Leave | Lobby、当前非 Host 成员 | 移除成员及其 Ready；其余 Ready 保留 | Playing Leave 拒绝；无自动离开 | Room View/成员变化，非 Game 秘密 | 迟到旧 Lobby Leave 不作用于新 epoch |
| L03 | Host Leave | Lobby、当前可信 Host | 有其他成员则转移给仍在室内最早加入者再退出；独自则 Room Closed | Playing Host Leave 拒绝 | Room View/Host 变化 | Host 转移**不**创建新 Lobby epoch；同请求只移除一次 |
| L04 | Ready / Unready | Lobby、当前非 Host、当前 epoch | 更新 Ready | Host Ready 非法/不必需、Playing/旧 epoch 拒绝 | Room View/Ready 状态 | 离线不自动清 Ready；重试不变成二次动作 |
| L05 | Host Start | Lobby、当前有效 Host、2–4 成员、其他成员 Ready、无当前 Playing Game | 创建 Game、冻结所有成员及座次、重置新局累计/资格，启动共享 InitialReveal 45s | 无有效连接 Host 不得首次提交；未 Ready/人数不合法拒绝；无自动 Start | 新 Game 权威 View/合法公开开始事实；秘密初始牌分别授权 | Disconnected 但 Ready 的非 Host **不阻止** Start；同 Start 不双建 Game |
| L06 | Host Kick (Lobby) | 当前 Lobby Host、合法其他 Room 成员目标 | 移除目标；其他成员 Ready 保持 | 目标已离开、Host 已变/旧 epoch 拒绝 | Room View/成员变化 | 不修改以前 Game Participants 或历史成绩 |
| L07 | Host Kick (Playing) | 当 Game 仍 Playing，Host 与目标资格在原截止内成立；Settling 资格按 CM-28～31 | 目标移除；当前 Game Aborted，Room 回新 Lobby，Ready 重置 | Game 已 Completed/Host 失效/目标失效拒绝 | Game Aborted 公共事实、Room View；活动未完成 Round 不揭底牌 | 必须先完成已正式 Completed Round 的成绩/终局检查；不重复 Abort |
| L08 | Host Disband | 当前合法 Host；Room 未 Closed | Playing 则 Game Aborted，Room Closed；Lobby 直接 Closed | 终局后不允许借此回写历史 Game | 房间关闭/必要 Aborted 事实 | Settling 中资格和顺序同管理请求；重复 Disband 不双关房 |
| L09 | Lobby presence changed（服务器） | 单有效连接逻辑状态发生正式变化；宽限届满或有效重连 | 更新 Lobby Room View 的 Connected/Disconnected | 宽限内恢复且未正式变化：**无状态事件** | Lobby 通知可携带成员、新状态、epoch、可比较进展；无连接 ID | 旧 epoch/旧进展不能覆盖新 View；不改 Ready/Host |

## C. InitialReveal / Turn Command

| ID | Command / 服务器事实 | G：合法前提 | S：正式效果 | R：拒绝/默认 | V：Public/Private | C：重试、竞合与终局 |
|---|---|---|---|---|---|---|
| T01 | InitialReveal Confirm One | 当前 Round InitialReveal、原共享 45s 未过、该玩家最多已确认 1 张、选当前初始牌且未重复 | 冻结此次初始牌并授权原玩家限时读数字；增加已确认位置/数量 | 重复位置、配额满、截止后拒绝；截止不自动看剩余牌 | Pub 位置/个人确认进度；Priv 仅该 Card 数字 | 可先确认第二张再看；两张满**不自动个人 End**；同请求不双计数 |
| T02 | InitialReveal Personal End | 当前同 Round 的个人窗口仍未结束 | 正式结束个人查看，剩余额度作废 | 已结束/旧 Round 不再生效；截止后由服务器结束 | Pub 个人 finished；Priv 原授权失效 | 早 End 与截止互斥；不能因重连获得新 45s |
| T03 | InitialReveal deadline（服务器） | 同一 Round 共享绝对 45s 到期且仍在 InitialReveal | 自动结束未 End 的玩家；全部结束后授予首个 Turn | 若所有人已 End，不再产生多余完成 | Pub 完成进度/阶段；无新秘密 | 同阶段只转换一次；离线 Ready 参与者按相同时钟 |
| T04 | DrawPile Draw | 当前合法正常/Final Turn AwaitingAction，DrawPile 非空且资格未过 | 取主牌进入 DrawPile 决策；Player 有权读同一张数字 | 非 Turn 持有人/空牌堆/旧 Turn 拒绝；未开始选择的超时另按 T19 | Pub 取牌及牌堆公开数量；Priv 主牌数字当前阶段有效 | 不可重复抽牌；主牌恰好抽空也必须完成当前 Turn |
| T05 | DiscardPile Take Top | 当前合法 Turn AwaitingAction，DiscardPile 有公开顶牌 | 取得确定的公开顶牌，进入仅 Replace 决策 | 非当前 Turn、旧顶牌引用拒绝；超时进入强制单牌替换 | Pub 顶牌变化/原牌数字；Priv 无新隐藏值 | 不允许使用能力或直接弃掉；不双重取顶牌 |
| T06 | DrawPile Discard Without Ability | 当前 DrawPile 主牌待处理 | 将主牌公开入 DiscardPile，Turn Completed | DiscardPile 来源不允许；已冻结 Replace 不得改弃牌；截止默认合法弃掉 | Pub 弃牌数字与 Turn Completed；Priv 抽牌授权终结 | 若主牌是最后一张，完成后 Settling |
| T07 | DrawPile Discard + Use Peek/Spy | DrawPile 当前值为 7–10、未冻结其他选择、当前 Turn 有效 | 弃牌正式成立；开启**本次新** 15s Peek/Spy 能力窗口，至原 Turn 截止上限 | 数字不符/DiscardPile 来源/超时拒绝；截止默认 T06 | Pub 弃牌与允许公开的能力事实，不泄露意图外秘密；Priv 能力现阶段信息 | 一个 Turn 至多一次成功 Undo；重新使用能力可得新窗口但不重置 90s |
| T08 | DrawPile Discard + Use Swap | 当前值 11–12、当前 DrawPile 卡决策有效 | 正式弃牌并进入目标选择，等待双方完整目标 | 来源非法/数字不符/旧 Decision 拒绝；目标截止未定则跳过能力 | Pub 弃牌数字；Priv 无交换目标隐藏值 | 两端未确认不发生半次 Swap；窗口为 Turn 90s（非 Peek/Spy 15s） |
| T09 | Peek/Spy Confirm Target | 已在合法 15s 能力窗口、尚无正式目标，Peek 自己/Spy 他人背面牌且当前布局匹配 | 冻结一个具体 Card、公开目标身份与位置；向原 Player 限时授权该数字 | 已确认/无合法目标/旧布局/能力或 Turn 到期拒绝；截止没选默认跳过 | Pub 使用者+目标位置；Priv 数字仅原授权，结束原因不公开 | 不得重选；确认不重启 15s；与 Undo/End/超时争唯一胜出者 |
| T10 | Peek/Spy Personal End | 当前该能力窗口仍有效，目标可已确认或尚未确认 | 停止秘密权限，立即 Turn Completed；未选目标则跳过 | 已完成/已超时无新作用；服务器截止亦自动完成 | Pub 普通 Turn Completed，不发布主动/15s/90s 结束原因；Priv 授权失效 | 与服务器截止/Undo/Confirm 互斥，不重复结束 |
| T11 | Peek/Spy UndoAbilityDiscard | 同 Turn 已 Accepted 首次弃牌使用、目标未确认、原能力/Turn 截止均未过、原弃牌仍可顶端精确补偿、本 Turn 成功 Undo=0 | 独立补偿弃牌，恢复同一主抽牌完整 DrawPile 决策与其当前私有值；标记一次成功 Undo | 任一条件不满足安全拒绝；失败不耗额度；到期默认跳过目标并完成 | Pub **独立 Undo Event** 引用原 Discard Event、公开恢复顶牌；Priv 同一卡当前决策 | 原弃牌 Accepted 及 Event 不改写；第二次再使用能力可新开 15s 但不可再 Undo |
| T12 | Swap Confirm Both Targets | 当前 Swap 能力、自己与另一玩家合法卡位双目标同时完成确认 | 一次交换两具体 Card、每张保留原朝向；Turn Completed | 任一端无效/旧布局拒绝；90s 到期未双确认则跳过 | Pub 交换双方与位置、仍公开的正面数字；Priv 不给隐藏数字 | 不公开半端草稿，不双交换，不额外揭牌 |
| T13 | CABO Call | 正常 Round Playing 的本人**正常 Turn 开始**且未抽牌 | 本人 Turn Completed，Round FinalTurns，其他每人至多一次末次行动 | FinalTurns、非 Turn 开始、失效 Turn 拒绝 | Pub CABO 呼叫者/FinalTurns 状态 | 不再呼叫第二次 CABO；抽牌提前耗尽则当前最终 Turn 后 Settling |

## D. Replace / 放置与超时默认

| ID | Command / 服务器事实 | G：合法前提 | S：正式效果 | R：拒绝/默认 | V：Public/Private | C：重试、竞合与终局 |
|---|---|---|---|---|---|---|
| R01 | Single Replace | 当前有效主牌或 DiscardPile 顶牌，选自己一张当前合法旧牌 | 原子弃旧牌，新牌入所选位置；DrawPile 新牌背面、DiscardPile 新牌正面，Turn Completed | 旧位置/旧 Decision 拒绝；DiscardPile 待决超时默认最左一张 | Pub 旧牌公开数字、公开牌列结果；Priv 主抽值授权关闭 | 原子效果只一次；不得因接管回滚 |
| R02 | Multi Replace Select Targets | 同一主牌，自己至少两张不同位置且冻结前合法 | 冻结所选 Card 和真实同值判定，确定成功放置/失败插入等待任务，必要时准备未读罚牌 | 客户端草稿无效果；同身份改内容冲突；旧布局拒绝 | **不**公开匹配判定、冻结目标或旧牌隐藏数字；Priv 仅合法决策上下文 | Game Aborted 时未提交效果不发生；超时只完成冻结任务 |
| R03 | Successful Multi Replace Placement | 冻结匹配成功、在选中旧位中选一个作为新牌位置 | 全部所需选择完成后，原子丢弃所有旧目标、新主牌入其中所选位置，Turn Completed | 选非目标/旧 Decision 拒绝；超时默认选中最靠左目标 | Pub 一次已提交完整牌列及公开弃牌效果；Priv 无旧隐藏数字 | 选过位置不能改；Event 可分批到达，但不允许部分领域效果 |
| R04 | Failed Multi Replace New-Card Side | 冻结失败且不是最后主牌>=3特殊例外；需插主牌 | 冻结 L/R；两旧牌失败则完成入列，>=3 旧牌失败则继续等待独立罚牌方向 | 超时缺此选择默认左；已选方向不改 | 未全部放置完不得提前公开牌列中间态 | 若惩罚牌恰好抽空牌堆，仍正常入列后 Settling |
| R05 | Failed Multi Replace Penalty Side | 冻结失败、>=3 旧牌、正常还需罚牌、主牌方向已定 | 冻结独立 L/R 并原子提交：旧目标翻开、新主牌与未读罚牌顺序入列，Turn Completed | 超时未选罚牌方向默认左；不允许再改主牌方向 | Pub 已提交旧牌数字、完整牌列；Priv 惩罚牌值**从不**授权 | 不双取罚牌，不部分提交，Game Abort 前未提交则丢弃未完成效果 |
| R06 | Last **Main** DrawPile >=3 Mismatch | 正常主抽恰好最后一张、>=3 旧目标、实际非全同值 | 原子翻开目标旧牌、主牌弃入 DiscardPile、**无主牌或罚牌插入**、Round Score 特别 +10；Turn Completed→Settling | 不满足全条件不得套 +10；无需左右方向可选 | Pub 已提交旧牌与弃牌、最终结算时显示 +10 依据 | Kamikaze 覆盖该 +10；接管不可回滚；与 R07 区分 |
| R07 | Penalty DrawPile Takes Last Card | 主抽后尚余最后一张，>=3 目标失败、罚牌取最后一张 | 旧目标翻开、主牌与罚牌按各自方向正常入列，Turn Completed→Settling | 不触发 R06 +10 | Pub 已提交牌列结果；Priv 罚牌不读 | 牌堆耗尽只在当前 Turn 完成后 Settling |
| R08 | Turn Deadline During Frozen Replace（服务器） | 原 90s 截止，正式冻结 Replace 仍有合法未决放置 | 成功默认最左选中旧位；失败新牌/罚牌未定方向各左；原子提交后 Turn Completed | 不撤销冻结，不改已选方向；如 Game Aborted 先成立，则不能正常提交 | Pub 提交后的最终事实；Priv 未授权罚牌不公开 | 一次完整提交；Round 依 DrawPile 是否空/CABO 状态推进 |
| R09 | Turn Deadline No Selection（服务器） | AwaitingAction 或主牌处理中且无已冻结领域效果 | AwaitingAction：可抽主牌则抽取并弃置；DrawPile 主牌待决：弃置无能力；DiscardPile 待决：最左单牌 Replace | 非法默认不得选择 CABO / 隐藏值策略优化 | Pub 实际正式默认的公开事实；Priv 已终结 | 90s 不因断线/升级延长；与提前 Accepted 的操作唯一竞争 |

## E. Round、Game、管理并发及连接自动动作

| ID | 自动动作 / 管理竞合 | G：触发与资格 | S：正式效果 | R：无效或冲突 | V：Public/Private | C：唯一性及终局 |
|---|---|---|---|---|---|---|
| A01 | Peek/Spy 15s / Turn 90s 截止 | 当前 Peek/Spy 尚未完成，先到的原绝对截止 | 未选目标跳过；已选则关闭秘密权限并 Turn Completed | 已有效主动 End/Undo/其他截止先完成则不重复 | Pub 仅正常 Turn Completed；Priv 立即失效 | 不公开主动/15s/90s 结束原因；末张主抽后 Settling |
| A02 | FinalTurns scheduler | CABO 已调用，当前合法 Final Turn Completed，牌堆未耗尽 | 下一个未行动对手取得一次 Turn；最后人完成则 Settling | 不允许二次 CABO，已行动者不得再行动 | Pub 当前行动者/剩余末次资格；Priv 新 Turn 合法信息 | 主 DrawPile 空/罚牌抽空提前 Settling；不启动不必要 Turn |
| A03 | Round Settling / Completed | 所有应执行 Turn 已完成或 DrawPile 空且当前 Turn 完整结束 | 一次结算手牌、Kamikaze/CABO/特别 +10；正式 Completed | Game 强制 Aborted **先成立**则该活动 Round 无分；Settling 不接受新普通 Turn | Settling 不揭全手，Completed 后与 Game 总分一致公开 | 同时满足多种结束条件只结算一次 |
| A04 | Game Score / 100 Reset / End | 新 Completed Round 的结果待恰好应用一次 | 全员加本轮分、首次恰好100者置50，然后任一>100结束 Game，最低累计及最后 Round Score 判 Winner | 不允许先判断 End 再处理重置；不得二次加分 | Pub 应用后统一成绩与 Winner；Priv 不泄露未完成 Round | 若未结束且无有效管理 Abort，开启新 Round InitialReveal |
| A05 | Settling management queue | Host 管理请求在正式截止前取得资格，Round 正在 Completing / Settling | 先 A03/A04，再依权威顺序、动态 Host/目标资格处理：仍 Playing 方可 Kick/Disband | Game Completed 后不可再将其 Abort；先 Rejected 管理请求不阻止后续有资格者 | Pub 最终 Game/Room 事实 | 新 Round 只能在合格管理请求处理结束后启动 |
| A06 | Game Aborted | Playing Host Kick/Disband 合法正式成立 | 活动 Turn/Round Aborted，秘密授权失效，无本活动 Round Score；历史 Completed Round 保留 | 已 Completed Game 不允许 Abort；不能把未完成 Replace 变正常效果 | Pub Game Aborted/Room 状态，**不**泄漏活动牌 | 终局吸收，接管/重连不能重启 |
| A07 | Takeover（服务器） | 同 Player 新可信连接正式接管唯一原连接 | C2 成为唯一有效端，C1 当前资格失效；向 C1 尽力私有通知 | C1 接管后不得首次 Accepted 新 Command / 新接收私人结果；接管**不自动补偿** | Priv 接管通知给旧端、View 给新端；**无额外 Game 公共断线事件**（Connected→Connected） | 原 Accepted/Rejected 不变；已提交 Replace 不回滚，原时钟持续 |
| A08 | Disconnect grace deadline | 当前有效连接底层断开，已确定的有限宽限截止仍未恢复 | 逻辑 Disconnected；Game Playing 发布独立连接 Public Event；Lobby 发安全在线通知 | 宽限内恢复不产虚构事件；旧连接/旧 deadline 不能覆盖新接管 | Pub 逻辑变化但无设备细节 | Game Completed/Aborted 后不再新增旧 Game 连接 Event |
| A09 | Reconnect (after formal Disconnected) | 同 Player 可信重新连接，上一有效端已失效 | 逻辑 Connected；恢复当前 View 及仍有效私人上下文 | 不发历史过期秘密，不重置 45/90/15s | Pub 游戏仍 Playing 时连接 Event；Lobby Room 通知；Priv 原有效数据 | 旧 Game 授权与新 Game 参与者不同；旧通知不覆盖新 View |
| A10 | Historic Command Result lookup | 原可信 Requester、完整 Request Identity、在适用查询期限内 | 返回不可变原结局与可获授权同步参考进展 | Beyond scope = Outside Scope，不能说 Not Yet Determined；他人不可读 | 仅原请求者 Result；无游戏动作 Pub | 不重新执行；过期秘密不能再提供 |
| A11 | Client result receipt ACK | 原接收连接可信确认，绑定 Request Identity + 对应 Result | 记录原协议层接收事实；与领域效果无关 | 无 ACK 表示未知；不能把发送成功当收到；迟到 ACK 不重新授权 C1 | 非公共确认；不改变 Pub/Priv | 重复 ACK 幂等，不影响 Command 结局 |
| A12 | Completed Game historic result lookup | 原 Game Participant、Game Completed、正式终局结果仍在专门保留期限 | 返回正式最终成绩、Kamikaze/100 reset/Winner 等允许的终局数据 | 新 Room 成员无自动访问；Aborted Game 不伪造 Completed；期限过后不承诺查询 | 授权历史结算；不返回 Peek/Spy 旧秘密或事件回放 | 不重算、不改写 Game 终局，跨 Game 权限独立 |
| A13 | View/Event/Context recovery | 原 Player 鉴权、适用 Game/Lobby 身份、当前语义兼容 | 最新权威 View，仍合法 Decision Context/私人结果；Event 可独立通知 | 不兼容必需语义停止相关操作、引导升级；Event 不保证完整回放 | View 权威；Event 不含隐藏值；私有 grant 严格截止 | 旧事件/旧 Context/旧 Lobby 通知不覆盖较新 View |

## F. 逐场景验收用例：具象输入与唯一预期

> **合同静态审核：通过**指预期与已确认契约一致；**运行验证：未执行**。若开发后表现不同则阻断冻结/上线。

| 测试 ID | 场景输入（固定边界） | 唯一预期 / 禁止行为 | 契约审核 |
|---|---|---|---|
| F01 | 非 Host 已 Ready 但 Disconnected；有效 Host 在 Lobby Start | Start 可 Accepted 并冻结离线成员；共享 45s 不暂停 | 通过 |
| F02 | Host 已失去唯一有效连接，旧端请求首次提交 Start | 不得因 Host 身份继续 Accepted；未完成 Request 不在接管后首次成立 | 通过 |
| F03 | InitialReveal 已确认两张但未 End，原 45s 仍有效 | 可继续在原许可内查看；**不可选第三张**；不自动 Personal End | 通过 |
| F04 | InitialReveal 旧端未看第二张，45s 截止后重连 | 无第二次查看/新 45s；进入正常轮次 | 通过 |
| F05 | Turn 第 20s 正式弃 Spy 开能力，第 34s 确认目标 | 仅在第 35s 前尚余的时间合法；**不重新给予 15s** | 通过 |
| F06 | Turn 第 83s 首次正式弃 Spy 启动能力 | 只能使用至原第 90s，最多 7s | 通过 |
| F07 | Spy 目标未确认，原能力剩 3s，Undo 首次成功 | 同主抽牌恢复完整决策；原 90s 保留；原弃牌 Event 保留且新 Event 引用它 | 通过 |
| F08 | Undo 成功后再次弃同 Spy 能力牌使用 | 新独立最多 15s，不超过原 90s；Turn 内第二次 Undo 必拒绝 | 通过 |
| F09 | Spy 目标已 Accepted，数字尚未送达，用户尝试 Undo | Rejected；不能因为没收到值就撤销已确认目标 | 通过 |
| F10 | Spy 未确认目标时直接主动 End | 立即完成 Turn；不要求先选目标；Event 不披露主动/超时原因 | 通过 |
| F11 | Spy 目标确认与 Undo 在截止边界竞争 | 先正式 Accepted 的合法操作胜出；另一个不产生双结果 | 通过 |
| F12 | 2 张旧牌不匹配、主抽为最后一张 | 主牌仍普通插入一端，**没有** >=3 的 +10 | 通过 |
| F13 | 主抽恰好最后一张，>=3 旧牌不匹配 | 旧牌翻正，主牌弃掉，**没有两张插入**，本轮 +10，Turn 后 Settling | 通过 |
| F14 | 主抽后剩最后一张、>=3 不匹配、罚牌恰好抽空 | 主牌与罚牌都按方向入列，**没有**替代 +10 | 通过 |
| F15 | >=3 失败，新牌右端方向已 Accepted，罚牌方向超时 | 主牌保留右端、罚牌默认左端；**一次**原子提交 | 通过 |
| F16 | Replace 已冻结 AwaitingPlacement，Host Kick 先正式导致 Abort | 不提交冻结结果、不揭隐藏旧牌、不计 Aborted Round 分数 | 通过 |
| F17 | Replace 完整已提交，手机接管，旧电脑没有 ACK | 历史 Accepted 与领域效果不变；新端不能接管补偿 Replace | 通过 |
| F18 | CABO 已调用、当前 Final Turn 使主 DrawPile 耗尽 | 当前 Turn 处理完整后立即 Settling；余下 Final Turn 不再创建 | 通过 |
| F19 | CABO 呼叫者与另一玩家真实手牌同为全场最低 | CABO 成功，呼叫者 Round Score 0（Kamikaze 优先） | 通过 |
| F20 | CABO 呼叫者真实 8；别人真实 6 另有 +10 | CABO 失败得 18；别人得 16；以真实和判断 | 通过 |
| F21 | 轮末精确 `[12,12,13,13]` | Kamikaze 本人 0 其他 50；覆盖其他处罚 | 通过 |
| F22 | 某人总分原 91，加 9 且未用过重置 | 恰好100后重置50，不因恰好100 Game End | 通过 |
| F23 | 全员应用 Round Score/100重置后有任意人>100 | Game Completed，最低总分、最后 Round Score 破同分、仍并列共同获胜 | 通过 |
| F24 | Round Settling 期间合格 Host Kick，结算后 Game 已 Completed | 先结算和 Game End，不能改为 Aborted | 通过 |
| F25 | Round Settling 期间先合格 Kick 后动态拒绝，次合格 Disband | 依据顺序及最新资格继续裁决；未处理完不得开启新 Round | 通过 |
| F26 | Game Playing 中玩家底层掉线、宽限内恢复 | 逻辑 Connected 始终不变，**不产生** Disconnected+Connected Event | 通过 |
| F27 | 旧端 C1 被 C2 接管；C1 随后旧断线通知迟到 | A 仍 Connected；C1 不得使新端离线、不能收新私密数据 | 通过 |
| F28 | Game Completed 后成员重连 | 不新增旧 Game 连接 Event；Room 当前在线状态可另行更新 | 通过 |
| F29 | Lobby L1 迟到 P90 在线通知，客户端已在 L2/P2 | 旧 L1 通知完全不作用于 L2；不可跨 epoch 比较进展 | 通过 |
| F30 | Lobby L2 完整 View P40，收到在线通知 P43，中间 P41/P42 未知 | 不能标记整份 Room View P43 完整；先同步权威 View 或可验证安全局部展示 | 通过 |
| F31 | G1 Event P20 已产生，G1 View P25 更新；P20 Event 迟到 | 事件可用于历史告知但不能回退 View；多条同 P20 Event 按 Event Identity 分别去重 | 通过 |
| F32 | Peek/Spy 15s 服务器截止完成 Turn，涉及来源字段的公开边界 | 不得用来源类型/独立 timer Event 泄漏 CM-39 保护的结束原因 | 通过 |
| F33 | Accepted 原结果 P20，查询时最新 P35 | 原受理进展 P20、当前同步参考 P35；不把查询当新执行 | 通过 |
| F34 | 同 Request Identity、不同规范化目标重试 | 拒绝身份冲突；不能重选旧 Peek/Spy 目标 | 通过 |
| F35 | R101 Accepted，后 Undo R102 Accepted；查询 R101 | R101 仍 Accepted；R102 独立 Accepted；当前 View 反映补偿后牌堆 | 通过 |
| F36 | G1 Completed 后 Room 启动 G2，新加入成员 D 查询 G1 | D 无自动权限；原 G1 Participants 保留期内按 G1 身份可查合法终局 | 通过 |
| F37 | G1 Aborted，未完成 Round 有未知背面牌 | 不产生完成终局/未完成 Round Score，不公开活动隐藏牌 | 通过 |
| F38 | 旧客户端理解 Event 但不理解当前 Player View 必需语义 | 不继续基于猜测 View 提交相关操作；独立授权的安全 Result 查询仍允许 | 通过 |
| F39 | Game R1/R2 使用相同语义版本，R1 Decision Context 迟到 | 不允许在 R2 应用；完整 Game/Round/Turn/Decision 必须一致 | 通过 |
| F40 | 玩家主动 End Spy 和 15s 截止在同一边界 | 只一个 Turn Completed，不复活秘密；不能额外直接披露结束原因 | 通过 |

## G. 冻结验收签收表

| 检查项 | 当前结果 | 证据/剩余工作 |
|---|---|---|
| 106 项 CM 的统一业务口径 | **已形成审计稿** | 配套统一合同；CM-71 修订链显式记录 |
| Command 与服务器自动动作逐类 Guard/Success/Reject/Timeout/Event/Private/Idempotency 覆盖 | **契约静态覆盖完成** | B～E，共 44 项逻辑动作；N/A 明确列明 |
| 代表性并发、计分、权限与秘密测试 | **预期编排完成** | F01～F40；尚未执行后端或端到端测试 |
| 旧 Phase 1–3 文件与最终确认语义一致 | **已在本轮同步关键修订** | 旧版表述已做定点修订，并以统一契约明确在线阶段的权威解释 |
| 用户对本稿逐项签收 | **已授权复核后上传** | 本轮用户已明确授权审阅后上传；不代表代码通过测试 |
| Phase 4 正式冻结 | **静态契约冻结候选** | 完成文档同步与静态审阅后可进入下一阶段；后端和端到端测试仍属于后续实现验收 |

**审计判断**：未发现需新增游戏玩法 A/B 决策才能完成本矩阵的确定性冲突；缺少的是文档同步与正式签收。在线 Undo 与能力 15 秒已作为获批准的 House Rule/在线策略同步至规则 SoT；后续实现若与本矩阵不符，应先定位规则或实现差异。