# macOS 版

NewPath 的 macOS 版和 Windows 版共用同一套代码，差别集中在主进程里按 `process.platform` 分支的几处，以及 `native/` 下三个 Swift 小工具（常驻截图进程 `newpath-capture-agent`、窗口列表 `newpath-window-list`、文字识别 `newpath-ocr`）。截图进程、滚动截图、欢迎引导和签名安装脚本移植自 QuickShot，见 `THIRD_PARTY_NOTICES.md`。Mac 安装包只能在 Mac 上构建：用自己的 Mac，或者用仓库里的 GitHub Actions 工作流。

## 与 Windows 版的差别

| 方面 | Windows | macOS |
|---|---|---|
| 截图权限 | 不需要 | 需要“屏幕录制”权限；没授权时不截图，打开欢迎引导去授权，授权后重启生效（见下文） |
| 截屏 | `desktopCapturer` | 常驻截图进程（ScreenCaptureKit）→ `screencapture` → `desktopCapturer` |
| 单击选窗口 | 按窗口区域裁剪 | 单独截取这个窗口（透明圆角、被挡住的部分也完整） |
| 滚动截图 | 不支持 | macOS 14 起支持 |
| 主窗口 / 编辑窗口标题栏 | 无边框，渲染进程自绘最小化 / 最大化 / 关闭 | `titleBarStyle: "hiddenInset"`，用系统的红绿灯，渲染进程按 `isMac` 不画自己的按钮、左侧留出空位 |
| 托盘 | 彩色图标，单击截图、右键菜单 | 菜单栏单色模板图（`public/trayTemplate.png` + `@2x`），单击弹出菜单；图标被系统隐藏时重建一次，仍看不见就在再次打开应用时说明怎么打开 |
| 快捷键自我修复 | 每分钟检查一次 | 另外在切换输入法、睡眠唤醒、解锁后重新注册 |
| 默认截图快捷键 | `Alt+C` | `⌘⇧X`（`Command+Shift+X`） |
| 快捷键提示 | `Ctrl+S` | `⌘S`（`formatAppShortcut`），处理按键时 Ctrl 和 ⌘ 都认 |
| 悬停识别窗口 | 常驻 PowerShell 进程（`windowList.ts`），物理像素 | 截图进程的 `windows` 命令，退回 `newpath-window-list`（CoreGraphics）；坐标本来就是点 / DIP，带窗口编号 |
| OCR / 智能打码 | `Windows.Media.Ocr`（PowerShell） | `newpath-ocr`（Vision 框架） |
| 应用菜单 | Electron 默认 | 精简为 应用 / 文件 / 编辑 / 窗口，去掉会抢编辑器快捷键的页面缩放和重新加载 |
| 开机自启 | 登录项带 `--hidden` | 登录项不支持参数；macOS 13 起 `wasOpenedAtLogin` 恒为 false，用“开了自启且系统刚启动不久”判断 |

两种 OCR 输出同样的 JSON（`{ pages: [{ lines: [{ words: [{ text, x, y, w, h }] }] }] }`），缩放、切块、临时文件和结果解析都在 `electron/ocr.ts` 里共用，平台只提供一个 `OcrEngine`。

## 截图和权限

### 截图从哪来

主进程按顺序尝试（`electron/capture.ts` 的 `ScreenCapturer`），失败就换下一个，用了哪一种记在诊断日志里：

1. **常驻截图进程** `native/newpath-capture-agent`（ScreenCaptureKit，macOS 14 起）：应用启动后一直运行，按行收发 JSON（协议写在它的 `main.swift` 开头）。截屏时只把预览 JPEG 交给选区窗口，原图留在它自己的内存里，选好区域再用 `crop` 取无损的那一块；首帧比 `desktopCapturer` 快得多。窗口列表、单窗口截图、滚动截图、拖拽授权小窗的定位也都走它。
2. `/usr/sbin/screencapture -R`：macOS 12–13，或截图进程不可用时。
3. Electron 的 `desktopCapturer`：最后的退路，也是 Windows / Linux 上唯一的方式。

单击选中窗口、没有再调整选区时，选区窗口把窗口编号（CGWindowID）一起交回来，主进程改为单独截取这个窗口：被挡住的部分也完整、带透明圆角、没有阴影；窗口已经关掉时退回按选区裁剪。

设置里的“选区方式”可以换成**系统框选**（`screencapture -i`，和 ⌘⇧4 一样），选完直接打开编辑器；这种方式没有悬停识别窗口和滚动截图。

### 滚动截图（macOS 14 起）

