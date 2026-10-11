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
```

启动后打开主界面（截图库），关闭主界面后应用继续驻留在系统托盘。按 **Alt+C**（可在设置中修改）、单击托盘图标或点击主界面的「开始截图」开始截图。

## 目录结构

```
electron/                 主进程（Node.js 环境）
  main.ts                 托盘、全局快捷键、窗口管理、IPC
  preload.ts              暴露给渲染进程的唯一接口 window.electronAPI
  settings.ts             读写 userData/settings.json（快捷键、保存目录）
  library.ts              截图库：列目录、文件名校验、写入、目录监听
  capture.ts              用 desktopCapturer 截取整块显示器
  cropRect.ts             CSS 像素选区 → 物理像素裁剪区域
  screenshotFiles.ts      默认文件名等文件相关工具
  ipcTypes.ts             主进程与渲染进程共享的类型
src/                      渲染进程（浏览器环境，无 Node 权限）
  App.tsx                 按 ?windowType= 分发到不同窗口界面
  components/main/        主界面：截图库、设置弹窗、快捷键录制
  components/screenshot/  选区窗口（RegionSelector）
  components/editor/      编辑窗口（Editor）
  components/ui/          通用组件：实体按键风格的按钮、弹窗、提示条、窗口按钮
  editor/                 编辑器逻辑（导出 PNG，后续放标注、渲染）
  lib/                    纯函数工具（选区几何、快捷键转换、格式化）和 dev:ui 的 mock 数据
public/icon.png           托盘与安装包图标（node scripts/generate-icon.mjs 生成的占位图）
```

## 截图流程

1. 快捷键触发 → 主进程截取鼠标所在显示器的完整画面
2. 打开全屏无边框的选区窗口，把冻结画面作为背景
3. 拖动选区（可移动、可拖手柄调整；单击 = 全屏）
4. 复制（Enter / 双击）、保存（Ctrl+S）、编辑，或 Esc 取消
5. 主进程按物理像素裁剪，写剪贴板、直接存进截图库（默认 `图片\NewPath`），或打开编辑窗口

## 主界面

- 列出截图库里的截图（缩略图、修改日期、大小），目录有变化时自动刷新
- 每行可以复制图片、复制路径、重命名、删除（移到回收站）、在文件夹中显示；双击打开编辑窗口
- 用「选择文件夹」或设置弹窗更换截图库位置；在设置里点击快捷键输入框，直接按下新的组合键即可修改截图快捷键
- 界面风格：Apple 式的浅色、大圆角、毛玻璃，加上任天堂式的实体按键（底部实色阴影，悬停上浮、按下压平）

## 约定

- 渲染进程开启 `contextIsolation` 和 `sandbox`，关闭 `nodeIntegration`。新增能力时要在 `preload.ts` 显式暴露，在 `main.ts` 里用 `ipcMain.handle` 实现，并校验调用来源窗口。
- 可以单独测试的逻辑写成纯函数，测试文件 `*.test.ts` 放在旁边。
- 新增窗口类型时：在 `main.ts` 的 `WindowType` 中添加，并在 `App.tsx` 里加上对应分支。

## 路线图（参考 QuickShot 的功能）

- [x] 托盘 + 全局快捷键 + 区域截图 + 复制 / 保存
- [ ] 悬停高亮并点击截取窗口（Windows 需要枚举窗口）
- [ ] 多显示器同时覆盖
- [ ] 标注工具：矩形、椭圆、箭头、直线、画笔、荧光笔、文字、序号、马赛克 / 模糊
- [ ] 撤销 / 重做，缩放与平移，裁剪
- [ ] 钉图（置顶悬浮、透明度、鼠标穿透）
- [ ] OCR 文字识别（Windows 用 Windows.Media.Ocr）
- [ ] 背景美化：渐变 / 壁纸、内边距、圆角、阴影
- [x] 主界面（截图库）、自定义截图快捷键、自定义保存目录
- [ ] 设置：开机自启、中英文界面
- [ ] 长截图

> QuickShot 使用 GPL-3.0 协议。本项目只参考了它的技术选型和目录结构，没有复制代码。如果以后直接复用它的源码，本项目也需要遵守 GPL-3.0。
