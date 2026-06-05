# 進度交接文件(HANDOFF)

> 本文件供 Claude Code 接手開發時讀取,記錄專案完整脈絡。
> 最後更新:2026-06-05

## 一、專案背景

需求方:建設公司總經理特助(使用者的同學)。
痛點:每日拍攝大量工地照片(品質記錄、缺失待改),人工整理耗時、缺失追蹤易漏件。
目標:工地人員在 Telegram 群組傳「照片+文字/語音」,系統自動歸檔至對應工地資料夾,提供後台查詢、狀態管理、Excel 匯出。

## 二、規格演進歷程(重要,避免走回頭路)

1. **初版構想**:AI 影像辨識分類照片 → 修正為「AI 只做輔助,必填欄位靠人工說明」
2. **ChatGPT 提出 Telegram Bot 方案** → 採納,但確認:單一群組、台灣工地若要全員使用須換 LINE(已用 adapter 介面預留)
3. **工地判斷改為五層優先序**(不依賴群組 ID):
   manual_code(#A001)> photo_gps > telegram_location > recent_context(2小時)> 按鈕詢問
4. **V0 範圍刪減**:不做 AI 影像辨識、不做語音轉文字、不做 LINE、不做 PDF —— 先把歸檔管線做穩,保留 AIAnalyzer 介面
5. **決定先做 Web Prototype 驗證流程,再寫正式後端**(目前在此階段)

## 三、目前狀態

### 已完成
- **Web Prototype v0**(本 repo):Vite + React + TS,純前端 mock,7 個頁面
  - 首頁儀表板 / 紀錄列表(四種篩選)/ 紀錄詳細(可改狀態、存備註)
  - 無法判斷工地頁(可模擬人工歸檔,紀錄編號 INBOX-xxx → A001-20260605-003)
  - 工地設定(GPS 中心點+半徑,模擬新增編輯)/ 匯出報表(篩選+預覽+模擬匯出)
  - Telegram 流程模擬(3 情境,情境 2 按鈕可互動)
- 建置驗證通過(tsc + vite build),本機 npm run dev 可跑
- 規格文件:docs/PRD_v2.md

### 進行中
- 同學檢視 prototype 操作流程(GitHub Pages 分享)
- 待回饋重點:欄位夠不夠(樓層/工種?)、Bot 回覆格式好不好懂、匯出檔名格式

### 未開始
- 正式後端(等 prototype 確認後才動工)

## 四、正式後端規格摘要(確認後開發)

- Node.js + TypeScript、SQLite(better-sqlite3)、Telegram Bot 用 long polling(免公開網址)
- 訊息接收層:MessageChannelAdapter 介面(未來可換 LINE)
- 資料夾結構:
  ```
  data/
    _inbox/{record_no}/                     ← 無法判斷工地的暫存區
    projects/{code}_{name}/{YYYY}/{MM}/{DD}/records/{record_no}/
      photos/  voices/  text.txt  metadata.json
  ```
- 資料表:projects、records(含 project_resolve_method/status、gps 欄位)、photos(has_exif、upload_type)、user_contexts、status_logs
- 關鍵實作注意:
  - media group(一次傳多張)合併為同一筆紀錄(debounce 約 2 秒)
  - Telegram photo 壓縮會移除 EXIF;document 保留原圖。EXIF 解析需支援 HEIC(建議用 exifr)
  - 工地建檔:/addproject 指令 + projects.seed.json 兩種方式
  - 位置訊息 = 設定該使用者 recent context(與第 4 層共用機制)
  - 無法判斷不可硬猜,一律進 _inbox + 按鈕詢問
- 資安前提:照片會送 AI API(未來 V1+),需公司知情同意;除 AI API 外不傳第三方

## 五、分版計畫

- **V0(下一步)**:Bot 收訊 → 五層工地判斷 → 檔案歸檔 → SQLite → Bot 回覆;驗收 = 連續 5 個工作天實際使用
- **V1**:語音轉文字(Whisper)、後台網頁、Excel 匯出、狀態管理
- **V2**:缺失改善前後照片關聯(photos.phase: before/after)、逾期提醒、日報生成

## 六、開發規範(同 CLAUDE.md)

- 所有程式碼加繁體中文註解;回覆用繁體中文
- 每完成一個功能點先跑通再做下一個
- 涉及刪除、覆蓋、對外發布,先詢問使用者
- 重要決策寫入本文件「規格演進歷程」
