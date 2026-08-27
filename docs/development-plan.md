# dsh-dock-terminal 开发规划

> 状态：进行中（2026-08-27 立档）
> 对齐目标：dsh runtime `0.1.1-rc.2`（与 dsh-plugin-framework 的
> `docs/current-dsh-migration.md` 一致）；宿主 = dsh-web-app，已有
> `@tecfancy/dsh-dock-host@0.2.0`（dockButtons 注册表 + composer 槽）。

## 0. 结论先行

- **后端选型：维持 node-pty 直连**，不迁移官方 `@deepseek-ai/dsh-terminal` 缝。
  官方 bash 后端输出按行规范化、不支持全屏备用缓冲区（vim/top 会挂），
  它是为**模型消费**（有界行输出 + 就绪检测）设计的；UI 终端要的是真实
  xterm 渲染。官方缝留作未来「模型 terminal 工具」的可选底座。
- **功能定位：composer 下方的就地 popover 终端**，与 better-sidebar 的侧边栏
  终端互补（better-sidebar 已装 v0.16.1，其文件/浏览器/Git 价值保留，终端
  以我们的为主）。
- **当前代码已具 v0.1.0 完整形态**（commit `817ded9`）：node-pty +
  `/dock-terminal/ws` 桥、信任围栏、transcript 回放、park/grace 生命周期、
  xterm 渲染、i18n、单测。**尚未安装部署**，profile 的 cordis.patch.yml 已
  预置对应 config。
- **下一步以「验证 + 迭代」为主**：先跑通 `npm run verify` 全门禁 →
  测试 profile 实装 + playwright 端到端 → 正式部署；功能按 v0.2 鲁棒性 /
  v0.3 可配置性 / v1.0 模型协同 三阶段迭代（见 §4）。

## 1. 参考资源调研

### 1.1 官方 `@deepseek-ai/dsh-terminal`（PTY 缝）

定位：所有者（agent）限定的持久 PTY seam，注册为 `ctx.terminals`；具名后端
注册、不透明会话 id、spawn/send/read/signal/close 全生命周期，dispose 与
清理失败显式化（`TerminalBackendCleanupError`），`waitReason` 与
`sessionStatus` 相互独立。

对我们有用的点：

- **所有权模型**：会话绑定完全相同的活跃 Agent，agent/service dispose 时
  等待后端停稳 — 若我们以后做「模型终端」，这套语义直接可用。
- **清理/失败语义的严谨度**：取消保留确切原因、清理失败不谎称成功、可重试。
- 明确的边界：缝不含 node-pty、沙箱、工具 schema、渲染策略 — 机制归它，
  呈现归消费方。

不采用的原因：

- 当前 web profile 未挂载该缝（dsh-base 只有 subprocess/sandbox/沙箱方言，
  无 `terminal`/`terminal-bash` 行），接入需额外引入 + 依赖
  `subprocess.spawnTerminal` 提供方。
- 它是「机制缝」+「模型消费」导向，UI 直接消费它收益低（输出被行规范化）。

### 1.2 官方 `@deepseek-ai/dsh-terminal-bash`（bash/pwsh 后端）

定位：基于 `ctx.subprocess.spawnTerminal` + `ctx.sandboxPolicy` 的持久 shell
后端；bash/pwsh 方言选择、提示符标记就绪检测（OSC 133;D + 前台 stdin 等待

- 静默回退 + 绝对超时）、UTF-8 钉住、清理保证。

对我们有用的点：

- **sandboxPolicy 集成**：受限模式用 `ctx.sandbox` 包装 shell argv；模式变更
  前后拒绝不一致 → 我们目前直接 `nodePty.spawn`，**未包沙箱**。需要核对
  web profile 的沙箱模式：若受限模式部署，这是安全差距（列入 §5 待确认）。
- **spawn-helper 修复**（pnpm 剥离可执行位）— 我们已实现（`ensureSpawnHelper`）。
- 方言/编码细节：pwsh 需 `NO_COLOR` + `[Console]::OutputEncoding` 钉 UTF-8；
  bash 用 `-i` 交互。我们目前默认 `-l` + `$SHELL`，够用但可对齐。
- 就绪检测对 UI 终端无意义（xterm 全量渲染），**不引入**。

### 1.3 `omdsh-dev/DSH-better-sidebar`（最贴近的完整产品参考）

