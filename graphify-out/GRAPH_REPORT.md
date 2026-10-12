# Graph Report - NewPath  (2026-10-12)

## Corpus Check
- 157 files · ~72,661 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 703 nodes · 1368 edges · 36 communities (34 shown, 2 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 43 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `097128c1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 35|Community 35]]

## God Nodes (most connected - your core abstractions)
1. `writeDiagnostic()` - 34 edges
2. `OnboardingController` - 23 edges
3. `CaptureAgent` - 20 edges
4. `ScrollStitcher` - 19 edges
5. `mt()` - 19 edges
6. `startCapture()` - 18 edges
7. `ScrollCapture` - 17 edges
8. `ScrollCaptureController` - 17 edges
9. `scripts` - 17 edges
10. `serializeError()` - 15 edges

## Surprising Connections (you probably didn't know these)
- `LoadedSession` --references--> `CaptureMode`  [EXTRACTED]
  src/components/screenshot/RegionSelector.tsx → electron/ipcTypes.ts
- `SettingsModalProps` --references--> `LanguageSetting`  [EXTRACTED]
  src/components/main/SettingsModal.tsx → electron/ipcTypes.ts
- `SettingsModalProps` --references--> `SelectionMode`  [EXTRACTED]
  src/components/main/SettingsModal.tsx → electron/ipcTypes.ts
- `SettingsModalProps` --references--> `ActionResult`  [EXTRACTED]
  src/components/main/SettingsModal.tsx → electron/ipcTypes.ts
- `SettingsModalProps` --references--> `SettingsState`  [EXTRACTED]
  src/components/main/SettingsModal.tsx → electron/ipcTypes.ts

## Communities (36 total, 2 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.08
Nodes (44): apps, args, expectCertificate, delay(), exec, exists(), FLAGS, main() (+36 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (36): ScrollStatus, MOCK_FRAME, mockOnboardingApi, mockOnboardingState(), mockPermissionHelperApi, mockScrollCaptureApi, mockScrollState(), OnboardingApi (+28 more)

### Community 2 - "Community 2"
Cohesion: 0.08
Nodes (28): appWindow(), handle(), screenCommand(), scrollCommand(), startScroll(), captureFailure(), fail(), ScreenCapturer (+20 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (30): AgentEvent, Rect, AGENT_STATUSES, clamp(), clampScrollPanelPosition(), intersect(), panelOverlap(), parseScrollProgress() (+22 more)

### Community 4 - "Community 4"
Cohesion: 0.10
Nodes (28): captureWithDesktopCapturer(), displayPixels(), execScreencapture(), FrameSource, imageFrame(), readImage(), ScreenCapturer, temporaryPath() (+20 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (16): APP_ROOT, atLogin, CAPTURE_ACTIONS, capturer, command, devOptions, __dirname, MAIN_TRAFFIC_LIGHTS (+8 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (10): OnboardingStep, OnboardingController, Box, HELPER_SIZE, ONBOARDING_SIZE, ONBOARDING_STEPS, ONBOARDING_TRAFFIC_LIGHTS, placePermissionHelper() (+2 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (10): Equatable, Analysis, Outcome, appended, behind, full, lost, unchanged (+2 more)

### Community 8 - "Community 8"
Cohesion: 0.12
Nodes (14): CapturerOptions, CaptureAgent, Diagnostic, parseAgentEvent(), parseAgentLine(), Pending, splitLines(), agent (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (24): activateApp(), captureBusy(), captureWithSystemSelection(), closeCaptureSession(), deliverStitch(), finishScrollSession(), handleLaunchCommand(), hasScreenPermission() (+16 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (22): code:bash (npm install), code:bash (NEWPATH_DEV_CAPTURE_FILE=~/Desktop/screen.png npm run dev), code:bash (open -n /Applications/NewPath.app --args --capture          ), code:bash (export APPLE_ID="你的 Apple ID"), Developer ID + 公证（公开分发）, macOS 版, 与 Windows 版的差别, 命令行入口 (+14 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (8): en, MainMessages, MESSAGES, zhCN, zhTW, CreatePinWindow, PinManager, PinRecord

### Community 12 - "Community 12"
Cohesion: 0.16
Nodes (18): CaptureFinishPayload, CaptureSessionInfo, CaptureWindowsInfo, DevPermissionInfo, OcrLine, OcrResult, OcrWord, OnboardingState (+10 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (15): listMacWindows(), createCaptureAgent(), NativeHelper, nativeHelperPath(), runNativeHelper(), normalizeRawWindows(), parseRawWindows(), RawWindow (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.16
Nodes (9): Bitmap, check(), expectSame(), firstDifference(), frame(), makePage(), Random, Run (+1 more)

### Community 15 - "Community 15"
Cohesion: 0.11
Nodes (19): devDependencies, autoprefixer, electron, @electron/asar, electron-builder, lucide-react, postcss, react (+11 more)

### Community 16 - "Community 16"
Cohesion: 0.13
Nodes (16): CaptureFrame, CaptureAction, CaptureMode, DetectedWindow, Point, CaptureSession, createMockScreenshot(), createMockWindows() (+8 more)

### Community 17 - "Community 17"
Cohesion: 0.12
Nodes (17): scripts, build, build:linux, build:mac, build:native, build:win, check:mac:signature, dev (+9 more)

### Community 18 - "Community 18"
Cohesion: 0.32
Nodes (8): changeShortcut(), markOnboardingSeen(), persistSettings(), repairShortcut(), syncShortcut(), tryRegister(), unregisterCaptureShortcut(), saveSettings()

### Community 19 - "Community 19"
Cohesion: 0.23
Nodes (9): ActionResult, LanguageSetting, SelectionMode, SettingsState, mockMainApi, SORT_ORDER_LABEL, LANGUAGE_NAMES, SettingsModal() (+1 more)

### Community 20 - "Community 20"
Cohesion: 0.19
Nodes (13): mt(), setMainLocale(), allowMenuBarItem(), applyLocale(), checkTrayVisible(), createTray(), devPermissionInfo(), explainHiddenMenuBarIcon() (+5 more)

### Community 21 - "Community 21"
Cohesion: 0.23
Nodes (8): Locale, capture, zhCN, Messages, main, zhCN, onboarding, zhCN

### Community 22 - "Community 22"
Cohesion: 0.24
Nodes (11): ARCHS, build(), compile(), exec, HELPERS, hostOnly, mtime(), outDir (+3 more)

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (9): DevOptions, devPermissionHost(), Env, HOST_NAMES, OFF_VALUES, readDevOptions(), TERM_PROGRAM_NAMES, options (+1 more)

### Community 24 - "Community 24"
Cohesion: 0.18
Nodes (10): author, description, engines, node, license, main, name, private (+2 more)

### Community 25 - "Community 25"
Cohesion: 0.20
Nodes (7): ElectronAPI, items, listeners, MainApi, now, ok, settings

### Community 26 - "Community 26"
Cohesion: 0.29
Nodes (5): code:bash (npm run dev                                   # Vite + Elect), 代码约定, 命令, 新增 IPC 的步骤, 架构要点

### Community 27 - "Community 27"
Cohesion: 0.29
Nodes (8): diagnosticsDir(), AppSettings, handleMain(), registerIpc(), isSelectionMode(), loadSettings(), normalizeSettings(), defaults

### Community 28 - "Community 28"
Cohesion: 0.33
Nodes (5): agentDir, exec, executable, outDir, root

### Community 29 - "Community 29"
Cohesion: 0.50
Nodes (5): createWindow(), getMainWindow(), getRegionWindow(), openPreviewWindow(), titleBarOptions()

### Community 32 - "Community 32"
Cohesion: 0.67
Nodes (3): allowScripts, electron@39.8.10, electron-winstaller@5.4.0

### Community 35 - "Community 35"
Cohesion: 0.33
Nodes (6): chooseSaveDir(), getSettingsState(), loginItemOptions(), notifyMain(), setOpenAtLogin(), startWatching()

## Knowledge Gaps
- **201 isolated node(s):** `QuickShot`, `unchanged`, `waiting`, `appended`, `behind` (+196 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CaptureAgent` connect `Community 8` to `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `OnboardingController` connect `Community 6` to `Community 12`, `Community 5`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `writeDiagnostic()` connect `Community 4` to `Community 3`, `Community 5`, `Community 6`, `Community 9`, `Community 13`, `Community 18`, `Community 20`, `Community 27`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `ScrollStitcher` (e.g. with `.init()` and `.init()`) actually correct?**
  _`ScrollStitcher` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `QuickShot`, `unchanged`, `waiting` to the rest of the system?**
  _201 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.07518796992481203 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05909090909090909 - nodes in this community are weakly interconnected._