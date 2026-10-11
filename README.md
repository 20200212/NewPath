# NewPath 截图工具

本地优先的桌面截图工具，技术栈参考 [cclank/quickshot](https://github.com/cclank/quickshot)：

| 层 | 技术 |
|---|---|
| 语言 | TypeScript 5（strict） |
| 桌面壳 | Electron 39（主进程 + 沙盒化 preload） |
| 界面 | React 18 + Tailwind CSS 3 |
| 构建 | Vite 8 + vite-plugin-electron |
| 测试 | Vitest |
| 打包 | electron-builder（Windows NSIS / macOS DMG / Linux AppImage） |

环境要求：Node.js 20.19+ 或 22.12+。

## 常用命令

```bash
npm install          # 安装依赖（如提示 install-scripts，执行 npm install-scripts approve electron electron-winstaller）
npm run dev          # 启动开发模式（Vite + Electron，热更新）
npm run dev:ui       # 只启动界面（mock 数据），浏览器访问 http://localhost:5174/?windowType=main
npm test             # 单元测试
npm run typecheck    # 类型检查
npm run verify       # 测试 + 类型检查 + 生产构建
npm run build:win    # 打包 Windows 安装包，输出到 release/<版本号>/
npm run build:mac    # 打包 macOS DMG（只能在 Mac 上运行，或用 GitHub Actions），见 Docs/macOS.md
```

启动后打开主界面（截图库），关闭主界面后应用继续驻留在系统托盘。按 **Alt+C**（macOS 上是 **⌘⇧X**，可在设置中修改）、单击托盘图标（macOS 上从菜单栏图标的菜单里选）或点击主界面的「开始截图」开始截图。

macOS 版的权限、签名、打包和验收清单见 [Docs/macOS.md](Docs/macOS.md)。

## 目录结构

```
electron/                 主进程（Node.js 环境）
  main.ts                 托盘、全局快捷键、窗口管理、IPC
  preload.ts              暴露给渲染进程的唯一接口 window.electronAPI
  settings.ts             读写 userData/settings.json（快捷键、保存目录、界面语言）
  locale.ts / i18n.ts     界面语言解析（跟随系统）和主进程文案（托盘、对话框、通知）
  library.ts              截图库：列目录、文件名校验、写入、目录监听
  capture.ts              用 desktopCapturer 截取整块显示器
  cropRect.ts             CSS 像素选区 → 物理像素裁剪区域
  windowList.ts           常驻 PowerShell 进程枚举可见窗口（Windows，用于悬停识别）
  macWindowList.ts        调用 native/newpath-window-list 枚举可见窗口（macOS）
  windowRects.ts          窗口矩形：全局坐标 → 选区窗口内的 CSS 像素
  pins.ts / pinGeometry.ts  钉图窗口的管理和缩放、定位
  ocr.ts / ocrResult.ts   文字识别的公共流程（缩放、切块、解析结果），按平台选引擎
  windowsOcr.ts / macOcr.ts  Windows.Media.Ocr（PowerShell）/ Vision（native/newpath-ocr）
  nativeHelpers.ts        定位并运行 macOS 的 Swift 小工具
  sensitiveText.ts        智能打码：在 OCR 结果里找邮箱、IP、密钥、手机号等
  powershell.ts           运行 PowerShell 脚本（-EncodedCommand）
  screenshotFiles.ts      默认文件名等文件相关工具
  ipcTypes.ts             主进程与渲染进程共享的类型
src/                      渲染进程（浏览器环境，无 Node 权限）
  App.tsx                 按 ?windowType= 分发到不同窗口界面
  components/main/        主界面：截图库、设置弹窗、快捷键录制
  components/screenshot/  选区窗口（RegionSelector）
  components/editor/      编辑窗口：Editor（状态编排）、Stage（画布与交互）、工具栏、样式条、缩放条、OCR / 拼接面板
  components/pin/         钉图窗口（PinnedImage）
  components/ui/          通用组件：实体按键风格的按钮、工具按钮、弹窗、提示条、窗口按钮
  editor/                 编辑器纯逻辑：标注模型、几何与命中测试、撤销历史、视口缩放、裁剪、拼接、智能打码、绘制与导出
  i18n/                   界面多语言：I18nProvider / useI18n，messages/ 按界面分区存放简中、繁中、英文文案
  lib/                    纯函数工具（选区几何、快捷键转换、格式化）和 dev:ui 的 mock 数据
native/                   macOS 用的 Swift 小工具源码（窗口枚举、Vision 文字识别），scripts/build-native.mjs 编译到 build/native/
scripts/                  图标生成、Swift 小工具编译、macOS 签名钩子（mac-sign.mjs）
public/icon.png           托盘与安装包图标（node scripts/generate-icon.mjs 生成的占位图）
public/trayTemplate*.png  macOS 菜单栏用的单色模板图标
```

## 截图流程

1. 快捷键触发 → 主进程截取鼠标所在显示器的完整画面
2. 打开全屏无边框的选区窗口，把冻结画面作为背景
3. 拖动选区（可移动、可拖手柄调整；单击 = 全屏）
4. 复制（Enter / 双击）、保存（Ctrl+S）、编辑，或 Esc 取消
5. 主进程按物理像素裁剪，写剪贴板、直接存进截图库（默认 `图片\NewPath`），或打开编辑窗口

## 主界面

- 列出截图库里的截图（缩略图、修改日期、大小），目录有变化时自动刷新
- 每行可以复制图片、复制路径、重命名、删除（移到回收站）、在文件夹中显示；双击在编辑窗口中打开（带缩放条）
- 用「选择文件夹」或设置弹窗更换截图库位置；在设置里点击快捷键输入框，直接按下新的组合键即可修改截图快捷键
- 设置里可以切换界面语言（跟随系统 / 简体中文 / 繁體中文 / English），切换后所有窗口和托盘菜单立即生效
- 设置里可以打开「开机自启」（仅安装版；登录项由系统保存）。开机自启时应用只驻留托盘，不弹出主界面
- 界面风格：Apple 式的浅色、大圆角、毛玻璃，加上任天堂式的实体按键（底部实色阴影，悬停上浮、按下压平）

## 约定

- 渲染进程开启 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`。新增能力时要在 `preload.ts` 显式暴露，在 `main.ts` 里用 `ipcMain.handle` 实现，并校验调用来源窗口。
- 可以单独测试的逻辑写成纯函数，测试文件 `*.test.ts` 放在旁边。
- 新增窗口类型时：在 `main.ts` 的 `WindowType` 中添加，并在 `App.tsx` 里加上对应分支。

## 路线图（参考 QuickShot 的功能）

- [x] 托盘 + 全局快捷键 + 区域截图 + 复制 / 保存
- [x] 悬停高亮并点击截取窗口（Windows / macOS）
- [ ] 多显示器同时覆盖
- [x] 标注工具：矩形、椭圆、箭头、直线、画笔、荧光笔、文字、序号、马赛克 / 模糊
- [x] 撤销 / 重做，缩放与平移，裁剪
- [x] 钉图（置顶悬浮、缩放、透明度）
- [ ] 钉图鼠标穿透
- [x] OCR 文字识别、智能打码（Windows 用 Windows.Media.Ocr，macOS 用 Vision）
- [x] macOS 适配：屏幕录制权限引导、红绿灯标题栏、菜单栏模板图标、签名与 GitHub Actions 打包
- [x] 拼接（再截一张、粘贴 / 拖入图片）
- [ ] 背景美化：渐变 / 壁纸、内边距、圆角、阴影
- [x] 主界面（截图库）、自定义截图快捷键、自定义保存目录
- [ ] 设置：开机自启、中英文界面
- [ ] 长截图

> QuickShot 使用 GPL-3.0 协议。本项目参考了它的技术选型、目录结构和实现思路（如 macOS 上用 Swift 小工具调用系统框架、用固定证书签名保留屏幕录制权限），代码是独立编写的。如果以后直接复用它的源码，本项目也需要遵守 GPL-3.0。
