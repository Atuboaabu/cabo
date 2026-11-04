# CABO — State Machines

> 版本：Draft 0.2（Phase 2 已审核稿）  
> 状态：主要业务状态、转换与一致性规则已确认；部分并发实现细节留待后续阶段  
> 依据：docs/game-rules.md、docs/domain-model.md、AGENTS.md

## 1. 范围及术语

本文定义 CABO 在线多人游戏 Room、Game、Round、Turn 的业务状态、转换、Guard（合法条件）、跨对象不变量和验收场景。坚持 Contract First 与 Server Authoritative。玩法及计分以 docs/game-rules.md 为准；线上超时策略以已确认的 docs/domain-model.md 为准。

本文不设计数据库、ORM、Aggregate Root 最终边界、API/WebSocket、锁、事务、定时器或基础设施。

- **State**：对象当前的业务阶段。
- **Domain Fact**：影响行为合法性但无须成为独立状态的事实，例如牌来源、抽牌堆是否耗尽、CABO 呼叫者。
- **Guard**：允许接纳命令或发生转换的必要业务条件。
- **Decision Frozen**：玩家选择和服务器匹配判定已经正式确定，不允许再选择或撤销。
- **Effects Committed**：此次完整操作的牌列及可见性变化正式生效。
- **Completed / Aborted**：正常完成与异常终止是不同且不可互转的终局。

状态图与转换表是领域约束，不代表代码类或持久化结构。

## 2. Room 状态机

### 2.1 状态

| 状态 | 业务含义 |
| --- | --- |
| Lobby | 成员加入、离开、Ready、Kick、合法 Start；不要求一直满足开局人数 |
| Playing | 对应一局活动 Game；当前成员不能以普通 Leave 退出，也不能加入新成员 |
| Closed | 房间已关闭，不得重新开放 |

### 2.2 转换

| 当前状态 | 事件 | Guard / 效果 | 下一状态 |
| --- | --- | --- | --- |
| Lobby | Join | 当前人数少于 4 | Lobby |
| Lobby | Ready / Unready | 当前非房主成员 | Lobby |
| Lobby | Member Leave | 当前非房主成员退出；仅移除其 Ready | Lobby |
| Lobby | Host Kick | 房主移除其他成员；历史 Game 不变 | Lobby |
| Lobby | Host Leave，有继任者 | 先将房主身份交给仍在房内、加入时间最早的其他成员，再移除原房主 | Lobby |
| Lobby | Host Leave，无继任者 | 唯一成员离开，关闭 Room | Closed |
| Lobby | Host Start | 2–4 人、所有非房主 Ready、没有活动 Game；创建新 Game | Playing |
| Lobby | Host Disband | 房主关闭 Room，历史 Game 不变 | Closed |
| Playing | Disconnect / Reconnect | 只改变连接事实，不改变成员、房主或 Game 身份 | Playing |
| Playing | Game Completed | 正常终局，重置剩余非房主 Ready | Lobby |
| Playing | Host Kick | 活动 Game Aborted，剔除目标，重置剩余非房主 Ready | Lobby |
| Playing | Host Disband | 活动 Game Aborted，关闭 Room | Closed |
| Playing | 普通 Leave（包括房主） | 不合法，不自动转移房主或解散 Room | 不变 |
| Closed | Join、Ready、Start 等 | 拒绝 | Closed |

房主不需要 Ready，房主的 Start 即表示开局同意。Lobby 成员 Leave / Kick 后**其他成员 Ready 保留**；Game 正常结束或 Playing Kick 返回 Lobby 则统一重置非房主 Ready。新房主过去的 Ready 不再影响开局条件；其他非房主的 Ready 保留。

未关闭 Room 必须且只能有一个房主。Room Closed 不改写已结束 Game 的参与者、累计或赢家；历史 Game 的参与者集合不会因后续成员移除而改变。Room Playing 必须与当前活动 Game 保持一致。

## 3. Game 状态机

### 3.1 状态

| 状态 | 业务含义 |
| --- | --- |
| Playing | 一局固定参与者的游戏进行中，可以包含多个 Round 和不可操作的跨轮推进 |
| Completed | 正常结束，累计与赢家确定 |
| Aborted | 由有效的房主管理操作提前终止，无赢家 |

不设置 BetweenRounds / SettlingRound 独立状态。终局 Game 不能再次 Playing，Room 下次 Start 应新建 Game 并重置新局累计及重置资格。

### 3.2 转换

