# PROGRESS_LOG — 工地照片歸檔系統

> 時間軸。重大進展、踩雷、里程碑往這裡補。詳細規格演進另見 docs/HANDOFF.md「二、規格演進歷程」。

## 2026-06-05 接入戰情室管轄、docs 歸位
- 經 Claude cowork 完成需求溝通後，交接給 Claude Code（檔案交接：CLAUDE.md + HANDOFF.md + PRD_v2.md）。
- 在 `D:\projects\construction-photo-archive` 建 repo、`git init`、`.gitignore`（照片/影片/個資/機密全擋——照片絕不進 Git 的紅線）。
- 兩份規格從根目錄歸位到 docs/（`HANDOFF.md`、`PRD_v2.md`），補齊戰情室四件套（PROJECT_OVERVIEW / NEXT_ACTIONS / PROGRESS_LOG / DECISIONS）。
- 規格演進收斂重點：AI 從「主分類」降為「輔助結構化」、通道定 Telegram（adapter 預留 LINE）、工地判斷改五層優先序、V0 範圍刪減（不做 AI 影像/語音/LINE/PDF）、先做 Web Prototype 驗流程再寫後端。

## 2026-06-05（先前，cowork 階段）Web Prototype v0 完成
- Vite + React + TS 純前端 mock，7 個頁面，操作流程可走完。
- tsc + vite build 通過，本機 `npm run dev` 可跑；分享 GitHub Pages 給建設公司特助試。
- 待回饋：欄位完整度（樓層/工種）、Bot 回覆格式、匯出檔名格式。

### 下一步
- 等同學確認 prototype → 動工正式後端 V0（Node+TS+SQLite+Telegram long polling），把「收訊 → 五層工地判斷 → 檔案歸檔 → SQLite → Bot 按鈕確認」管線做穩。
