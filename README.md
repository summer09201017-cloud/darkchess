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
- 規則提醒:暗棋只能走相鄰格(0831 冒煙測試曾因此假紅,已修)。

## 檔案

| 檔 | 用途 |
|---|---|
| `index.html` / `styles.css` | 殼層與版面 |
| `app.js` | 規則、3D 渲染、AI、提示 |
| `daily.js` | 每日同副牌 |
| `sw.js` | Service Worker,`CACHE_NAME = "cloud-banqi-v9"`(改殼層檔必 +1;v8 = 提示不建議白做工的交換、v9 = 版本簡歷可收合(別場 0907 批次)) |
| `manifest.webmanifest` / `icons/` | PWA |
| `test/daily.mjs` | `npm test`:每日牌組檢查 |
| `scripts/browser-check.mjs` | 真瀏覽器冒煙檢查 |

## 跑起來 / 測試

```bash
npx serve .            # 或任何靜態伺服器;直接雙擊 index.html 會讓 SW 失效
npm test               # node test/daily.mjs
```

## 部署(手動,push 不會上線)

```bash
npx wrangler pages deploy . --project-name darkchesscodex --branch main   # --branch main 必帶,否則進 Preview
curl -s "https://darkchesscodex.pages.dev/sw.js?b=$RANDOM" | grep CACHE_NAME   # 要是新版號
```

改了殼層檔先把 `sw.js` 的 `CACHE_NAME` 版本 +1 再部署,否則已安裝的 PWA 永遠看到舊版。

## 帳本

作品集已收、`sites.json` 棋類已登。新功能上線後照 skill `portfolio-ledger-guard` 收尾。

---
GitHub:`summer09201017-cloud/darkchess`。本 README 2026-09-03 補(此前文件沒寫網址,作品集對賬只能靠名字猜到本 repo)。