| 当前 | 事件 | 下一状态 / 行为 |
| --- | --- | --- |
| 新 Game | 合法 Room Start | Playing；固定参与者与顺时针座次，自动开始首个 Round |
| Playing | Round Completed，应用得分及重置后无人超过 100 | Playing；按跨轮顺序自动开始新 Round |
| Playing | Round Completed，应用得分及重置后有人超过 100 | Completed；确定赢家 |
| Playing | 有效的 Playing Kick / Disband | Aborted；终止活动 Round / Turn 与查看权限 |
| Completed / Aborted | 后续继续、覆盖正常终局 | 拒绝 |

### 3.3 已完成 Round 的严格推进顺序（SM-G2 / SM-G3）

当 Round **正式 Completed** 后，Game 必须：

1. 取得本轮最终 Round Score，对每名参与者**恰好应用一次**。
2. 对本局未用过重置机会、加分后**恰好 100** 的玩家，将累计重置为 50；每人每局仅一次。
3. 在所有玩家加分与适用重置完成后，检查是否有人最终累计**大于 100**。
4. 若达到 Game End，确定 Winner，Game Completed；后续 Kick / Disband 不得将其改为 Aborted。
5. 若 Game 仍 Playing，先处理**下一 Round 正式启动前已经有效到达**的 Kick / Disband；若因此 Aborted，则不再启动新 Round。
6. 若没有导致中止的有效管理操作，则按上一轮最终 Round Score 确定起始玩家并自动启动新 Round，进入其 InitialReveal。

跨轮推进不可向玩家开放尚未创建的新 Round 的操作，也不得暴露不一致的部分累计结果。已正式 Completed 的 Round 不能被后来改成 Aborted；其得分不能因管理操作被跳过。

房主管理操作若先于 Round Completed 正式成立，则活动 Round Aborted，不产生该轮正式得分。已 Completed 的 Game 不能再因管理操作改成 Aborted；其所属 Room 可按 Lobby 规则另行管理成员。

**后续实施待决**：正式受理时刻与并发先后裁决机制；此处只确认业务次序，不规定实现技术。

### 3.4 终局、下一轮

Game End 触发：任何参与者最终累计超过 100（不是恰好等于 100）。Winner：全体参与者中最终累计最低者；并列比较最后一个 Completed Round 的最终 Round Score；仍并列则共同获胜。

若继续 Game，选上一 Round **最终 Round Score 最低**者为新轮起始玩家；并列时从上一 Round 起始玩家**本人开始**沿顺时针选第一个并列最低者。不使用累计分数决定起始玩家。新 Round 自动开始，但其首个 Turn 仍须等待所有初始查看流程结束。

### 3.5 不变量

- G-I1：Completed Round 对 Game 累计恰好生效一次，不因重复通知再次得分、重置或启动 Round。
- G-I2：重置资格每名玩家每局最多用一次；每次只对加分后恰好 100 者生效。
- G-I3：Game End 判断不得先于所有玩家得分和适用重置。
- G-I4：Completed / Aborted 是互斥且不可恢复的终局；Aborted 没有 Winner。
- G-I5：Aborted Game 保留历史 Completed Round 的得分及必要记录；活动 Aborted Round 无正式得分。
- G-I6：已 Completed Round 的结算应用与 Game End 检查先于后续管理操作；若 Game 已正常 Completed 不可改写。
- G-I7：结算后 Game 未结束时，先处理下一轮启动前已经有效到达的 Kick / Disband，再决定是否自动启动新 Round。
- G-I8：Game Playing 不意味着跨轮结算时已开放合法玩家操作。

## 4. Round 状态机

### 4.1 状态

| 状态 | 业务含义 |
| --- | --- |
| InitialReveal | 每名玩家的初始两牌秘密查看流程尚未全部终结 |
| Playing | 正常行动，可在合法正常 Turn 起点呼叫 CABO |
| FinalTurns | 已呼叫 CABO，呼叫者以外的玩家依顺时针依次完成最后行动 |
| Settling | 不再接受游戏行动，形成正式 Round Score |
| Completed | 正式本轮得分已形成 |
| Aborted | Game 强制中止导致当前轮不正常结算 |

FinalTurns 是独立状态；不建立 EndingPending。抽牌堆是否为空是独立的 Domain Fact，而非状态。

### 4.2 转换

