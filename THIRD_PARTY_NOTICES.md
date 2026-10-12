# 第三方代码说明

NewPath 以 GNU General Public License v3.0 或更新版本（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。

## QuickShot

NewPath 的 macOS 部分移植或改写自 QuickShot：

- 项目：QuickShot
- 作者：岚叔（Copyright © 2026 岚叔）
- 仓库：<https://github.com/cclank/quickshot>
- 许可证：GPL-3.0-or-later

移植或改写的内容（注释已改为中文、命名改为 NewPath，逻辑按 NewPath 的结构做了调整）：

| NewPath | 来源（QuickShot） |
|---|---|
| `native/newpath-capture-agent/`（常驻截图进程、滚动截图、拼接）：沿用它的命令和字段设计，Swift 代码按这套协议重新编写，错误码改为连字符形式 | `native/quickshot-capture-agent/` |
| `native/newpath-window-list/WindowList.swift` 的部分过滤规则 | `native/quickshot-window-list/WindowList.swift` |
| `electron/captureAgent.ts` | `electron/captureAgent.ts` |
| `electron/scrollCapture.ts`、`electron/scrollSession.ts` | `electron/scrollCapture.ts` 及 `electron/main.ts` 里的滚动截图部分 |
| `electron/windowCapture.ts` | `electron/windowCapture.ts` |
| `electron/onboarding.ts`、`electron/onboardingRules.ts`（欢迎引导、拖拽授权小窗） | `electron/main.ts` 里的 onboarding / permission helper 部分 |
| `electron/main.ts` 里的菜单栏图标可见性、输入法切换后修复快捷键、开发用环境变量 | `electron/main.ts` |
| `src/components/onboarding/`、`src/components/screenshot/ScrollCapturePanel.tsx` 的交互 | `src/components/onboarding/`、`src/components/screenshot/ScrollCapturePanel.tsx` |
| `scripts/mac-signing-policy.mjs`、`scripts/sign-mac-local.mjs`、`scripts/install-mac-local.mjs`、`scripts/mac-app-registration.mjs`、`scripts/list-mac-app-registrations.swift`、`scripts/check-mac-signature.mjs`、`scripts/test-scroll-stitcher.mjs` | `scripts/` 下的同名或对应脚本 |

QuickShot 的部分早期代码来自 OpenScreen（MIT 许可证，<https://github.com/siddharthvaddem/openscreen>）；上面移植的部分是 QuickShot 自己后来写的 macOS 功能。