定位：侧边栏服务化框架，终端为内置 tab（xterm.js + node-pty +
`/sidebar/ws/terminal` WebSocket，断线重连回放，可选模型 `terminal_*`
工具）。README + 源码（pty-manager.ts / agent-pty.ts / TerminalView.tsx /
index.ts）已逐项读过。

可借鉴（含其 PR 号）：

| 模式                                                                    | 出处                       | 我们的现状 / 计划                                                           |
| ----------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| node-pty 懒加载，缺失不拖垮 server，横幅给修复命令 + 重试               | #140                       | 已懒加载（`loadNodePty` 返回 null 仍挂载）；**缺**客户端修复横幅（v0.2 F2） |
| shell / shellArgs 经 `cordis.patch.yml` 或设置页配置                    | #125 / #232                | 已有 config schema + profile patch 预置；**缺**设置页 UI（v0.3 F6）         |
| 会话删除立即关闭该会话终端（订阅 session/disposed）                     | #130                       | **缺**（当前等 30s 宽限，v0.2 F3）                                          |
| spawn cwd 与重连时权威 cwd 不一致 → 重开 shell（hydrate 竞态）          | pty-manager.ts             | **缺**：首次连接可能落在 `process.cwd()`，重连换目录不生效（v0.2 F4）       |
| 模型 `terminal_create/send/read/list/signal/close` 工具，与 UI 共享 pty | agent-pty.ts               | **缺**（v1.0 F7，可选）                                                     |
| 断线重连回放（bounded transcript ring，1MB）                            | pty-manager / TerminalView | **已有**（`TRANSCRIPT_LIMIT` 一致）                                         |
| park（会话切换不 TTL）+ 裸断线 grace                                    | #130 同源语义              | **已有**                                                                    |
| xterm 依赖 `@xterm/xterm` 5.x 迁移                                      | #122/#128                  | 已用 `@xterm/xterm@5.5` + `@xterm/addon-fit@0.10`                           |
| Windows 适配（COMSPEC/powershell、预编译二进制）                        | README 平台段              | 已处理（默认 shell/参数、spawn-helper 跳过 win32）                          |

差异（我们保持）：

- 位置：`conversation.composer.dock` 弹层（工作流近旁），非侧边栏 tab 系统。
- 集成：dock-host `dockButtons` 注册表，而不是 betterSidebar API。
- 重量级：不引入侧边栏/持久化/懒加载分块体系，原子做终端。

## 2. 现状盘点

**仓库**（`@tecfancy/dsh-dock-terminal@0.1.0`，独立 git，commit `817ded9`）：

```
src/index.ts        host 根：/dock-terminal/ws upgrade 路由 + 装配
src/config.ts       Config（shell/shellArgs/maxPerSession/reconnectGraceMs）
src/pty.ts          PtyManager（每 `${sessionId}:${tabId}` 一个 node-pty，
                    1MB transcript ring、park/scheduleClose、懒加载+spawn-helper）
src/terminal-server.ts  协议：文本=stdin；JSON 帧 close/park/resize；
                    isTrustedRequest（loopback / 同源 origin 围栏）；
                    会话 cwd（session header → process.cwd()）
src/client/
  index.tsx         dock 按钮（order 10, primary）+ composer.dock 槽位
  features/terminal-popover/  TerminalPopover/TerminalView/popover-store/i18n
  shared/config/context.ts   结构契约（slots/locale/dockButtons）
```

**部署**：web profile 未安装；`~/.dsh/profiles/web/cordis.patch.yml` 已预置
`dsh-dock-terminal` config（shell/shellArgs/maxPerSession/reconnectGraceMs，
键与 Config schema 一致，说明部署侧已就绪）。

**已知瑕疵**（规划期内顺手修）：

- `deploy/cordis.patch.yml` 还是框架模板的 `defaultGreeting: "Hello from
production"` 示例 — 与终端 Config 无关，会被误解（改为真实示例键）。
- `repos/README.md`（根工作区索引）仍写 terminal「待迁移」，已过时。
- `lib/` 产物未构建（无 node_modules / 未跑 verify）— 部署前必须全绿。

## 3. 关键架构决策

