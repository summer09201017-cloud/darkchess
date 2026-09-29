# 雲臺暗棋(repo `darkchess`)

3D 翻牌暗棋 PWA,單機對 AI。純靜態、零建置、可安裝、可離線。

## 線上網址(正版)

**https://darkchesscodex.pages.dev** —— Cloudflare Pages 專案 `darkchesscodex`。

- 德義作品集卡片:`darkchess`「暗棋」(棋類)。
- 舊址 `darkchesscodex.netlify.app` 已於 2026-09-03 改成 301 殼,轉到上面的正版(curl 實測 301);
  repo 裡的 `netlify.toml`(`publish = "."`)是 Netlify 時代殘留,CF Pages 不讀它。
  ⚠ 這個 Netlify 站原本連著本 repo 的 GitHub **自動建置**:0903 推 README 就觸發重建、把 301 殼蓋回完整站。
  已把該站 `build_settings.stop_builds` 設為 true(照 skill `netlify-autobuild-stop`),之後 push 不再觸發 Netlify 建置、不燒點數。
- ⚠ **名字陷阱**:repo 叫 `darkchess`,但 **`darkchess.pages.dev` 不是本 repo**——那是德義另一個作品
  「暗棋(早期版)」(作品集卡 `darkchess-pages`),源碼在另一顆硬碟、不在這台機的 Cloudflare 帳號 Pages 清單裡
  (0903 使用者確認)。本 repo 的對賬/部署一律認 `darkchesscodex`。

## 功能

- 🧊 **原址升級真 3D(2026-09-29,verTag v12 / sw v14;規格 `Documents/Codex/2026-09-28/0917-3d-11-3d-3d-3d/work/dark-3d-spec-draft.md`)**:
  棋盤、32 枚棋子、動物對手都在**同一個** three scene(`js/scene3d.js` 總控,ES module 經 index.html 橋接成 `window.Banqi3D`)。
  分層照 skill `board3d-kit`:底座 `js/board3d.js`(來自 gomoku3d,含 fitExtra 動物讓位)只管「一張會被點的立體棋盤」;
  `js/pieces3d.js` 管棋子/動畫/標記/命中;規則與輪次仍只在 app.js 一份 state。站內對底座的適配有七條,全寫在 board3d.js 檔頭
  (r128 色彩 encoding、r128 非物理燈光、storageKey:null、ResizeObserver/onCamera/context lost、**垂直置中取景 centerFit**(setViewOffset,命中同一個投影矩陣不會偏)、
  讓位上限可調 fitExtraMax 1.22(開動物盤寬 ≥ 關閉時 ~79%)、fitSlab 盤底四角入鏡)。
  ★ **暗子不洩漏**:app.js `publicCells()` 對暗子只給 `{hidden:true}`;32 枚共用一個背面材質、mesh 名稱只有 `piece-hidden`、userData 全空;
  翻面**規則先提交**、動畫前半只畫背面、**越過中點才貼正面**(朗讀內容也等到中點才更新);正面貼圖翻開才畫。
  ★ **手勢**:`|dx|+|dy| ≥ 8px` 才算拖曳;一次 primary pointer 最多一個點擊;cancel / lostpointercapture / 第二指 / 盤外放開作廢;畫布不聽 click(沒有雙送)。
  命中先對 ≤32 枚棋子圓柱做解析式射線相交(最近者贏,低視角不會點到後排),沒打到才打盤面平面;盤外木框 / 背景 / 動物 = null。
  ★ **AI / 提示進 Worker**:規則+搜尋逐字抽到 `banqi-core.js`(主執行緒 / `ai-worker.js` / node 測試共用一份;`test/core-parity.mjs` 拿抽離前錄的 40 局黃金檔守 160 手全同);
  請求帶 gen / reqId / turnCount / turnSide / purpose,重開 / 切模式 / 切每日 / 換難度都讓舊搜尋失效;回來還要再對一次合法手;10 秒沒回或出錯 ⇒「重試 AI」(不代走、不判輸)。
  同一個高手搜尋放主執行緒會凍 ~900ms,放 Worker 後 rAF 最大空窗 50ms(check-3d ⑦,無頭 Edge 實測)。
  ★ **視角**:skill view-kit 浮動面板(棋盤左上「🎥 視角」:斜俯視 58° / 正俯視 88° / 對局視角 34°、水平 0–359°、俯角 20–88°、🔃 換邊 +180°、🎯 重置);
  存在新鍵 `cloud-banqi-3d-view-v1`(`{version:1,preset,yaw,pitch|null}`),第一次從舊 `viewSpin/viewTilt` 換算(yaw = spin、pitch = 90 − tilt,預設 350 / 46°;舊 flat ⇒ 正俯視 88°),
  符號用升級前 784d49e 的 CSS 棋盤四角方位驗過(`test/fixtures/legacy-view-golden.json`,差 ≤ 2.1°);舊角度備份不覆寫。
  ★ **平面退路**:WebGL 開不起來 / 中途 context lost ⇒ 卸掉 3D、回到原本的 DOM 棋盤同局繼續(`#renderNotice` 說明);DOM 32 格在 3D 模式下是看不見、不攔滑鼠、鍵盤可 Tab 的無障礙層(焦點格 3D 盤上畫白框)。
  three r128 改放同源 `vendor/three.r128.min.js`(sw 預快取,離線照樣開 3D)。🐾 動物改坐同 scene(`js/opponent.js`:矩形盤緣座位、相機對面、凳子落地、取景收到耳尖;手機橫向矮畫面藏)。
  驗:`npm run test:core`(core-parity 161 / hidden-invariance 161 / board3d-geom 7841,純 node)、`npm run test:3d`(scripts/check-3d.mjs 139 條,真瀏覽器)、
  browser-check 🐾 段改同 scene 斷言、check-fit / check-fold 改量 3D 盤角投影框(**舊量法在 3D 下量的是 1px 無障礙層 ⇒ 假綠**,已改)。