选区工具栏里点“滚动截图”，或按 S 切到滚动截图模式；托盘菜单的“滚动截图”和 `--capture-scroll` 会一开始就处在这个模式。开始后 NewPath 让出前台，截图进程持续截取选区并拼接（`ScrollStitcher.swift`），选区四周有一圈彩色边框，旁边的面板显示长度和预览；↩ 完成、Esc 取消，长图打开编辑器（拼接模式下追加到编辑窗口）。最长 30000 像素，10 分钟后自动完成。拼接算法的检查：`node scripts/test-scroll-stitcher.mjs`。

### 屏幕录制权限

没有权限时 macOS 不报错，只给一张只有桌面壁纸的画面；而且任何截图接口第一次调用时，系统会弹出自己的授权框压在最上面。所以 NewPath **只要权限不是 `granted` 就不调用任何截图接口**，改为打开欢迎引导的“屏幕录制”这一步（15 秒内连按快捷键只打开一次）：

1. “去授权”先让截图进程调用 `CGRequestScreenCaptureAccess()`，系统把 NewPath 登记进“屏幕录制”列表（第一次还会弹出系统的授权框），再打开系统设置的对应页面；
2. 系统设置窗口下方会出现一个小窗，里面的 NewPath 图标可以直接拖进列表（列表里没有 NewPath 时也能用）；
3. 打开开关后，系统设置会提示“退出并重新打开”。NewPath 用 `userData/permission-pending` 标记记住刚才在授权，重启后引导停在“完成”这一步；也可以点引导里的“重新启动 NewPath”。

托盘菜单的“欢迎与权限…”、设置里的“屏幕录制权限”都能再打开引导。

> 注意：`systemPreferences.getMediaAccessStatus("screen")` 在新版 macOS 上只分“有 / 没有”，从没申请过时也会返回 `denied`，不能拿 `not-determined` 判断“第一次”。

## 在 Mac 上开发

需要 Xcode 命令行工具（`xcode-select --install`），用来编译 Swift 小工具。

```bash
npm install
npm run dev            # 先编译当前架构的 Swift 小工具（源码没变时跳过），再启动 Vite + Electron
npm run build:native   # 单独编译 arm64 + x86_64 的通用二进制，输出到 build/native/
npm run build:mac      # 编译小工具 → 构建 → 打包 DMG（Apple 芯片、Intel 各一个），输出到 release/<版本号>/
```

### 开发时的屏幕录制权限

`npm run dev` 从终端启动，Electron 是终端的子进程。macOS 按“负责进程”记权限，所以**权限记在终端上**（Terminal、iTerm、VS Code、Cursor……），不是 `node_modules` 里的 Electron.app：

- 在“系统设置 → 隐私与安全性 → 屏幕录制”里打开的是你用的终端；打开后要**完全退出终端再重新打开**（系统设置的“退出并重新打开”会把终端关掉），只重启 `npm run dev` 不够；
- 欢迎引导在开发模式下会写出权限记在哪个应用上；因为拖 Electron.app 进列表没用，开发模式下不显示拖拽小窗；
- `node_modules/electron/dist/Electron.app` 是 ad-hoc 签名，身份绑定这份二进制（`codesign -d -r- node_modules/electron/dist/Electron.app` 能看到 `cdhash H"…"`）。不是从终端启动（例如 `open` 启动）时权限记在它身上，重装或升级 Electron 后就要重新授权。

不想碰权限时，用一张图片代替屏幕：

```bash
NEWPATH_DEV_CAPTURE_FILE=~/Desktop/screen.png npm run dev
```

这时截图直接读这张图（缩放到当前显示器的尺寸），不检查权限、不启动截图进程、不识别窗口。

### 开发用的环境变量

只在开发模式（未打包）下生效，打包后全部忽略（`electron/devOptions.ts`）：

| 变量 | 作用 |
|---|---|
| `NEWPATH_USER_DATA_DIR` | 用户数据目录（设置、日志、单实例锁）。默认是 `~/Library/Application Support/NewPath Dev`，不和安装版共用，安装版在运行时也能启动开发版 |
| `NEWPATH_DEV_CAPTURE_FILE` | 一张 PNG / JPEG，截图时代替真实屏幕，不需要权限 |
| `NEWPATH_DEV_SCROLL_FIXTURE` | 一张很高的 PNG，滚动截图时代替屏幕“滚动”，不受系统版本限制 |
| `NEWPATH_DEV_SHORTCUT=0` | 不注册全局截图快捷键（也不抢滚动截图的 Esc / ↩），免得和正在运行的安装版抢 |
| `NEWPATH_DEV_REMOTE_DEBUGGING_PORT` | 打开 Chromium 远程调试端口，例如 `9222` |
| `NEWPATH_DEV_SETTINGS_BUNDLE` | 测试拖拽授权小窗时，用另一个应用的 Bundle ID 代替“系统设置”，例如 `com.apple.TextEdit` |