| #   | 决策                                                                | 依据                                                                                                    |
| --- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| D1  | UI 终端后端 = node-pty 直连；官方缝不引入                           | 真实全屏终端（alt buffer）；无 subprocess 提供方依赖；与 better-sidebar 同级验证                        |
| D2  | 官方 `dsh-terminal`+`terminal-bash` 仅作为**未来模型工具底座**评估  | 若做 v1.0 模型工具，优先复用官方缝 + `dsh-tool-terminal` 语义（行输出、就绪、取消），避免自研 agent-pty |
| D3  | 客户端渲染 = `@xterm/xterm` 5.x + fit addon，单文件 bundle 内联 CSS | 官方 client 装载契约；已在 tsdown 定制插件中实现                                                        |
| D4  | 安全 = 信任围栏 + 会话隔离 + cwd 权威性；沙箱对齐待核（§5）         | isTrustedRequest 同源/loopback；每会话配额；spawn 以会话 cwd 为基准                                     |
| D5  | 与 better-sidebar 共存，不做终端功能合并                            | better-sidebar 终端在侧边栏 tab；我们在 composer 下方；用户选择权保留                                   |

## 4. 功能路线

### v0.2 鲁棒性与体验（✅ 已完成，commit `a021ce8`，版本 0.2.0）

- **F1 多终端 tab**：popover 内横向 tab 条；每 tab 一个 pty（`maxPerSession`
  同时约束 UI tab 数）；tab 独立关闭；`terminal-store.ts` 持有 tab 集合，
  **所有 tab 常驻渲染**（非活跃 `display:none`）——切 tab 不断 pty 连接，
  关 tab/收起 popover 才卸载并发最终 close 帧。参考 better-sidebar 的 tab 语义。
- **F2 node-pty 不可用修复横幅**：client 收到 1011 时渲染横幅，展示修复
  命令（`pnpm approve-builds --all && pnpm rebuild node-pty`）+ 重试按钮
  （`attempt` 状态驱动重连）；host 侧保留 warn 日志。参考 better-sidebar #140。
- **F3 会话删除即关**：host 订阅 `session/disposed`（payload 防御式解析
  session.id），`PtyManager.closeSession()` 关闭该会话全部 pty（含 parked +
  pending grace），不等 30s 宽限。参考 #130。
- **F4 cwd 权威性**：`open()` 已实现 spawn cwd ≠ 权威 cwd 时重开 shell
  （hydrate 竞态），本轮补测试锁定（`respawns when the authoritative cwd
differs on reconnect`）。
- **F5 状态可见性**：host 首个 **meta 帧** `{"type":"meta","shell","cwd",
"maxPerSession"}`；popover 标题栏显示 `shell · cwd`；退出码回显保留。

**v0.2 实测中发现并修复（均在 `a021ce8`）**：

- **close 帧 send-then-close 竞态**：浏览器同步 `send(close)` 后立即
  `ws.close()` 会丢帧，host 只走 30s grace 回收。现改为：tab 被移除时由
  TerminalView 的 store 订阅在**卸载前**发送 close 帧（此时 socket 全开，
  可靠）；park 帧（会话切换）则 send 后延迟 50ms 关闭 socket。
- **pnpm file: 依赖缓存不感知 tgz 内容变化**：`pnpm install` 对
  `file:...tgz` 按路径缓存，重新打包同版本号不重装 → 必须
  `pnpm install --force`（或换版本号）。web-test 验证时因此差点测到旧包。
- **`dsh plugin add` 整写 profile 状态**：add -w 会重置
  `cordis.patch.yml` 为 `[]` 并重写 package.json（剔掉其它插件、bundles）。
  顺序坑：先 add，再写 user-layer patch 的 config（否则 Config schema
  `Required` 启动失败），再用 `pnpm install --force` 恢复共存依赖。

### v0.3 可配置性（F6 已取消：主人决定不需要设置页）

- **F6 设置页 UI**：~~经 `settings.section` 槽位提供 shell / shellArgs /
  maxPerSession 配置~~ **已取消**（2026-08-28 主人决定不需要；配置维持
  `cordis.patch.yml` 部署态覆盖即可）。
- **F7（并入）方言细节对齐**：bash 交互参数 `-i`（现状 `-l`）、pwsh
  UTF-8 钉住（Windows 冒烟时验证）。

### v1.0 模型协同（✅ 已完成，commit `d60be6c`，版本 0.3.0，路线 B）