- 🐾(v11 舊作法,**v12 已改成同 scene**,下面保留當歷史)- 🐾 **動物對手坐到棋盤對面(2026-09-28,verTag v11 / sw v13;skill `animal-opponent-kit` 第七個活例、CSS 斜視站的第一個)**:
  對戰 AI 時棋盤遠端上方坐著一隻會眨眼、會想棋、會說話的小動物——休閒 🐰 / 標準 🐱 / 高手 🐻;📅 每日同副牌 🦉;雙人同機不出現。
  ★ 本站棋盤是 CSS 斜視(DOM + rotateX),沒有 three 場景可以坐 ⇒ 牠住在 `.board-card` 裡一個**透明的 WebGL 小窗**(`#petWindow > canvas`,`js/opponent.js`):
  `petLayout()`(app.js)量棋盤投影框(`getBoundingClientRect` 含 rotateX/rotateZ/透視)把小窗貼在**遠端那條邊上方、置中**,`pointer-events:none`;
  小窗底最多壓到木框 8px、**不壓任何一格**(遠端那排格子投影框最高點再往上 2px)。大小 = 棋盤投影寬 28%(96~200px,高 = 寬 × 1.25)。
  一般版面:卡片頂端 `padding-top` 多留 `--pet-reserve`(styles.css);fit-play(⛶ 沉浸 / 手機橫向):`fitBoard()` 從可用高度扣 `petReserve()`(卡片高 20%,90~170px),
  **卡片矮於 480px(真手機橫向)就藏、棋盤不為牠縮**(接受;看牠請直向)。小窗自己一套 scene / camera(fov 35、俯角 15°,距離二分法把凳子底~耳尖、手臂外緣收進 ±0.95)/ renderer(alpha),
  rAF 只在牠看得見時跑、`document.hidden` 暫停、每 ~250ms 叫 `petLayout` 重量(拖曳旋轉 / 過渡動畫時跟著)。
  反應跟 AI 流程同一個分岔:牠開算 think(人聲每三手一次)/ 翻到自己的子 hop(人聲每三次一次)・翻到對方的 shrug / 吃你的子 hop+「吃掉了!」/ 走位 place /
  你吃牠的子 gasp+「哇」/ 一局結束 win・lose(每局一次閂鎖)/ 等你太久閒聊(15s 第一句、再 30s 第二句、一回合兩句,任何 pointerdown / keydown 歸零)。
  引擎 `js/animals.js`、人聲 `js/voice.js`、`js/three-shim.js`(全域 THREE r128 → ESM 具名匯出 + 補 CapsuleGeometry)三支與 skill assets **同一份,不在站裡改**(browser-check 逐位元對賬);
  three r128 從 CDN 載(跟 3D-Xiangqi 同一個網址,sw 也快取)、index.html 一張 import map 把 `three` 指到 shim(必須在第一個 module script 之前)、`window.PetKit` 橋接進傳統 script。
  人聲 `npm run voice`(= `gen-voice.mjs --phrases js/voicePhrases.js --out voice --sw sw.js`)⇒ `voice/` 36 支 mp3 + manifest,sw.js `voice:begin~end` 段照目錄重生。
  ⚠ `js/package.json` 寫 `{"type":"module"}`:repo 根是 `"type":"commonjs"`,node(gen-voice / browser-check)import `js/*.js` 才不會當成 CJS 炸掉;瀏覽器不看它。
  UI:設定卡多一組「🐾 對手動物」三段(會說話 / 不出聲 / 關,localStorage `banqi-pet`);狀態行「你執紅，🐱 橘貓(AI)執黑。」、思考中帶臉、小窗上方小名牌。
  驗:browser-check 🐾 段 +28(檔案對賬 / 引擎同 skill / 真操作開局 / 鐵則遍歷 / 頭在小窗裡 / 小窗在卡片裡・不壓格・遠端那排點得到 / 直向放得下 / 橫向 fit-play 藏 /
  真點翻子等牠回手 figs.log 有 think+hop / 姿勢手動推時間 / 三段 / 雙人同機不坐 / 人聲 runtime / 每日 🦉);npm test 29 / test:fold 33 / check-fit / test:hint 全綠;四種版面截圖目視。
  ⚠ 姿勢一律 `pet.update(0.4)` 手動推時間(無頭 fps 低);`pet.probe()` 一次量頭頂 NDC / 頭框 / 小窗框。