### 诊断日志

`userData/logs/newpath.log`（开发模式下同时打印到终端），每行一个 JSON：启动信息、权限状态、截图用了哪种方式和耗时、快捷键注册、截图进程的超时和重启、滚动截图的统计等，只记事件和数字，不记截图内容和窗口标题。超过 512 KB 改名为 `newpath.log.1` 重新写。设置 → 诊断 → “诊断日志”打开所在文件夹。

### 命令行入口

已经在运行时，参数会交给正在运行的那个实例：

```bash
open -n /Applications/NewPath.app --args --capture          # 开始截图（也认 --capture-region）
open -n /Applications/NewPath.app --args --capture-scroll   # 直接进入滚动截图
open -n /Applications/NewPath.app --args --onboarding       # 打开欢迎引导
open -n /Applications/NewPath.app --args --show             # 打开主界面
```

在 Windows 上 `build-native.mjs` 会直接跳过；小工具不存在时窗口识别返回空列表、OCR 按钮提示不支持，不影响其他功能。

## 签名

macOS 把屏幕录制权限记在应用的**签名身份**上，签名方式决定了用户更新后要不要重新授权：

| 方式 | 需要什么 | 首次打开 | 更新后屏幕录制权限 |
|---|---|---|---|
| ad-hoc（默认） | 什么都不用 | 提示“无法验证开发者”，要在“系统设置 → 隐私与安全性”里点“仍要打开” | 每次构建身份都变，**每次更新都要重新授权** |
| 自签名证书 | 钥匙串里自己建一张代码签名证书 | 同上 | 保留 |
| Developer ID + 公证 | Apple Developer Program（99 美元 / 年） | 直接打开 | 保留 |

`scripts/mac-sign.mjs` 是 electron-builder 的 `mac.sign` 钩子，按“Developer ID → `NEWPATH_MAC_IDENTITY` → `CSC_LINK` 导入的证书 → ad-hoc”的顺序选签名身份。electron-builder 自己会跳过不受信任的证书、找不到证书时不签名，而 Apple 芯片上未签名的包打不开，所以需要这个钩子兜底。

### 自签名证书（自己或团队内部用）

1. 打开“钥匙串访问 → 证书助理 → 创建证书”，名称填 `NewPath Signing`，身份类型“自签名根证书”，证书类型“代码签名”。
2. 本机打包：`NEWPATH_MAC_IDENTITY="NewPath Signing" npm run build:mac`。
3. 以后**一直用这张证书**。换证书等于换身份，所有用户都要重新授权一次。证书和私钥要备份好，不要提交进仓库。

### 本机稳定签名安装（开发者自己的 Mac）

ad-hoc 签名的身份（designated requirement）绑定这次构建的哈希，每次打包都会变，系统会把新包当成另一个应用，要求重新授权屏幕录制。本机安装用上面的 `NewPath Signing` 证书重新签名，身份固定为：

    identifier "com.newpath.screenshot" and certificate leaf = H"<证书 SHA-1>"

跨构建不变，更新后授权仍然有效。证书不叫这个名字时，把 `NEWPATH_MAC_IDENTITY` 设为它的名称或 SHA-1（同名证书有多张时必须用 SHA-1）。

日常更新：`npm test` 之后运行 `npm run install:mac:local`，它依次执行：

1. `pack:mac:dir`：编译 Swift 小工具 → 构建 → 按本机架构打出 `release/<版本>/mac-arm64/NewPath.app`（Intel 上是 `mac/NewPath.app`），不生成 DMG；
2. `sign:mac:local`（`scripts/sign-mac-local.mjs`）：先签 `Resources/native/` 下的小工具，再签主包，保持 hardened runtime 和原有 entitlements；
3. `scripts/install-mac-local.mjs`：校验 Bundle ID、签名、版本，比对包内文件和本次构建是否一致，确认新包满足已安装的 `/Applications/NewPath.app` 的签名身份。全部通过后才停止旧进程，旧包移到 `~/Library/Application Support/NewPath/app-backups.noindex/`，换上新包，撤销其他同 Bundle ID 副本在 LaunchServices 里的注册，启动新应用，并把安装回执写到 `release/last-local-install.json`。任何一步失败都会放回旧包。

