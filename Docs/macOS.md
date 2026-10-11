# macOS 版

NewPath 的 macOS 版和 Windows 版共用同一套代码，差别集中在主进程里按 `process.platform` 分支的几处，以及 `native/` 下两个 Swift 小工具。Mac 安装包只能在 Mac 上构建：用自己的 Mac，或者用仓库里的 GitHub Actions 工作流。

## 与 Windows 版的差别

| 方面 | Windows | macOS |
|---|---|---|
| 截图权限 | 不需要 | 需要“屏幕录制”权限；没授权时截图只能拿到桌面壁纸，主进程会弹框引导去系统设置，授权后重启生效 |
| 主窗口 / 编辑窗口标题栏 | 无边框，渲染进程自绘最小化 / 最大化 / 关闭 | `titleBarStyle: "hiddenInset"`，用系统的红绿灯，渲染进程按 `isMac` 不画自己的按钮、左侧留出空位 |
| 托盘 | 彩色图标，单击截图、右键菜单 | 菜单栏单色模板图（`public/trayTemplate.png` + `@2x`），单击弹出菜单 |
| 默认截图快捷键 | `Alt+C` | `⌘⇧X`（`Command+Shift+X`） |
| 快捷键提示 | `Ctrl+S` | `⌘S`（`formatAppShortcut`），处理按键时 Ctrl 和 ⌘ 都认 |
| 悬停识别窗口 | 常驻 PowerShell 进程（`windowList.ts`），物理像素 | `newpath-window-list`（CoreGraphics），坐标本来就是点 / DIP |
| OCR / 智能打码 | `Windows.Media.Ocr`（PowerShell） | `newpath-ocr`（Vision 框架） |
| 应用菜单 | Electron 默认 | 精简为 应用 / 文件 / 编辑 / 窗口，去掉会抢编辑器快捷键的页面缩放和重新加载 |
| 开机自启 | 登录项带 `--hidden` | 登录项不支持参数；macOS 13 起 `wasOpenedAtLogin` 恒为 false，用“开了自启且系统刚启动不久”判断 |

两种 OCR 输出同样的 JSON（`{ pages: [{ lines: [{ words: [{ text, x, y, w, h }] }] }] }`），缩放、切块、临时文件和结果解析都在 `electron/ocr.ts` 里共用，平台只提供一个 `OcrEngine`。

## 在 Mac 上开发

需要 Xcode 命令行工具（`xcode-select --install`），用来编译 Swift 小工具。

```bash
npm install
npm run dev            # 先编译当前架构的 Swift 小工具（源码没变时跳过），再启动 Vite + Electron
npm run build:native   # 单独编译 arm64 + x86_64 的通用二进制，输出到 build/native/
npm run build:mac      # 编译小工具 → 构建 → 打包 DMG（Apple 芯片、Intel 各一个），输出到 release/<版本号>/
```

开发模式下运行的是 `node_modules` 里的 Electron.app，屏幕录制权限要单独授给它（系统设置里显示为 “Electron”）。授权后重启 `npm run dev`。

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

一个都不配时打出来的是 ad-hoc 签名的包。工作流最后会打印签名身份，方便核对每次构建是否用的是同一张证书。

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
