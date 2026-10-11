# CLAUDE.md

本文件为 Claude Code 在本仓库中工作时提供指引。技术栈、目录结构、截图流程和路线图见 [README.md](README.md)，这里只补充写代码时需要知道的内容。

## 命令

```bash
npm run dev                                   # Vite + Electron 开发模式
npm run dev:ui                                # 只起渲染层（端口 5174），无 Electron
npm test                                      # 全部单元测试（vitest run）
npx vitest run electron/cropRect.test.ts      # 运行单个测试文件
npx vitest run -t "测试名"                     # 按名称过滤测试
npm run typecheck                             # tsc --noEmit
npm run verify                                # 测试 + 构建（build 里的 tsc 兼做类型检查）
```

改完代码后至少跑 `npm test` 和 `npm run typecheck`。

## 架构要点

- **构建配置分层**：`vite.renderer.config.ts` 是渲染进程的公共配置；`vite.config.ts` 在其上叠加 `vite-plugin-electron`（编译 `electron/main.ts` 和 `preload.ts` 到 `dist-electron/`）；`vite.ui.config.ts` 只用公共配置，供浏览器单独调试。生产构建 `base` 为 `./`，因为打包后走 `file://`。
- **单页多窗口**：所有窗口加载同一个 `index.html`，主进程通过 `?windowType=` 查询参数区分，`src/App.tsx` 按它分发组件。当前类型：`main`（主界面 / 截图库，也是不带参数时的默认）、`screenshot-region`（选区）、`screenshot-preview`（编辑器）。
- **主窗口**：无边框（`frame: false`），标题栏由渲染进程自绘——可拖动的区域加 `.drag`，里面可点击的元素加 `.no-drag`（`Button` 自带）。关闭按钮只是隐藏到托盘。从主界面开始截图（`capture:start`）时，先隐藏主窗口并等 `HIDE_BEFORE_CAPTURE_MS`，截图结束后再恢复。
- **截图库**：保存目录来自 `settings.saveDir`（`electron/settings.ts`，持久化在 `userData/settings.json`）。渲染进程只传**文件名**，主进程用 `resolveInDir` 拼出路径并拒绝路径穿越；文件操作统一经过 `withLibraryFile`，返回 `ActionResult`。`watchDir` 监听目录，变化时向主窗口推送 `library:changed`。缩略图由主进程生成 data URL，因为 CSP 不允许渲染进程加载 `file://`。
- **全局快捷键**：`syncShortcut()` 按设置重新注册；`changeShortcut()` 先试注册，失败就回滚。设置里录制快捷键期间调用 `settings:suspend-shortcut` 暂停全局快捷键。
- **选区窗口常驻复用**：`main.ts` 启动时就创建好选区窗口，之后只隐藏 / 显示，关闭事件被拦截为"取消"。每次截图开始和结束时主进程发送 `capture:changed`，渲染进程再调用 `getCaptureSession()` 主动拉取；会话 `id` 递增，用来丢弃过期的会话。
- **防闪烁显示**：窗口先 `setOpacity(0)` 显示，渲染进程解码并画好截图后调用 `captureReady(id)`，主进程才设为不透明；超过 `REVEAL_TIMEOUT_MS` 会强制显示。改动选区窗口的加载逻辑时要保住这条路径。
- **两份图像**：主进程保留原始 `NativeImage` 用于裁剪；发给渲染进程的只是用于显示的 JPEG。渲染进程回传的是 CSS 像素选区，由 `electron/cropRect.ts` 按 `scaleFactor` 换算成物理像素再裁剪。
- **编辑器导出**：编辑窗口在渲染进程里合成 PNG（`src/editor/exportImage.ts`），以 `Uint8Array` 通过 `image:copy` / `image:save`（存进截图库）/ `image:save-as`（弹出对话框）交给主进程；主进程用 `toPngBuffer` 校验数据。

## 新增 IPC 的步骤

1. 共享类型放进 `electron/ipcTypes.ts`（只放类型，不放运行时代码——渲染进程也会 import 它）。
2. 在 `electron/preload.ts` 的 `api` 对象里显式暴露；`window.electronAPI` 的类型由 `ElectronAPI = typeof api` 自动推导，无需手改 `src/vite-env.d.ts`。
3. 在 `main.ts` 的 `registerIpc()` 里用 `ipcMain.handle` 实现，并用 `isFrom(event, 某窗口)` 校验调用来源；只允许主窗口调用的直接用 `handleMain()`。对渲染进程传来的参数做运行时校验（参数类型标为 `unknown`）。
4. 主窗口要用的方法还要加进 `src/lib/mockLibrary.ts` 的 `MainApi` 和 `mockMainApi`，否则 `dev:ui` 下类型检查不过。

## 代码约定

- `window.electronAPI` 在 `dev:ui` 下不存在，组件必须判空并退回 mock 数据：主界面用 `window.electronAPI ?? mockMainApi`，其他窗口参见 `src/lib/mockImage.ts` 和 `RegionSelector` 的用法。
- 界面风格：浅色 Apple 风 + 实体按键。颜色和按键阴影用 `tailwind.config.cjs` 里的 `apple-*` 和 `shadow-key-*`；按钮、弹窗、提示条优先复用 `src/components/ui/`，不要在组件里重新拼一套按键样式。选区遮罩保持深色。
- 渲染进程用 `@/` 别名指向 `src/`；引用 `electron/ipcTypes.ts` 时用相对路径且只能 `import type`。
- 可单独测试的逻辑写成纯函数（如 `src/lib/selectionGeometry.ts`、`electron/cropRect.ts`），测试文件 `*.test.ts` 放在同目录。Vitest 运行在 `node` 环境，没有 DOM。
- 格式：Tab 缩进、双引号、分号；行尾 LF（见 `.gitattributes`）。注释和界面文案使用中文。
- 新增窗口类型：在 `main.ts` 的 `WindowType` 联合类型中添加，并在 `App.tsx` 里加对应分支。
- 许可证：QuickShot 是 GPL-3.0，本项目只参考其选型，不要从中复制代码。
