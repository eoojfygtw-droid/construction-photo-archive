# 工地照片歸檔系統

> 本專案受 AI 戰情室總管轄，META 規範見 `ai-warroom-meta/docs/META_RULES.md`。
> 核心紅線：照片本身與個資（案場地址/人臉/車牌/客戶名/合約）絕不進 Git，只放程式碼＋docs；真檔案存本機/NAS。

## 專案狀態
- Web Prototype v0(純前端 mock,Vite + React + TS)已完成,操作流程確認中
- 下一階段:正式後端 — Node.js + TS + Telegram Bot(long polling)+ SQLite + 檔案歸檔
- 完整脈絡:docs/HANDOFF.md;完整規格:docs/PRD_v2.md;與後續對話確認的修正為準

## 已定案的關鍵決策
- 通道:Telegram 單一群組;訊息接收層必須做 MessageChannelAdapter 介面,保留未來換 LINE 的空間
- 工地判斷優先序:manual_code > photo_gps > telegram_location > recent_context(2小時)> 按鈕詢問使用者
- 無法判斷工地 → 存 data/_inbox/ 暫存區,不可硬猜
- 紀錄編號:{project_code}-{YYYYMMDD}-{3位流水號};歸檔日期以收件時間為準,EXIF 拍攝時間另存欄位
- V0 不做 AI 分析,但保留 AIAnalyzer 介面
- Telegram photo 會壓掉 EXIF,重要照片用 document 上傳;EXIF 解析需支援 HEIC(建議用 exifr)
- media group(一次傳多張照片)合併為同一筆紀錄

## 開發規範
- 所有程式碼加繁體中文註解,回覆使用繁體中文
- 分版開發:每完成一個功能點先跑通再做下一個,不一次產出全部
- 涉及刪除、覆蓋、對外發布,先詢問使用者
- 重大決策確定後,更新 docs/HANDOFF.md 的「規格演進歷程」
