# MOB-026：全局搜索命中消息正文

状态：**有条件完成**（代码已入 `dev`，长会话 / 降级状态 smoke 待验收）

负责人：`mob_026_global_message_search`

执行仓库：`dangjingtao/uichat-mira-mobile`

首次派卡基线：`dev @ a90dfb6c2d80079fd85084fff0214968e137e653`

## 背景

当前全局 `SearchScreen` 只读取 `miraHostClient.listSessions()`，搜索条件也只匹配 `session.title`。因此会出现已确认的 dogfood 复现：某个会话正文里明确存在「雷雨」，全局搜索「雷雨」却返回“没有找到”。

MOB-014 的“查找”合同只负责**当前会话内查找**，并明确没有扩展成跨会话全文搜索。本卡是新的全局搜索能力，不重开 MOB-014。

## 目标

1. 全局搜索能够命中 Thread 标题，也能命中已有消息正文。
2. 搜索结果让用户能看出命中的 Thread、消息摘要与命中内容，并能进入对应会话。
3. 不为了实现搜索私自发明新的 Host `/search` API。
4. 在会话较多时避免无边界请求风暴、明显输入卡顿或旧查询结果覆盖新查询。

## Scope

### 搜索数据源

施工前先核对当前 Host / Remote runtime manifest 与客户端能力：

- 如果当前仓库已经存在 canonical 的跨 Thread search 能力，且 Remote Gateway / device scope 明确发布，则使用该真实能力；
- 如果不存在，则基于现有 canonical 方法实现 Mobile 侧有界搜索，例如：
  - `listSessions()` 获取 Thread；
  - 对候选 Thread 使用已有 `getMessages(sessionId)`；
  - 设置合理并发上限、查询 debounce / cancellation 或等价机制；
  - 新查询必须能使旧查询结果失效，不能出现输入「雷雨」却被前一条查询结果覆盖。

**禁止直接脑补 `/search`、`/messages/search` 等不存在的 Host route。**

### 结果模型与 UI

- Thread 标题命中继续显示为对话结果。
- 消息正文命中至少展示：
  - Thread 标题；
  - 一段足够识别的正文 snippet；
  - 必要时展示消息角色 / 时间等已有可靠字段。
- 中文文本按用户看到的正文做实际 substring / canonical search 语义；不能因为没有分词库就搜不到连续中文关键词。
- 点击消息命中至少进入对应 Thread。
- 如果当前导航已经支持可靠的 message anchor，可复用；**没有则不要为了本卡伪造“精确跳到某条消息”能力**。
- 「全部 / 对话」筛选不能让消息正文结果被错误过滤掉。图片 / 文档 / 项目等当前未实现分类不在本卡补齐。

### 状态与错误

- 空关键词不发起正文 fan-out。
- 加载、无结果、网络 / Host 不可用需要有真实状态。
- 部分 Thread 搜索失败时不得把已成功的结果全部清空；可以展示可理解的降级状态。
- 搜索不得修改 Thread / Message authoritative state。

## Hard Constraints

- 不新增未经 Host 合同发布的 API。
- 不把本卡扩大成离线全文索引、SQLite/FTS 重构或账户级搜索服务。
- 不改变 MOB-014 当前聊天查找合同。
- 不为“搜索结果好看”复制一套 Thread / Message 数据模型。
- 不把 Host/Remote 不可达伪装成“没有结果”。

## Must Read

- `AGENTS.md`
- `docs/work-ledger.md`
- `docs/task-cards/MOB-014-mobile-conversation-tools.md`
- `src/screens/SearchScreen.tsx`
- `src/api/miraHostClient.ts`
- 当前 Remote Host / manifest capability 相关代码与 tests
- `src/types/index.ts`

## Execution Entry Points

- `src/screens/SearchScreen.tsx`
- `src/api/miraHostClient.ts`（仅在复用已有 canonical 能力需要轻量封装时）
- 可新增一个小型、可测试的 search domain/helper；不要把请求调度逻辑继续堆进 screen

## Validation

自动化至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

必须新增与本卡直接相关的搜索测试，至少覆盖：

1. Thread 标题命中；
2. Thread 标题不命中、消息正文「雷雨」命中；
3. 中文连续关键词可检索；
4. 多条消息 / 多 Thread 命中结果稳定；
5. 空关键词不触发正文 fan-out；
6. 快速连续输入时旧查询不能覆盖新查询；
7. 单个 Thread 获取消息失败时已成功结果仍可用；
8. 点击结果进入正确 Thread。

真机 smoke 使用已有含「雷雨」正文的 Thread 复现并确认修复；若该数据不可用，可创建等价测试 Thread，但不得声称使用了原始数据。

## Parallel / Integration

可与 MOB-025、MOB-027、MOB-028、MOB-029 从同一 `dev` base 并行。若 Builder 发现必须修改 Remote protocol、shared capability mapping 或 Desktop Host 才能完成，应立即停止在该决策点并报告，不得把跨仓协议扩张偷偷塞进本卡。

## Open / Unknown

当前基线未验证存在 canonical 跨 Thread search route。Builder 必须在施工开始时重新检查当前 HEAD / runtime contract；不存在时走已有 `listSessions + getMessages` 的有界实现，不得自行造 route。

## Handoff

先读取 Must Read 并确认当前 Host 能力，再施工。仓库事实若已变化，以当前事实为准；若变化会改变“Mobile 有界搜索 vs canonical Host search”的实现方向，先报告差异再继续。
