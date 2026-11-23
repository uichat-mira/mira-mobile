# MOB-085：模型直连列表页与独立编辑页

状态：**DRAFT**（2026-11-20 维护者接手 OMP 未提交工作树；最终模拟器复验与 Draft PR 交付待确认）

范围：Mira Mobile Settings / Local Provider UI

Base：`dev@1fe0f02`

## 目标

把原来“标签切换 + 单页表单”的 Local Provider 配置页拆成两个层次清晰的页面：

- **模型直连列表页**：展示设备上已保存的模型配置、协议、地址和 API Key 状态。
- **独立编辑页**：新增或编辑单个模型配置，保留凭据、协议、删除能力。会话创建独立于设置页，由聊天入口统一发起。

这是标准 API 协议适配，不绑定 OpenAI 或其他厂商品牌；Provider 配置、凭据存储和 Local Runtime 合同保持不变。

## 功能范围

- 设置入口改为「模型直连」，显示已保存配置数量。
- 列表页展示每个配置的名称、模型、协议、Base URL 和 API Key 状态。
- 列表为空时提供明确的空状态和「添加模型」入口。
- 编辑页按 `providerId` 加载已有配置；无参数时为新建草稿。
- 保留名称、Provider 地址、模型、协议、API Key 字段。
- 保留以下既有安全与生命周期行为：
  - API Key 只进入设备安全存储，不进入配置 JSON。
  - 已有 Key 不回显，留空保存继续使用原 Key。
  - 显式清除 Key，并带确认。
  - 保存中 / 清除中 / 删除中锁定字段和破坏性操作。
  - 删除前读取关联本地对话数量并按最新范围确认。
  - 删除范围变化、回滚不完整分别提示。
  - 统一聊天入口选择「本地连接」后进入模型选择模式，点击已保存服务创建绑定该 Provider 的本地会话。
- 返回列表时按焦点重新读取持久化配置，避免展示过期列表。

## 非目标

- 不改变 Provider 凭据存储实现或 Service namespace。
- 不改变 Local Provider Runtime、会话归属或删除事务语义。
- 不新增模型发现、在线探测、模型列表拉取或厂商预设。
- 连接测试只如实标注「尚未测试，功能待接入」，不发测试请求、不造成功状态。
- 不修改 Remote Host / Cloud 会话链路。
- 不新增第三方依赖。

## 合同

- `LocalProviderConfig` 字段与存储 key 不变。
- `ProviderConfigStore.upsert/load` 仍是配置写读入口。
- `providerCredentialStore` 仍是 API Key 唯一入口。
- `runtimeRegistry.getLocalProviderDeletionImpact/deleteLocalProvider/createLocalSession` 保持权威。
- 导航路由：`LocalProviderList({ mode?: 'create' })`、`LocalProviderEdit({ providerId?: string })`。
- 恢复上一轮维护者已确认的自定义聊天来源弹层，覆盖旧 `Alert.alert('新建会话')`。

## 验收

1. 设置页「模型直连」显示配置数量并进入列表页。
2. 空列表显示空状态；点击「添加模型」进入编辑页。
3. 保存后返回列表，列表按焦点刷新并显示新配置。
4. 点击配置进入编辑页，字段回填，API Key 状态正确。
5. 不输入新 Key 保存后旧 Key 仍保留；输入新 Key 后替换。
6. 清除 Key 只影响当前配置。
7. 删除配置时展示关联本地对话数量，并在范围变化时重新确认。
8. 非标准迁移配置仍提示并阻止新建对话，直到重新保存修正。
9. HTTP Base URL 仅在开发模式显示明文提示。
10. 未保存修改返回前要确认；保存成功和删除成功可以退出，草稿不得混入已保存列表。
11. 保存不等于连接成功；设置页不再根据配置数量显示绿色「已连接」状态。
12. 不允许从编辑页直接新建本地对话，也不允许恢复曾经否决的 Android 原生「新建会话」弹窗。

## 验证

- `npm run typecheck`
- `npm run lint`
- 相关 Jest：`localProviderConfig.contract.test.js`、`unpairedNavigation.contract.test.js`、`sessionSourceEntry.contract.test.js`、`__tests__/startupRestore.test.tsx`
- Android 模拟器 `emulator-5554`：从新工作树 Metro `8082` 加载 JS，实际走通「列表 → 添加 → 保存 → 编辑」路径并截图。

## 风险与未完成

- 未在 iOS 实机验证；本轮只做 Android 模拟器视觉与交互 smoke。
- 真实模型服务的流式对话未在本卡验证，沿用既有 MOB-044 真机矩阵。