| 当前 | 触发 / Guard | 下一状态 |
| --- | --- | --- |
| 新 Round | 洗牌发牌、发放初始查看机会 | InitialReveal |
| InitialReveal | 所有人主动结束/放弃或超时结束初始查看 | Playing，并授予起始玩家首个 Turn |
| Playing | 普通 Turn 完成，抽牌堆仍有牌 | Playing，创建下一 Turn |
| Playing | 合法 CABO 呼叫 Turn 完成 | FinalTurns，记呼叫者并安排剩余玩家 |
| Playing | 抽牌堆耗尽且当前 Turn 完成 | Settling |
| FinalTurns | Final Turn 完成，仍有人待行动且抽牌堆未耗尽 | FinalTurns，安排下一人 |
| FinalTurns | 最后一个应完成的 Final Turn 完成 | Settling |
| FinalTurns | 抽牌堆耗尽且当前 Turn 完成 | Settling |
| Settling | 完整形成最终 Round Score | Completed |
| 任意非终局状态 | 所属 Game 有效强制中止 | Aborted |

### 4.3 InitialReveal

每轮重新洗牌、每人发四张背面牌；每人最多秘密查看两张**不同位置**的初始牌。每人总时限 45 秒，自 Round 正式开放其机会起计。可提前结束（剩余机会作废），仍有未看机会时应提示二次确认；确认提示不暂停时限。断线不结束或重置机会。全部成员初始查看流程终结前不得创建首个 Turn，超时不表示实际看满两张。

### 4.4 CABO 与 FinalTurns

只有 Playing 中的合法正常 Turn **开始时**可以呼叫 CABO。呼叫 Turn 正常 Completed 后，Round 在一致业务结果中记录呼叫者并进入 FinalTurns。呼叫者本轮不再行动，其他玩家依顺时针最多各执行一次最后 Turn；这些 Turn 可正常取牌、替换、弃牌、使用技能，但不得再次呼叫 CABO。FinalTurns 的剩余行动名单由 Round 决定，不属于 Turn 的调度职责。

### 4.5 抽牌堆耗尽

抽空牌堆不自动结束活动 Turn：Round 留在现有 Playing / FinalTurns，**不再创建新的 Turn**，但必须允许当前 Turn 完成已经合法开始的操作。

尤其不能仅因为抽牌堆为空，就拒绝**当前活动 Turn**尚需完成的 Peek / Spy、Swap、Replace 的保留位置/插入方向等合法选择。最后主抽牌触发 Spy 时，秘密查看主动关闭或超时关闭之后才能完成 Turn；惩罚牌恰好取走最后一张时，也须按规则放置完惩罚牌。当前 Turn 完成后才 Settling。

如果多个轮次终结条件同时成立，只进入 Settling 一次、形成一份正式 Round Score。Game 有效中止先成立，则当前 Round Aborted，不进行正常结算。

### 4.6 轮次得分

Round 计算真实手牌总和、CABO 成败及处罚、最后主抽牌三张以上替换失败的适用额外 +10，以及 Kamikaze 的最高优先级。CABO 是否成功比较**实际手牌总和**而不是附加罚分后的 Round Score；Kamikaze 恰为 [12,12,13,13] 时，本人 0、其他玩家各 50，覆盖额外罚分。分数规则严格遵照 docs/game-rules.md。

### 4.7 不变量

- R-I1：每轮同时最多一个活动 Turn；Round 决定行动者与下一 Turn。
- R-I2：InitialReveal 全部结束前没有首个 Turn。
- R-I3：FinalTurns 的 CABO 呼叫者不再行动，也不允许其他玩家再次呼叫 CABO。
- R-I4：抽牌堆耗尽阻止**新 Turn**，但不能阻止当前 Turn 必要的合法操作。
- R-I5：Settling 不接收玩家游戏操作，Completed/Aborted 不可互转。
- R-I6：活动 Turn 必须 Completed 才能正常 Settling；Game 中止可令活动 Turn 和 Round Aborted。
- R-I7：一个 Completed Turn 的完成结果不能重复推进 Round 或创建多个后续 Turn。

## 5. Turn 状态机

### 5.1 状态

| 状态 | 业务含义 |
| --- | --- |
| AwaitingAction | 等待合法选择抽牌来源或于允许时呼叫 CABO |
| AwaitingCardDecision | 已获得本次牌，等待合法处理；牌来源为固定 Domain Fact |
| AwaitingPlacement | 多牌 Replace 决策已冻结，等待一个或多个必需位置选择 |
| AwaitingAbilityTarget | 已选择能力，等待合法目标，可在目标提交前放弃 |
| AwaitingRevealConfirmation | Peek/Spy 目标已确认并开放临时查看，等待结束 |
| Completed | 本次合法行动完成 |
| Aborted | Game 强制中止，本 Turn 未正常完成 |

