# PLAN v2：缺失生命週期閉環（Defect Lifecycle）

> 狀態：設計定稿，待 V0 驗收（6/17 收尾）後開工
> 來源：學長（總經理特助＝真實使用者）需求 → 戰情室席顧問 → 本檔
> 學長已確認流程（2026-06-16 回覆 6 點複述，完全對上）

## 1. 目標與定位

把「看到缺失就拍照」升級成「一條可結案的缺失追蹤線」。
痛點：看到就拍 → 同部位照片散落 → 不知拍幾次/何時看過/修好沒 → 沒時間整理追蹤。

選 B（真閉環）非 A（只貼標籤篩選）：前後照片勾稽、能結案、後台可撈未結案清單。
價值大頭在**後台撈取/追蹤**，不在拍照那一下。

使用者規模：1–3 人，拍照者＝追蹤者同一人（非工人拍、辦公室整理兩批人）。

## 2. 學長確認狀態（2026-06-16）

學長回覆 6 點複述流程，**完全對上骨架**，並背書三個關鍵設計點：
- 「先點正在看的那件缺失，接著拍的自動歸」→ 核心配對機制（每趟巡查先選一次）使用者接受、不嫌煩
- 「純拍現況不按狀態、不增負擔」→ 現況照零摩擦設計確認
- 「系統自動算張數/次數/上次/狀態」→ 後台統計價值確認

**A 案拍板（兩項由「待定」轉「定」）**：
- 三狀態（待修繕／修繕中／完成修繕）先上線，`status` 欄保留擴充（日後要「無法修繕／追蹤觀察」只塞值、不改表）
- 部位說明（title）設為**可選**，零強迫

## 3. 資料模型

### 新增 `defects` 表
| 欄位 | 型別 | 說明 |
|---|---|---|
| defect_id | PK | 內部主鍵 |
| defect_no | text | 對人顯示編號，建議 per-site `D001`、`D002`… |
| project_code | text | 所屬工地 |
| title | text, **nullable** | 部位說明（如「3 樓東側 滲水」），可選 |
| status | text | 待修繕／修繕中／完成修繕／結案 |
| created_at | datetime | 起案日 |
| closed_at | datetime, nullable | 結案日 |
| last_inspected_at | datetime, nullable | 上次巡查（可由 records 推導，先存冗餘加速查詢） |
| inspection_count | int | 巡查次數（同上，可推導） |

### `records` 表（既有）新增
- `defect_id`（nullable）：歸屬哪條缺失；現況照＝null
- `defect_stage`：拍當下標的狀態（給時間線看「這張是待修繕時拍的還是修繕中拍的」）

### 巡查統計
先用 records 推導（distinct 巡查日期＝次數、max＝上次、count＝張數），**不另開表**。
`defects.last_inspected_at` / `inspection_count` 當查詢加速的冗餘欄，寫入時更新。

## 4. 捕捉流程

1. 拍照標「待修繕」→ 建 `defects` 一筆（status=待修繕）+ 讀 caption 當 title（可空）+ 設「目前缺失」context 指向這件
2. 之後同一趟拍的照片 → 自動掛到「目前缺失」的 defect_id，`defect_stage` 記當下狀態
3. 標「修繕中」/「完成修繕」→ 更新 `defects.status`
4. 「完成修繕」→ 結案、寫 closed_at
5. 純現況照（不按任何狀態）→ defect_id=null，照舊存，零摩擦

## 5. 配對機制（核心，學長已背書）

硬限制：**GPS 認不出同部位** → 配對必須人給訊號。

新 `CurrentDefectStore`（reporter → 目前 defect_id，鏡像既有 `UserContextStore`/recent_context）。
設定來源二選一：
- **未結案短清單選**：機器人列出「該工地未結案缺失」短清單，使用者點一件
- **reply-to 原照片**：直接回覆某張缺失照（Telegram 支援；LINE reply-to 受限，見風險）

清除規則：選別件 / 標完成結案 / TTL 逾時（TTL 值待定，見第 8 節）。

## 6. 後台功能

- **缺失清單**：狀態/工地篩選，顯示部位說明、狀態、巡查次數、上次、張數、起案日
- **撈未結案**＝篩 status ∈ {待修繕, 修繕中}
- **缺失詳細時間線**：同一 defect 的前後照片按時間排，配 defect_stage 看修繕進程
- **報告頁**：加「按缺失分組」視圖
- **後台改掛**：可把某張 record 重掛到別的缺失（複用既有 `applyProjectReassign` 同型邏輯）

## 7. 狀態詞彙對齊

現有 status（待確認／待改善）與新詞彙**分離並存**：
- 缺失（defects）走新詞彙：待修繕／修繕中／完成修繕／結案
- 現況照（records, defect_id=null）沿用舊 status
不互相覆蓋，避免語義打架。

## 8. 分片 D0–D5

| 片 | 內容 | 備註 |
|---|---|---|
| D0 | 資料模型 + migration | 純加表/加欄，無行為改動 |
| D1 | 捕捉（Telegram 先） | 待修繕建線、後續自動掛、狀態更新 |
| D2 | 配對 | 未結案短清單選 + reply-to |
| D3 | 後台 | 清單/詳細時間線/篩選/報告分組 |
| D4 | LINE 對等 | 等 LINE L 階段 adapter；reply-to 退路在此處理 |
| D5 | 收尾 | 巡查統計呈現/逾期提醒/銷案規則 |

寫在 `core/` 兩通道（Telegram/LINE）共用。