- **路线 B（官方缝）落地**：`@deepseek-ai/dsh-terminal` +
  `dsh-terminal-bash` 从 dsh 全局 node_modules 解析（profile **无需装包**，
  patch `insert` 两行即挂载）；后端在受限模式下自动包
  `sandboxPolicy`（安全语义免费获得），自带就绪检测与 UTF-8 处理。
- **F8 工具集**：`terminal_create`（spawn + 可选首命令等待就绪）/
  `terminal_send`（startSend + done 等待，返回 viewport/waitReason）/
  `terminal_read`（scrollback 分页，newest-relative offset）/
  `terminal_list` / `terminal_signal` / `terminal_close`。owner 严格绑定
  `exec.agent`（会话间不可互访）；`ctx.terminals` 未挂载时优雅降级
  （跳过工具集 + warn，UI 终端不受影响）。
- **验证**：11 个工具单测（调用映射/owner 传递/错误包装/降级）+ verify
  全绿（46 tests，覆盖率达标）；web-test 挂缝后重启：配置树三行就位、
  启动 0 错误、console 0 errors。真实模型调用冒烟待主人使用反馈。
- **部署注意**：主 profile 挂缝需在 user-layer patch 用 `insert` 形式
  （id-targeted 只修改已有行，dsh-terminal 不在任何 bundle 层）。

### 安全 / 平台（贯穿）

- **F9 sandboxPolicy 对齐**：核对 web profile 沙箱模式；若受限模式部署，
  shell spawn 需包 `ctx.sandbox` argv 或明确拒绝并提示（官方 terminal-bash
  语义）。若部署为 danger-full-access 且长期如此，记录为已知边界。
- **F10 Windows 冒烟**：COMSPEC / powershell.exe 默认路径、spawn-helper
  跳过逻辑、UTF-8 编码。

## 5. 工程与部署流程

1. **门禁**：`npm install`（node-pty 需预编译；避免 pnpm 11 拦截构建脚本，
   仓库已配 `allowScripts`）→ `npm run verify` 全绿（format/lint/no-emdash/
   aliases/type-check/test:coverage≥70%/build/bundle:check/skills:check）。
2. **测试 profile 实装**：按 `.dsh/skills/dsh-extension-testing/SKILL.md` 流程
   建独立 profile → link 安装 → playwright 端到端：开终端 → 输入 `echo hi`
   → 输出回显 → 关闭 → 会话切换 park → 重连回放 → 刷新宽限。
3. **正式部署**：`dsh plugin --profile web add @tecfancy/dsh-dock-terminal@<ver>`
   （link 或 registry）→ 重启 dsh web → 手工冒烟（与 better-sidebar
   并存确认）。
4. **文档同步**：更新 `repos/README.md` 状态行；本计划随迭代更新；发布后
   更新仓库 README 的安装命令与版本号。

## 6. 风险与待确认

| 风险/待确认                  | 说明                                                 | 应对                                                                   |
| ---------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------- |
| better-sidebar 终端功能重叠  | 两个终端并存可能让用户困惑                           | D5 共存，README/Q&A 讲清差异；若主人决定二选一再收                     |
| node-pty 预编译失败          | 平台/Node 版本无对应产物                             | 懒加载 + F2 修复横幅；备选：编译工具链                                 |
| web profile 沙箱模式         | 未核；若受限模式，直启 shell 是安全差距              | F9 先核后做；纳入 v0.2 验收                                            |
| 设置写入通道不确定           | `settings.section` 写回 config 的宿主机制未调研      | F6 开工前先做 30 分钟调研（读 dsh-web 设置服务 + better-sidebar 实现） |
| profile patch 与 schema 漂移 | id-targeted patch 整行替换 config                    | deploy 模板修复 + 部署时全键对齐（现状已对齐）                         |
| 模型工具所有权设计           | F8 若走自研，需处理与 UI 注册表并发、会话/agent 归属 | 选 B（官方缝）规避；A 时参考 agent-pty.ts 的 owner-scoped 模型         |

## 7. 参考链接

- 官方缝：`packages/terminal/terminal/README.zh.md`、
  `packages/terminal/terminal-bash/README.zh.md`（deepseek-harness）
- better-sidebar：<https://github.com/omdsh-dev/DSH-better-sidebar>
  （pty-manager.ts / agent-pty.ts / TerminalView.tsx / index.ts）
- 框架：dsh-plugin-framework `docs/current-dsh-migration.md`（runtime
  0.1.1-rc.2 对齐记录）