### 5.2 转换

| 当前 | 行为与 Guard | 下一状态 |
| --- | --- | --- |
| AwaitingAction | 合法从抽牌堆或弃牌堆取牌 | AwaitingCardDecision |
| AwaitingAction | 合法正常 Turn 开始时呼叫 CABO | Completed |
| AwaitingCardDecision | DrawPile 牌直接弃掉、不执行能力 | Completed |
| AwaitingCardDecision | 合法单牌替换 | Completed |
| AwaitingCardDecision | 多牌替换有必要放置选择 | AwaitingPlacement |
| AwaitingCardDecision | 多牌替换无需放置选择的特殊分支 | Completed |
| AwaitingCardDecision | 抽牌堆取得能力牌，弃牌并选择使用能力 | AwaitingAbilityTarget |
| AwaitingAbilityTarget | 目标尚未正式确认，主动/超时放弃能力 | Completed |
| AwaitingAbilityTarget | Peek/Spy 合法目标正式确认、临时查看开放 | AwaitingRevealConfirmation |
| AwaitingAbilityTarget | Swap 完整合法目标确认且交换已生效 | Completed |
| AwaitingRevealConfirmation | 主动结束或有效截止时间到期 | Completed |
| AwaitingPlacement | 当前放置完成但尚有下一项 | AwaitingPlacement |
| AwaitingPlacement | 所有放置选择完成，完整 Replace 正式生效 | Completed |
| 任意活动状态 | 所属 Game 有效强制中止 | Aborted |

Turn 不自行创建下一 Turn、决定 Round End 或结算 Game 得分。断线不让 Turn Aborted；Completed/Aborted 不能继续行动。

### 5.3 AwaitingCardDecision 的来源守卫

同一 AwaitingCardDecision 状态下，**已取得牌来源不可由客户端任意更改**：

- 来自 DrawPile：可弃掉并决定是否发动本次牌的合法能力，或尝试 Replace；成功入列牌背面朝上。
- 来自 DiscardPile：只能拿弃牌堆最上面正面牌，**必须 Replace**，不能直接弃牌或发动能力；成功入列保持正面朝上。
- 抽到抽牌堆最后一张不取消本次合法处理选择；处理完成后由 Round Settling。

### 5.4 多牌 Replace：冻结与效果提交

**冻结**：正式接受所选旧牌集合并依据隐藏真实值确定成功/失败，冻结结果及所有待完成的放置任务；不可改选旧牌、改为弃牌或重新判定。未提交的客户端勾选草稿不视为已冻结 Replace。

**AwaitingPlacement**：统一等待状态，但当前待处理任务必须明确：成功时新牌留在所选哪个旧牌位置；普通失败时新牌插左/右端；至少三张失败且有惩罚牌时，新牌方向确认后再决定惩罚牌方向。确认的任务不可更改，下一任务不能误用上一任务的重复请求。惩罚 Card 如已归属当前未完成行动，不得被其他行动重复取得。

**正式生效**：所有必要放置选择确定后，一次性应用完整牌列、翻面、弃牌及可见性结果，继而 Completed。AwaitingPlacement 期间不得对外展示已完成替换的中间牌列效果。Game 中止时，尚未正式应用的 Replace 不再提交牌列变化；不倒改之前已正式发生的取牌等事实。

**无需 AwaitingPlacement 的特例**：最后一张**主抽牌**触发至少三张旧牌替换失败时，旧牌原位翻开、主牌弃掉，不插新牌、不抽额外惩罚牌，本轮适用 +10，直接完成 Turn。若最后主抽牌只尝试两张且失败，则新牌正常入列，不适用上述 +10。若是**惩罚牌**恰好耗尽牌堆，则惩罚牌正常入列、无该替代 +10，完成当前 Turn 后 Settling。

### 5.5 特殊能力