- 💡 **AI 提示**:2026-09-01 首版是「借同一支 `chooseAiAction`,把 `aiSide` 換成玩家這邊」;
  **2026-09-07 起改走專用的 `chooseHintAction()`** —— 使用者退件「提示叫我吃、吃完又被別的子吃回,等於交換被吃」。
  病因 ①同分偏好吃子(`scored.sort` 是穩定排序,平手時照 `orderActionsForSearch` 的順序,而那支把吃子 ×1.2 排最前)
  ②葉子沒有靜態搜尋 ⇒ 水平線效應(`evaluateState` 對被威脅的子扣 18% 只擋得住一部分)。
  修法:`quiesceCaptures()`(minimax 葉子只續走吃子)+ `captureGain()`(只看已翻開的子力把交換算到底)
  + `HINT_TRADE_MARGIN = 60`(半個兵)。吃子要**兩關都過**才建議:①子力真的有賺(吃將例外)②比最好的
  不吃子的手多賺半個兵;否則建議走位或翻牌。AI 對手仍走 `chooseAiAction`,不受門檻約束。
  量化(60 個局面、發牌與走子都固定 seed 的 A/B):舊 42 手建議吃子裡 **4 手是白做工**,新 32 手裡 **0 手**;
  最慢 618ms → 147ms。測試 `npm run test:hint`(真瀏覽器 + 頁面內獨立裁判,40 個隨機中局)。
  ⚠ `window.__banqi` 裡不可以直接寫後面才宣告的 `const`(TDZ ⇒ 整支 app.js 掛掉、畫面全白),一律用 getter。
- 📅 **每日同副牌**:今天全世界的暗子擺法都一樣,每天 3 副(2026-08-31)。
- 360° 視角 / 重設角度、重新開局、安裝到手機(PWA)。
- ▼ **收起選單**(2026-09-14,sw v10):狀態卡右邊「▼ 收起選單 / ▲ 展開選單」鈕(棋盤正上方,桌機/手機/⛶放大模式都看得到)
  切 `body.menu-folded`;CSS 藏掉 `aside.info-column` 三張面板(戰況/暗子資訊/規則摘要)、操作方式卡、標題副標與安裝提示,
  版面改單欄、桌機棋盤 32.5rem → 40rem;手機棋盤本來就撐滿 87vw,不變小、頁面少捲一大段。
  狀態記 localStorage `cloud-banqi-menu-folded-v1`(讀寫包 try/catch),`aria-expanded` 跟著切;切完補一發 `resize`(棋盤是純 CSS 尺寸,只是保險)。
  驗收 `npm run test:fold`(`scripts/check-fold.mjs`:真點擊,桌機 1200×800 + 手機直向 390×844,收/展/reload 記得住/零 pageerror)。
- 規則提醒:暗棋只能走相鄰格(0831 冒煙測試曾因此假紅,已修)。

## 檔案

