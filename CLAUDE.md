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
npm run build:native                          # 编译 macOS 的 Swift 小工具（非 Mac 上直接跳过），build:mac 会自动调用
```

改完代码后至少跑 `npm test` 和 `npm run typecheck`。

## 架构要点

- **构建配置分层**：`vite.renderer.config.ts` 是渲染进程的公共配置；`vite.config.ts` 在其上叠加 `vite-plugin-electron`（编译 `electron/main.ts` 和 `preload.ts` 到 `dist-electron/`）；`vite.ui.config.ts` 只用公共配置，供浏览器单独调试。生产构建 `base` 为 `./`，因为打包后走 `file://`。
- **单页多窗口**：所有窗口加载同一个 `index.html`，主进程通过 `?windowType=` 查询参数区分，`src/App.tsx` 按它分发组件。当前类型：`main`（主界面 / 截图库，也是不带参数时的默认）、`screenshot-region`（选区）、`screenshot-preview`（编辑器）、`screenshot-pin`（钉图，可同时有多个，由 `electron/pins.ts` 的 `PinManager` 管理，来源校验用 `pins.fromEvent(event)`）。
- **主窗口**：标题栏由渲染进程自绘——可拖动的区域加 `.drag`，里面可点击的元素加 `.no-drag`（`Button` 自带）。Windows / Linux 上无边框（`frame: false`），按钮是 `WindowControls`；macOS 上用 `titleBarStyle: "hiddenInset"` 保留系统红绿灯，渲染进程按 `isMac`（`src/lib/platform.ts`）不画 `WindowControls`、左侧留出空位，位置常量 `MAIN_TRAFFIC_LIGHTS` / `PREVIEW_TRAFFIC_LIGHTS` 要和标题栏布局一起改。关闭按钮只是隐藏到托盘。从主界面开始截图（`capture:start`）时，先隐藏主窗口并等 `HIDE_BEFORE_CAPTURE_MS`，截图结束后再恢复。
- **截图库**：保存目录来自 `settings.saveDir`（`electron/settings.ts`，持久化在 `userData/settings.json`）。渲染进程只传**文件名**，主进程用 `resolveInDir` 拼出路径并拒绝路径穿越；文件操作统一经过 `withLibraryFile`，返回 `ActionResult`。`watchDir` 监听目录，变化时向主窗口推送 `library:changed`。缩略图由主进程生成 data URL，因为 CSP 不允许渲染进程加载 `file://`。
- **全局快捷键**：`syncShortcut()` 按设置重新注册；`changeShortcut()` 先试注册，失败就回滚。设置里录制快捷键期间调用 `settings:suspend-shortcut` 暂停全局快捷键。
- **选区窗口常驻复用**：`main.ts` 启动时就创建好选区窗口，之后只隐藏 / 显示，关闭事件被拦截为"取消"。每次截图开始和结束时主进程发送 `capture:changed`，渲染进程再调用 `getCaptureSession()` 主动拉取；会话 `id` 递增，用来丢弃过期的会话。
- **防闪烁显示**：窗口先 `setOpacity(0)` 显示，渲染进程解码并画好截图后调用 `captureReady(id)`，主进程才设为不透明；超过 `REVEAL_TIMEOUT_MS` 会强制显示。改动选区窗口的加载逻辑时要保住这条路径。
- **两份图像**：主进程保留原始 `NativeImage` 用于裁剪；发给渲染进程的只是用于显示的 JPEG。渲染进程回传的是 CSS 像素选区，由 `electron/cropRect.ts` 按 `scaleFactor` 换算成物理像素再裁剪。
- **悬停识别窗口**：Windows 上 `WindowListHelper`（`electron/windowList.ts`）在启动时拉起一个常驻 PowerShell 进程，按行请求、按行返回 JSON，坐标是物理像素；macOS 上 `listMacWindows`（`electron/macWindowList.ts`）每次运行一次 `native/newpath-window-list`，坐标已经是 DIP。`main.ts` 的 `listWindows()` / `windowRectToDip()` 按平台分发（`screen.screenToDipRect` 在 macOS 上不存在）。`startCapture()` 里枚举窗口与截屏并行；列表比画面晚到，写进 `session.windows` 后发 `capture:windows`，渲染进程再用 `getCaptureWindows()` 拉取并按 sessionId 校验。Linux 返回空列表，单击退回全屏。
- **拼接模式**：编辑器调用 `preview:start-stitch` 后，主进程隐藏编辑窗口，以 `mode: "stitch"` 开始截图；这时选区只接受 `stitch` 动作，结束后（包括取消）恢复编辑窗口，图片经 `preview:stitch-added` → `takeStitchImage()` 交给编辑器。
- **编辑器结构**：`Editor.tsx` 管文档（`EditorDoc`，快照式撤销，见 `src/editor/history.ts`）、工具样式和键盘；`Stage.tsx` 用一块视口大小的 canvas 绘制并处理指针交互，接口见 `stageTypes.ts`；缩放平移在 `useStageView.ts`。标注坐标一律是"源图"（拼接、裁剪后）像素，屏幕显示和导出共用 `drawAnnotations`。
- **OCR / 智能打码**：Windows 和 macOS 上可用（渲染进程按 `api.platform` 隐藏按钮）。`electron/ocr.ts` 负责缩放、切块、写临时 PNG 和解析结果，平台只提供 `OcrEngine`：Windows 用 PowerShell 调 `Windows.Media.Ocr`（`windowsOcr.ts`），macOS 用 `native/newpath-ocr` 调 Vision（`macOcr.ts`），两者输出同样的 JSON。敏感内容检测是 `electron/sensitiveText.ts` 里的纯函数。
- **macOS**：截图前后用 `systemPreferences.getMediaAccessStatus("screen")` 检查屏幕录制权限，没授权时 `explainScreenPermission()` 引导去系统设置（第一次由系统自己弹授权请求）；托盘应用的窗口要先 `activateApp()` 才能拿到焦点；`native/` 下的 Swift 小工具由 `scripts/build-native.mjs` 编译到 `build/native/`，打包时经 `extraResources` 放进 `Resources/native/`，用 `nativeHelperPath()` 定位，找不到时功能降级而不是报错。签名、打包、验收清单见 `Docs/macOS.md`。
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
- 格式：Tab 缩进、双引号、分号；行尾 LF（见 `.gitattributes`）。注释使用中文。
- 应用内快捷键（编辑器、钉图）按 Windows 习惯写成 `"Ctrl+S"`，处理按键时 `ctrlKey || metaKey` 都认；提示文本经 `appShortcut()`（`src/lib/platform.ts`）在 macOS 上显示成 `⌘S`，不要在文案里写死 `Ctrl`。全局截图快捷键是 Electron 加速键，显示用 `formatAccelerator(accelerator, isMac)`。
- 多语言：界面文案不要写死在组件里。渲染进程用 `useI18n()` 取 `t`，文案放在 `src/i18n/messages/` 对应分区（`common` / `main` / `editor` / `capture`），每个分区文件里简中、繁中（台湾用语）、英文三份放在一起，类型以简中为准，缺 key 时类型检查不过；需要插值的写成函数。主进程文案（托盘、对话框、通知、返回给界面的错误原因）放在 `electron/i18n.ts`，用 `mt()` 现取。纯函数不依赖语言：返回错误码或由调用方传入文案。只给开发者看的日志可以保持中文。
- 语言切换：设置里存 `language`（`system` 或具体语言），主进程用 `resolveLocale` 算出实际语言；新窗口通过 `?lang=` 拿到初始语言，切换时主进程向所有窗口推送 `locale:changed`，渲染进程再调用 `getLocale()` 拉取。
- 开机自启以系统登录项为准（`app.getLoginItemSettings`），不写进 `settings.json`；Windows 上登录项带 `--hidden` 参数，启动时据此只驻留托盘；macOS 的登录项不支持参数，`launchedAtLogin()` 用 `wasOpenedAtLogin` 加“开了自启且系统刚启动”判断。开发模式和 Linux 下不支持。
- 新增窗口类型：在 `main.ts` 的 `WindowType` 联合类型中添加，并在 `App.tsx` 里加对应分支。
- 许可证：QuickShot 是 GPL-3.0，本项目只参考其选型，不要从中复制代码。