- Peek：目标为行动者自己的一张背面牌。
- Spy：目标为其他玩家的一张背面牌。
- Swap：目标为自己的一张及另一玩家的一张，公开或背面牌都合法；交换时各具体 Card 的正反面状态保持。
- 仅从 DrawPile 抽到 7–12 且弃掉，才可选择执行对应能力；所有能力可自愿放弃。
- 未确认合法目标时可放弃，超时则放弃；无 Peek/Spy 合法目标时不得强行开放查看。
- Peek/Spy 目标确认后进入 AwaitingRevealConfirmation，**不得重选**。关闭查看只结束本次查看授权，不能撤销已生效技能。
- Swap 完整合法目标确认且交换生效后直接 Completed，无秘密查看状态，重复请求不能重复交换。

### 5.6 时限与超时兜底

每个 Turn 自 Round 正式授予行动权起最长 **90 秒**；断线不暂停也不重置。服务器权威判断截止时间，前端计时仅供显示。

| 当前条件 | 到期默认行为 |
| --- | --- |
| AwaitingAction，合法可抽牌 | 从抽牌堆取一张并弃掉，不用能力 |
| AwaitingCardDecision，DrawPile 来源，仍可弃牌 | 弃掉本次牌，放弃未执行能力 |
| AwaitingCardDecision，DiscardPile 来源 | 必须单牌替换当前最左侧合法旧牌 |
| AwaitingPlacement，成功，未选新牌保留位置 | 选已选旧牌中最靠左的位置 |
| AwaitingPlacement，普通失败，未定新牌方向 | 默认当前牌列左端 |
| AwaitingPlacement，普通失败，未定惩罚牌方向 | 默认当前牌列左端；不改已经确认的新牌方向 |
| AwaitingAbilityTarget，目标未确认 | 放弃未执行能力 |
| AwaitingRevealConfirmation | 自动关闭秘密查看、撤销授权并完成 |

已冻结 Replace 不得因超时改成弃牌；已执行 Swap 不得再执行。所有兜底依当前阶段合法性处理。超时造成的 Completed 仍由 Round 正常调度，不设 TimedOut 独立终局。

### 5.7 Turn 不变量

- T-I1：一次只能存在一个当前等待阶段，操作受来源、技能、Round 阶段等已确定事实约束。
- T-I2：已冻结 Replace 不允许重选目标；放置任务完成顺序固定且每项只确认一次。
- T-I3：完整 Replace 牌列效果仅在全部必要选择完成后生效。
- T-I4：Peek/Spy 目标确认后不能重选；授权结束后不能重新查看。
- T-I5：Swap 正式生效后不能重复交换。
- T-I6：Completed/Aborted 不再接受行动，同一结果不得重复推进 Round。
- T-I7：Turn 不负责下一行动者、Round 得分或 Game 终局。

## 6. Temporary Reveal 与隐藏信息

Temporary Reveal 是特定步骤授予特定查看者、特定 Card 的限时权限，不要求单独建独立状态机或永久 PlayerKnowledge。

- InitialReveal：每人每轮最多看两张不同初始牌，总时长 45 秒，可提前结束放弃剩余机会；尚有未查看机会时需要防误触二次确认。
- Peek/Spy：目标确认并授权开放后最多 **15 秒**，实际结束时间不晚于本 Turn 90 秒截止时间；可主动提前关闭。
- Peek/Spy 目标已确认但结果尚未展示，提前结束前需要二次确认；已看到结果时可直接关闭。
- 点击关闭但尚在二次确认时，查看仍受原有时限约束；取消提示继续原步骤；提示**不暂停**倒计时。
- 查看步骤终结、有效截止到期、Turn/Round/Game 有效终结或强制中止时，权限失效；重连仅能恢复仍有效的同一次查看，不允许刷新或改选目标。
- 服务器仅向当前合法查看者发送当前获准的隐藏数字；不得在公开视图里发送真实值再加 visible=false 等掩码。稳定内部 Card ID 也不能默认公开以免追踪背面牌。
- 授权终结只意味着服务器不再提供秘密值，并不意味着能消除玩家已经记住的信息。
- 主动关闭、超时关闭与中止只产生**一次**终结结果，不得重复完成 Turn 或恢复查看权限。

## 7. 跨对象一致性

1. Room Start 创建新 Game 并冻结参与者；Room 成员变动不改写历史 Game。
2. Game 统筹跨轮累计、Game End 与下一 Round；Round 只形成最终 Round Score。
3. Round 调度 Turn；Turn 只形成一次行动结果，不自行确定下一玩家。
4. Round Completed 必须对 Game 应用一次且只应用一次；Round Aborted 不形成正式 Round Score。
5. 已完成 Round 结算与 Game End 检查先于后续管理操作；Game 未结束时，下一 Round 启动之前先处理已有效到达的 Kick / Disband。
6. Game 强制 Aborted 使当前活动 Round、Turn 中止、查看权限失效；已完成历史不回写为 Aborted。
7. 多个 Round End 原因同时满足只结算一次；一个 Completed Turn 不能重复创建多个下一 Turn。
8. 即使状态是 Playing，也不代表未授予行动权的用户可以操作；跨轮结算与 Turn 间的不可操作过渡不需要额外状态。