## 9. 待定 / 風險（純技術決定，與學長無關，落檔/動工時定）

- defect_no 編法（建議 per-site `D001`）
- 「目前缺失」context 的 TTL 值（多久沒動自動清除）
- 巡查統計：先 records 推導 vs 日後開表（建議先推導）
- **LINE reply-to 受限**：D4 要設計退路（純短清單選，不依賴 reply-to）
- 缺失閉環 vs LINE 擴通道排序：顧問建議閉環優先（現用者開口要的＝北極星）

## 10. 動工前提

V0 驗收 6/17 收尾、宣告 V0 通過後才開工 V2。

落檔提醒：
- construction CLI 那邊建好後，它負責 commit/push 該 repo（不是我）。
- 那邊可依 construction 實際 schema 微調欄位名、UserContextStore/applyProjectReassign 真實簽名 —— 這份是設計層藍圖，實作以該 repo 現況為準。
- 別忘了 V0 6/17 收尾通過後才動 D0。

---

## 附錄：實作對齊檢查（construction CLI 落檔時補，2026-06-16）

> 由 construction CLI 對著 repo 現況核對本藍圖引用到的符號/schema。以下為事實核對，藍圖本文未動。

### A. 引用符號核對（皆存在、可照用）
| 藍圖引用 | repo 實際 | 結論 |
|---|---|---|
| 複用 `applyProjectReassign` 做缺失改掛 | `src/core/confirm/siteFlow.ts:74`，簽名 `applyProjectReassign(db, recordId, proj, actorId)`；admin（`src/admin/index.ts`）與 bot callback 兩邊共用 | ✅ 照此型新增平行的 `applyDefectReassign` |
| `CurrentDefectStore` 鏡像 `UserContextStore` | `src/core/resolve/UserContextStore.ts`：公開 `set / setIfNewer / get`，TTL 預設 `2h`（建構子可調） | ✅ 直接照抄結構；TTL 值見第 8 節待定 |
| records 加 `defect_id` / `defect_stage`、新增 `defects` 表 | `src/db/index.ts`：`records.status` 預設「待確認」，用 node:sqlite；additive `ALTER TABLE ADD COLUMN` 可行 | ✅ D0 純加表/加欄 |
| 現況照沿用舊 status、缺失走新詞彙 | 舊值「待確認/待改善」在 `confirmFlow` 設定，schema 預設「待確認」 | ✅ 分離並存無衝突 |

### B. D1/D2 開工前要補的實作細節（藍圖未細指、非阻塞）
1. **「標待修繕」的觸發 UI 未定**：建議掛在「確認回覆」上加三顆狀態按鈕，沿用既有 `OutgoingButton`（Telegram inline / LINE quick reply 皆已支援），兩通道共用。
2. **reply-to 配對需擴 `IncomingMessage`**：目前正規化型別（`src/channels/types.ts`）未帶「回覆了哪則訊息」，D2 需加 `replyTo` 欄 + 各 adapter 正規化。LINE reply-to 受限已在第 9 節風險列。
3. **`defect_no` per-site 流水號是新計數器**：可參考 `ProjectStore` 的 `nextAutoCode` 模式，但與 `record_no`（`{code}-{YYYYMMDD}-{NNN}`）是兩套編號，勿混用。

### C. D0 開工前置決策（2026-06-16 定案，使用者全數確認）

> 把第 9 節的待定填上 + 對齊 repo 現況。皆為實作層決定，未改藍圖設計與學長確認流程。

| # | 決策 | 定案 | 依據 |
|---|---|---|---|
| 1 | **migration 機制（D0 核心）** | 引入冪等 migration：`PRAGMA table_info` 檢查欄位 → 不存在才 `ALTER TABLE ... ADD COLUMN`；`defects` 用 `CREATE TABLE IF NOT EXISTS`。重啟 bot 自動補欄、不毀既有資料 | 現 schema 全 `CREATE IF NOT EXISTS`，無 ALTER 機制 → 加欄不會進既有 `app.db` |
| 2 | **時間欄型別** | 一律 **TEXT（ISO 字串）**，不用 datetime | repo 慣例：`records.created_at/received_at`、`status_logs.changed_at` 皆 TEXT |
| 3 | **`defect_no` 格式** | `{code}-D{NNN}`（per-site 流水 3 位，例 `A001-D001`）；新增產生器 `nextDefectNo(code)` 仿 `nextRecordNo` | 與 `record_no` 的 `{code}-` 前綴一致、易讀 |
| 4 | **`defect_stage` 位置 / 與既有 `photos.phase` 關係** | `defect_stage`（待修繕/修繕中/完成修繕）加在 **records**（同藍圖）；既有 `photos.phase`（before/after，schema 已存在、註解「V2 改善前後」）**先不動**，日後可由 defect_stage 推導 | 兩者語義不同，分開不打架；發現 schema 早已留 `phase` 伏筆 |
| 5 | **巡查統計** | 先 records 推導 + `defects.last_inspected_at`/`inspection_count` 冗餘欄（寫入時更新） | 同藍圖建議 |
| 6 | **status 值** | defects：待修繕/修繕中/完成修繕/結案；現況照(records, defect_id=null)沿用舊值 | 同藍圖第 7 節 |

**仍待 D1/D2 定（今天不鎖）**：`CurrentDefectStore` TTL（傾向 mirror `UserContextStore` 2h）、reply-to 擴 `IncomingMessage`、「標待修繕」觸發 UI、現況照 vs 自動掛的判定邏輯。