| 檔 | 用途 |
|---|---|
| `index.html` / `styles.css` | 殼層與版面 |
| `app.js` | 狀態、輪次、AI 流程(派 Worker)、提示、DOM 無障礙層 / 平面退路、3D 接線 |
| `banqi-core.js` | 規則 + 搜尋的唯一一份(v12 從 app.js 逐字抽出;瀏覽器 / Worker / node 共用) |
| `ai-worker.js` | AI / 💡 提示搜尋執行緒(importScripts banqi-core.js) |
| `js/scene3d.js` / `js/board3d.js` / `js/pieces3d.js` / `js/view-kit.js` / `js/three-full.js` | 🧊 真 3D:總控 / 底座(gomoku3d 來源 + 站內適配)/ 棋子與標記 / 視角面板(skill board3d-kit 同一份)/ three 門面 |
| `vendor/three.r128.min.js` | three r128(同源,sw 預快取) |
| `daily.js` | 每日同副牌 |
| `js/animals.js` / `js/voice.js` / `js/three-shim.js` | 🐾 動物引擎 / 🗣 人聲 runtime / 全域 THREE→ESM shim(與 skill animal-opponent-kit/assets **同一份,不要在這裡改**;browser-check 對賬) |
| `js/opponent.js` / `js/voicePhrases.js` | 本站的動物接線(v12 同 scene:矩形盤緣座位、誰坐、反應、閒聊、probe)與四隻的唸稿;`scripts/gen-voice.mjs` 烤 mp3 → `voice/`(`npm run voice`) |
| `js/package.json` | 只給 node 看的 `{"type":"module"}`(repo 根是 commonjs) |
| `sw.js` | Service Worker,`CACHE_NAME = "cloud-banqi-v14"`(v14 = 🧊 真 3D:+banqi-core / ai-worker / js 五支 / vendor three,CDN 拿掉;v13 = 🐾 動物對手:+js 五支 + three CDN + voice 段)(改殼層檔必 +1;**名單/退路不可有 index.html,只認 `./`**;v8 = 提示不建議白做工的交換、v9 = 版本簡歷可收合(別場 0907 批次)、v10 = ▼ 收起選單(2026-09-14)) |
| `manifest.webmanifest` / `icons/` | PWA |
| `test/daily.mjs` | `npm test`:每日牌組檢查 |
| `scripts/browser-check.mjs` | 真瀏覽器冒煙檢查 |
| `scripts/check-fold.mjs` | `npm run test:fold`:▼ 收起選單真點擊驗收(桌機+手機) |
| `test/hint.mjs` | `npm run test:hint`:💡 提示品質(真瀏覽器,40 個隨機中局) |
| `test/core-parity.mjs` / `test/hidden-invariance.mjs` / `test/board3d-geom.mjs` | `npm run test:core`(純 node):搬家不改棋力 / 交換暗子搜尋不變 / 3D 格↔世界↔點擊 80 視角 + 三反例 |
| `scripts/check-3d.mjs` | `npm run test:3d`:v12 驗收(真座標點擊、規則、暗子反例、翻面分格、手勢、Worker、過期反例、重試、每日逐位元、螢幕 × DPR 矩陣、遷移、退路、資源、SW、離線) |
| `test/fixtures/*.json` | 升級前 784d49e 錄的黃金檔(搜尋 40 局 / 每日 12 副 / 舊 CSS 視角四角方位)+ 重搜尋局面;產生器 `scripts/gen-*-golden.mjs`,**不要用新版重錄** |

## 跑起來 / 測試

```bash
npx serve .            # 或任何靜態伺服器;直接雙擊 index.html 會讓 SW 失效
npm test               # node test/daily.mjs(純 node,不用起站)
py -m http.server 8797 # 下面三支真瀏覽器測試預設打 http://localhost:8797(或 CHECK_URL=線上網址)
npm run test:hint      # node test/hint.mjs
npm run test:fold      # node scripts/check-fold.mjs
node scripts/browser-check.mjs   # 含 🐾 動物對手段(v12 同 scene 斷言)
npm run test:core      # 純 node:core-parity + hidden-invariance + board3d-geom
npm run test:3d        # 真瀏覽器 v12 驗收(SHOTS=1 會把視角截圖存到 scripts/out/)
npm run voice          # 🐾 烤動物人聲(要網路;累加式,已有的跳過)
```
✅ browser-check 的勝局鏈六條(T01 推到分出勝負 → T02 戰績記在第 1 副 → T03 結算訊息 → T04 接第 2 副 → T05 第 2 副是另一副牌 → T06 狀態行)**0928 修好**:
根因在測試前置,不在遊戲——舊版在提示段玩到一半的當天真實牌局上清光 AI 子,再找「有相鄰空格的己方明子」;當天洗牌若己方明子四周都是暗子(0928 第 1 副就是),那一手根本沒走 ⇒ 六條連環假紅。
修法(只動 `scripts/browser-check.mjs`,產品碼沒改):每個案例一個全新 context + `page.clock.setFixedTime` 釘日期(計時器照跑)+ 固定合法雙子殘局(紅俥 0、黑卒 1、已走 8 回合),
走正式 `handleCellClick(0)`→`(1)`,勝負與戰績由 `finalizeAfterAction → scoreDailyIfWon` 自己產出;日期矩陣 09-27 / 09-28 / 09-29;
另有三個反例驗「測試會抓錯」:盤面不一致會報錯、不走最後一手不會通關、`applyDailyWin` 不持久化時 T02/T04 會紅。
0928 本機實測:`node scripts/browser-check.mjs` **84 過 / 0 失敗**(原 47 綠 + 新 37 條),連跑兩次;`npm test` 29/0。
⚠ 這是引擎/UI 狀態整合測試,不驗棋盤滑鼠命中(那由提示鈕與 🐾 段的真點擊負責);只改測試、不需部署,線上沒重測。

