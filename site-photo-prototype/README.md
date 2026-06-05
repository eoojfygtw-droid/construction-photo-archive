# 工地照片歸檔系統 Web Prototype v0

純前端可點擊模擬圖(mock),用來驗證 UI / UX、資料欄位、操作流程、資料夾歸檔邏輯。
**不接 Telegram API、不接 SQLite、不接 AI、不處理真實檔案。** 全部資料在 `src/mockData.ts`,重新整理頁面即還原。

## 啟動方式

```powershell
cd site-photo-prototype
npm install
npm run dev
```

開啟瀏覽器 http://localhost:5173

## 頁面清單

| 頁面 | 路徑 | 驗證重點 |
|---|---|---|
| 首頁儀表板 | `/` | 今日紀錄數、待處理數、無法判斷數、各工地照片數、最近 10 筆 |
| 紀錄列表 | `/records` | 工地/日期/狀態/回報人篩選,GPS 判斷狀態欄 |
| 紀錄詳細 | `/records/:id` | 照片、文字、語音、GPS、判斷方式、資料夾路徑、狀態修改、人工備註 |
| 無法判斷工地 | `/unresolved` | _inbox 暫存區概念,人工選擇工地後模擬完成歸檔(紀錄編號會改變) |
| 工地設定 | `/projects` | 工地代碼/名稱/中心 GPS/判斷半徑/啟用停用,模擬新增與編輯 |
| 匯出報表 | `/export` | 篩選 → 預覽 → 模擬匯出,顯示預計檔名 |
| Telegram 流程模擬 | `/telegram` | 三種情境:GPS 自動歸檔 / 無 GPS 要求選擇(可點按鈕) / #A001 指定工地 |

## 狀態設計

一般記錄、待處理、已改善、結案、不列管、未分類

## 工地判斷方式(project_resolve_method)

| 代碼 | 說明 |
|---|---|
| manual_code | 使用者指定工地代碼(/A001 或 #青山案) |
| photo_gps | 照片 EXIF GPS 判斷 |
| telegram_location | Telegram 位置訊息 |
| recent_context | 最近一次工地上下文(2 小時內有效) |
| user_selected | 使用者手動選擇 |
| unresolved | 無法判斷(暫存 _inbox) |

## Telegram 照片注意事項(正式版重要前提)

Telegram **一般傳照片(photo)會被壓縮,EXIF / GPS 會遺失**。
若要提高 GPS 自動歸檔成功率,重要照片請使用「**傳送檔案(document)**」方式上傳原圖。
正式版系統兩種訊息都支援;prototype 中照片縮圖會標示上傳方式與是否含 GPS,模擬此差異。

另注意:手機相機未開啟定位、室內收訊差時,原圖也可能沒有 GPS。
GPS 是輔助判斷,主力仍是工地代碼與上下文機制。

## 資料夾歸檔邏輯(正式版)

```
data/
  _inbox/                          ← 無法判斷工地的暫存區
    {record_no}/
  projects/
    {project_code}_{project_name}/
      {YYYY}/{MM}/{DD}/
        records/
          {record_no}/             ← 例:A001-20260605-001
            photos/
            voices/
            text.txt
            metadata.json
```

紀錄編號格式:`{工地代碼}-{YYYYMMDD}-{3 位流水號}`;未歸檔者暫用 `INBOX-{YYYYMMDD}-{流水號}`,人工選擇工地後改編並搬移資料夾(prototype 中可在「無法判斷工地」頁實際操作看到效果)。

## 檢查重點建議

1. 紀錄列表的欄位夠不夠?要不要加「樓層/工種」欄位?
2. 無法判斷工地頁的人工歸檔流程順不順?
3. Telegram 模擬的 Bot 回覆格式,工地人員看得懂嗎?
4. 工地設定的欄位(GPS 中心點 + 半徑)取得方式可行嗎?(Google Maps 點一下取座標)
5. 匯出報表的欄位與檔名格式符合公司報表習慣嗎?

確認流程 OK 後,才進入正式後端開發(Telegram Bot + SQLite + 檔案歸檔)。