| 参数（`node scripts/install-mac-local.mjs [NewPath.app] [参数]`） | 含义 |
|---|---|
| `--check` | 只检查，不停止进程、不安装、不重启；也可以用 `npm run install:mac:check` |
| `--migrate-signing` | 一次性迁移：已安装的是 ad-hoc 包、新包是证书签名。要重新授权一次，以后的更新保留授权 |
| `--accept-reauthorization` | 明确接受重新授权时才用，允许签名身份改变（例如装回 ad-hoc 包）。不能和 `--migrate-signing` 同时用 |

签名身份不兼容时，脚本在停止进程、改动安装目录之前就退出，已安装的应用和权限保持原样。脚本不会重置屏幕录制授权、不改 TCC 数据库、不放宽签名校验，也不会自动信任证书；签名校验通过也不能代替真机截图验收。

### Developer ID + 公证（公开分发）

1. 加入 Apple Developer Program，在 Xcode 或开发者网站创建 “Developer ID Application” 证书，装进钥匙串。electron-builder 会自动找到它。
2. 在 [appleid.apple.com](https://appleid.apple.com) 生成 App 专用密码。
3. 设置环境变量后打包，electron-builder 签名后会自动提交公证：

   ```bash
   export APPLE_ID="你的 Apple ID"
   export APPLE_APP_SPECIFIC_PASSWORD="App 专用密码"
   export APPLE_TEAM_ID="团队 ID"
   npm run build:mac
   ```

公证要求 Developer ID 签名；用 ad-hoc 或自签名证书时不要设置 `APPLE_ID`，否则公证会失败。

## 用 GitHub Actions 打包

`.github/workflows/build-mac.yml` 在 GitHub 的 macOS 机器上打包。在仓库的 Actions 页面手动运行 “Build macOS”，或推送 `v*` 标签，完成后在运行页面的 Artifacts 里下载 DMG。

签名和公证都是可选的，在仓库 Settings → Secrets and variables → Actions 里配置：

| Secret | 内容 |
|---|---|
| `MAC_CERT_P12_BASE64` | 证书和私钥导出的 .p12，再 `base64 -i cert.p12` 得到的文本（自签名或 Developer ID 都行） |
| `MAC_CERT_PASSWORD` | 导出 .p12 时设的密码 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 公证用，只在 Developer ID 证书时配置 |

一个都不配时打出来的是 ad-hoc 签名的包。工作流最后会打印签名身份，并用 `scripts/check-mac-signature.mjs` 检查：配了证书时两个架构都必须是证书签名（退回 ad-hoc 就失败）且身份一致；在仓库 Variables 里设置了 `NEWPATH_RELEASE_REQUIREMENT`（发布版应满足的签名身份）时还必须满足它。没配证书时跳过检查。

## 在 Mac 上验收

改动 macOS 相关代码后，至少在真机上过一遍：

- [ ] 第一次截图：系统弹出屏幕录制授权；授权并重启后能截到其他应用的窗口内容
- [ ] 在系统设置里关掉权限后截图：弹出 NewPath 的提示框，“打开系统设置”能跳到对应页面，“重新启动”能重启应用
- [ ] 选区窗口盖住菜单栏，四角没有圆角缝隙；在全屏应用里也能截图
- [ ] 悬停能高亮其他应用的窗口，单击截取窗口
- [ ] 主窗口、编辑窗口的红绿灯位置和标题栏对齐，标题栏空白处能拖动
- [ ] 菜单栏图标在浅色 / 深色菜单栏下都清楚，单击弹出菜单
- [ ] 编辑器里 ⌘Z / ⌘⇧Z / ⌘S / ⌘C / ⌘0 / ⌘= / ⌘- 正常，提示里显示 ⌘ 符号
- [ ] 提取文字、智能打码能识别中英文
- [ ] 钉图在切换桌面（Space）后仍然显示
- [ ] 开机自启：登录后只出现菜单栏图标，不弹主界面
- [ ] Retina 屏和外接非 Retina 屏上，保存的截图分辨率正确

## 已知限制

- 只截取鼠标所在的一块显示器（与 Windows 相同）。
- 截图仍用 Electron 的 `desktopCapturer`。macOS 14 起可以改用 ScreenCaptureKit 写一个常驻的截图工具，首帧会更快，以后需要时再做。
- Vision 识别只按纵向切块；特别宽的图（如 5K 屏整屏）上很小的字可能识别不全。