## 部署(手動,push 不會上線)

```bash
npx wrangler pages deploy . --project-name darkchesscodex --branch main   # --branch main 必帶,否則進 Preview
curl -s "https://darkchesscodex.pages.dev/sw.js?b=$RANDOM" | grep CACHE_NAME   # 要是新版號
```

改了殼層檔先把 `sw.js` 的 `CACHE_NAME` 版本 +1 再部署,否則已安裝的 PWA 永遠看到舊版。
部署後驗:`curl -s "https://darkchesscodex.pages.dev/js/scene3d.js?b=$RANDOM" | head -c 60`、`…/ai-worker.js`、`…/vendor/three.r128.min.js`(要是真內容不是首頁)、`CHECK_URL=https://darkchesscodex.pages.dev node scripts/browser-check.mjs`。

⚠ **SW 快取名單與離線退路不可以有 `index.html`(0914 全艦隊修,sw v12)**:Cloudflare Pages 把 `/index.html` 308 到 `/`,
名單裡有它 install 就存到 redirected 回應,裝成 App 打開就 ERR_FAILED(3D-Chess 幻影版實錘)。一律只認 `./`;install 逐一 add+catch 不用 addAll。
補丁來源:skill `static-pwa-ship/patches/patch-sw-index.mjs`;線上重演 `scripts/check-sw-nav-fleet.mjs <url>` 要 🟢。

## 帳本

作品集已收、`sites.json` 棋類已登。新功能上線後照 skill `portfolio-ledger-guard` 收尾。

- 🟡 **🧊 原址升級真 3D(0929 HFP 機,verTag v12 / sw v14)**:本機全部測試綠(見「功能」第一條);**尚未部署**到 darkchesscodex、線上未驗、真機未驗(等使用者決定發布)。
- ✅ **🐾 動物對手坐到棋盤對面(0928 HFP 機・Fable 5.1・0928-3D動物對手-象棋家族-家裡 場,verTag v11 / sw v13)**:見上面「功能」第一條;CSS 斜視站用透明 WebGL 小窗,同一套引擎 / 人聲。
- ✅ **拔掉「index.html 進 SW 快取名單」地雷(0914 全艦隊,verTag v10 / sw v12)**:`APP_ASSETS` 拔 `./index.html`、退路 `caches.match("./")` 只給導覽請求、`addAll` → 逐一 `add().catch()`;線上 `check-sw-nav-fleet.mjs` 🟢(開 /index.html 兩次不 ERR_FAILED、快取無 redirected、離線回殼層)。見「部署」段的 ⚠。
- ✅ **⛶ 放大真的放大 + 桌機 ⛶ + 手機橫向自動滿版(0914,v9 / sw v11)**:`body.fit-play`(app.js `syncFitPlay`/`fitBoard`/`bindFitPlay`,styles.css 檔尾)—— 沉浸或手機橫向時整頁一屏,棋盤用所有子孫的投影框聯集逐步縮放到剛好裝進 `.board-card`(`--fit-board-w` + `--fit-shift`);`#mfsExit` 是看得見的出口(同一個 toggle);「☰ 選單」= `body.panels-open` 暫回一般版面。驗:`CHECK_URL=… node scripts/check-fit.mjs`(本機預設 8797)。

---
GitHub:`summer09201017-cloud/darkchess`。本 README 2026-09-03 補(此前文件沒寫網址,作品集對賬只能靠名字猜到本 repo)。
