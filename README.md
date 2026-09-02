# 雲臺暗棋(repo `darkchess`)

3D 翻牌暗棋 PWA,單機對 AI。純靜態、零建置、可安裝、可離線。

## 線上網址(正版)

**https://darkchesscodex.pages.dev** —— Cloudflare Pages 專案 `darkchesscodex`。

- 德義作品集卡片:`darkchess`「暗棋」(棋類)。
- 舊址 `darkchesscodex.netlify.app`(2026-09-03 實測仍回 200 供舊內容,尚未改 301 殼);
  repo 裡的 `netlify.toml`(`publish = "."`)是 Netlify 時代殘留,CF Pages 不讀它。
- ⚠ **名字陷阱**:repo 叫 `darkchess`,但 **`darkchess.pages.dev` 不是本站**(那是一頁標題只有「darkchess」的空殼,
  不在本帳號的 Pages 專案清單裡)。對賬/部署一律認 `darkchesscodex`。

## 功能

- 💡 **AI 提示**:借同一支 `chooseAiAction`,把 `aiSide` 換成玩家這邊(2026-09-01)。
- 📅 **每日同副牌**:今天全世界的暗子擺法都一樣,每天 3 副(2026-08-31)。
- 360° 視角 / 重設角度、重新開局、安裝到手機(PWA)。
- 規則提醒:暗棋只能走相鄰格(0831 冒煙測試曾因此假紅,已修)。

## 檔案

| 檔 | 用途 |
|---|---|
| `index.html` / `styles.css` | 殼層與版面 |
| `app.js` | 規則、3D 渲染、AI、提示 |
| `daily.js` | 每日同副牌 |
| `sw.js` | Service Worker,`CACHE_NAME = "cloud-banqi-v4"`(改殼層檔必 +1) |
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
