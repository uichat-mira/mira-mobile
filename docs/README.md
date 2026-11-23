# Mira Mobile 文档

## 当前工程主线

- [Pi Core Local Agent 当前实现与验收边界](engineering/pi-core-mobile-bridge.md)
- [Mobile / Desktop 工具联调任务 MOB-089](https://github.com/uichat-mira/mira-mobile/issues/349)
- [历史工作台账（非当前任务状态源）](workbench/00-work-ledger.md)

**任务契约、待办与验收结论以当前 GitHub Issue 为准**；实际能力以 `dev` 的代码、配置和运行证据为准。旧台账仅保存当时的工程记录，不再是当前任务状态源，也不存在可用的 `docs/work-ledger.md` 详细镜像。

Mobile 具有 Local Provider 和 Remote Host 两条链路。Host / Harness 保留远程工具执行与审批权威；Local Provider 的工具声明与模型协议适配属于 Mobile 消费端。跨仓协议债应在所属仓库 Issue 跟踪，不能擅自越界改 Host。

## 功能设计

- [拾言（Shiyan）功能唯一真相](shiyan/README.md) — 拾言的产品定义、核心流程、任务状态语义、关键数据边界与跨仓库合同均以此为准。
- [会议采集 MVP 早期技术草案](meeting-capture-mvp.md) — 保留早期讨论与技术探索；与拾言唯一真相冲突时，以 `docs/shiyan/README.md` 为准。

## 工程与发布

- [src/ 目录 ownership map](mobile-src-ownership.md)
- [GitHub Actions 构建与发布](github-build-release.md)
- [依赖安全技术债务](dependency-security-debt.md)
- [iOS 模拟器 Metro 代理排障](ios-metro-proxy-troubleshooting.md)

## 历史工程归档

旧 Remote / Relay / Tailscale 联通工程线已于 **2026-08-27** 归档。相关文档保留为历史协议、实现和验收证据，不再作为当前任务排期或剩余工作真相源。

- [Remote / Relay / Tailscale 工程归档说明](remote-access/README.md)
- [远程连接唯一真相源 V1（历史）](remote-access/remote-connection-canonical-v1.md)
- [Mobile API 接入清单与排期（历史）](remote-access/mobile-api-rollout-plan.md)
- [Tailscale Connectivity V1 合同（历史）](remote-access/tailscale-connectivity-v1.md)
- [Tailscale 联通工程进度（历史）](remote-access/tailscale-connectivity-progress.md)
- [Trae Host V1 交接（历史）](remote-access/trae-host-v1-handoff.md)

归档文档中的“当前”“下一阶段”“排期”均按原始日期理解，不覆盖 GitHub Issue 的当前合同与执行状态。历史联通工程归档不表示当前 Remote Host / Relay 功能被移除。

## 设计体系

统一视觉规范、组件约束、Token 用法和设计评审清单见根目录的 [DESIGN.md](../DESIGN.md)。

### 快速参考

| Token 类别 | 文件 | Tailwind 前缀 |
|-----------|------|--------------|
| 颜色 | `src/theme/tokens.ts` | `text-mira-*`, `bg-mira-*` |
| 字号 | `src/theme/tokens.ts` | `text-mira-*` |
| 间距 | `src/theme/tokens.ts` | `p-mira-*`, `m-mira-*` |
| 圆角 | `src/theme/tokens.ts` | `rounded-mira-*` |
| 图标 | Lucide React Native | — |

### 主色调

**Primary**: `#c96442` (Coral clay)

用于：主按钮、发送按钮、选中状态和少量品牌强调

**Success**: `#22c55e`  
**Warning**: `#f59e0b`  
**Danger**: `#ef4444`

### 文件位置

- **Token 源码**: `src/theme/tokens.ts`
- **Tailwind 配置**: `tailwind.config.js`
- **统一设计说明**: `DESIGN.md`
- **全局样式入口**: `global.css`