## 8. 验证记录（2026-08-27 实测）

**基线门禁**：`npm run verify` 首跑即红——仓库 pre-existing 的 prettier 红灯
（README.md 从未过 format），格式化修复后全绿（commit `97d9f05` fix +
`8dc2795` docs）。

**发现并修复的缺陷**：

| 缺陷                                                                                         | 影响                                                            | 修复（commit）                                                                                                    |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| tsdown 硬编码裸 bundle id `dsh-dock-terminal`，包名却是 scoped `@tecfancy/dsh-dock-terminal` | 部署即死：`loaded without registering`（与 dock-host 旧坑同源） | tsdown ID 从 package.json 派生；verify-bundle.mjs 断言升级为按包名（与 dock-host 一致）（`97d9f05`）              |
| client 从不发送 `park` 帧（README/头注释声称支持会话切换存活）                               | 切换会话后旧 shell 30s grace 后被杀                             | TerminalView 拆卸时按 store 状态区分 park（切换）/ close（关闭）（`c465636`）                                     |
| close 帧 `scheduleClose(0)` 被随后的 socket-close 事件 cancel 并替换成 30s grace             | 关闭终端可能延迟 30s 才死                                       | host 侧 `manager.close()` 同步强杀；`scheduleClose`/`park` 增加 `isLive` 守卫（对齐 better-sidebar）（`c465636`） |

**web-test 端到端（已通过）**：`dsh plugin --profile web-test add -w <tgz>`
（pnpm 9.15.9，node-pty 源码编译成功；profile patch 预置 config）→ 端口 3081
启动 → playwright 验证：页面与 UI 完整、console 0 errors/0 warnings、
`/plugins/@tecfancy/dsh-dock-terminal/client.js` 200、dock 行出现「▸ 打开终端」
按钮、真实会话中 popover 打开、pty 子进程（`/bin/bash -l`，cwd=会话工作区）
存活、`echo` 命令输入→输出→新提示符全回路正常、× 关闭后 popover 即时消失。
close/park 修复已由 3 个新单测（close 帧赢过 grace / 死键 park 不复活 /
关闭后重连重新 spawn）+ verify 全绿覆盖。

**注意（环境）**：

- 本机同时有其它 agent 会话在跑，且共用
  `PWTEST_DAEMON_SESSION_DIR=/tmp/pw-cli-sessions`（skill 的默认路径）——
  验证中 popover 状态偶发“被翻转”即两方共用同一浏览器所致，非插件问题。
  并行测试应各自使用独立会话目录（本次复测已用 `...-doudou`）。
- 另一会话（「测试dsh实例添加并验证启动」）在此期间**主动调查了本实例**
  （其消息：“测试实例已经有人在跑了（端口 3081，PID 3838890）！检查已装
  版本是否最新”并运行了 Bash 命令）——contested 环境下输入→退出码的个别
  异常现象无法归因，不作为判定依据；实例至今保持运行（PID 3838890，端口
  3081）。

**下一步**：修复已提交（0.1.x 未发布、未装主实例）。按 §4 v0.2 列表推进
F1-F5；`web profile` 沙箱模式核实（F9）先行。

**v0.2 端到端（2026-08-28，通过）**：0.2.0 装上 web-test（`pnpm
install --force` 后确认 bundle hash 一致）→ playwright（独立会话目录
`...-v02`）全链路：console 0 errors、按钮 → popover（标题栏 `bash ·
/data/disk/dsh-workspaces/personal`）→ tab 条 1 tab + 「+」→ 加第 2 tab
（pty 进程 1→2）→ `echo v02-multi-tab` 回显 + 新提示符 → 关 tab：tabs
2→1、popover 保持打开、**pty 进程 2→1 立即回收**（close 帧竞态修复生效）。

**F9 结论（已核）**：web profile 的 `sandbox-policy` 配置为
`mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'`；当前运行实例
（主 web 与 web-test）env 均未设置该变量，即**默认受限模式**（GUI 显示
Full access 属 UI 层切换）。我们的终端直启 shell 故**绕过 sandboxPolicy**——
对用户手动终端这是有意豁免（等同用户在服务器上开 shell），但已在 README/
规划中记录为安全边界；待 v1.0 模型工具（F8）走官方缝时天然对齐沙箱语义。