## 8. 验收场景

| ID | 场景 | 必须成立的业务结果 |
| --- | --- | --- |
| SM01 | 一人初始查看超时 | 机会失效，所有人结束初始查看才创建首个 Turn |
| SM02 | Turn 第 80 秒开始 Spy | 最多再看 10 秒 |
| SM03 | Spy 目标确认后断线重连 | 未到期恢复同一目标及剩余时间；到期不再展示 |
| SM04 | 初始查看剩余机会时主动结束 | 二次确认；确认前仍计时 |
| SM05 | 从弃牌堆取 9 | 必须 Replace，不能直接弃牌或 Spy |
| SM06 | 抽牌堆最后一张 9，执行 Spy | Spy 完整结束后 Turn Completed，Round Settling |
| SM07 | 多牌成功，位置未确认就超时 | 新牌默认选所选旧牌最左位置 |
| SM08 | 三牌失败，新牌已选右端，惩罚牌方向超时 | 新牌右端不变，惩罚牌左端；完整 Replace 仅生效一次 |
| SM09 | 最后主抽牌触发三张以上失败 | 旧牌翻开，主牌弃掉，无惩罚牌，适用 +10，无放置等待 |
| SM10 | 最后主抽牌两牌失败 | 新牌正常入列，无特殊额外 +10 |
| SM11 | 惩罚牌恰好耗尽牌堆 | 惩罚牌正常入列，无替代 +10；Turn 完成后结算 |
| SM12 | AwaitingPlacement 期间 Game Aborted | 尚未正式应用的 Replace 不提交，当前 Round 无正式分数 |
| SM13 | Swap 已执行后重复请求 | 不得再次交换 |
| SM14 | B 在 A→B→C→D 座次中呼叫 CABO | C→D→A 最后行动，B 不再行动 |
| SM15 | FinalTurns 中抽牌堆提前耗尽 | 当前合法 Turn 完成后立即 Settling |
| SM16 | 玩家首次恰好累计 100 | 重置为 50，资格消耗一次 |
| SM17 | 同轮多名玩家超过 100 | Game End，按全员最终累计与并列规则选 Winner |
| SM18 | 已完成 Round 结果重复抵达 | 不重复加分、重置、启动新 Round |
| SM19 | Round Completed 后 Kick 到达 | 先完整应用该 Round 得分、重置、Game End 判断 |
| SM20 | Game 结算后仍 Playing，下一轮前有效 Kick / Disband | 先处理管理操作，若 Aborted 不启动下一 Round |
| SM21 | Game Completed 后 Lobby Kick | 历史 Game、参与者和 Winner 不变 |
| SM22 | Lobby Ready 成员 Leave | 移除本人，其他成员 Ready 保留 |
| SM23 | Lobby 房主 Leave 且有成员 | 最早加入且仍在 Room 的其他成员继任 |
| SM24 | 最后一名房主 Lobby Leave | Room Closed |
| SM25 | Playing 房主普通 Leave 或断线 | Leave 拒绝；断线不转移房主、不解散 Room |
| SM26 | 抽牌堆为空但活动 Replace 仍需选择方向 | 不拒绝当前合法放置选择；完成后 Settling |

## 9. 明确保留的待决边界

- 玩家命令、超时及强制中止在服务器截止边界附近的具体先后裁决。
- 重复命令、失效位置引用、并发操作的具体识别和执行机制。
- 公开历史行动与各玩家专属 View / Event 的完整契约。
- 传输接口、Aggregate、事务、持久化和定时执行技术。
- 长期离线、历史数据保留期限、观战及完整 Replay。

不得在后端实现中擅自将这些未定技术/产品事项解释为新的玩法规则。

## 10. Phase 3 入口

后续以 docs/game-rules.md、docs/domain-model.md 和本文为共同依据，讨论 **Hidden Information & Player Views**：不同接收者可见的状态、公开与私人事件、临时授权、牌列位置与真实值的区别、重连后的视图重建。再逐步形成 Command / Event Contract。
