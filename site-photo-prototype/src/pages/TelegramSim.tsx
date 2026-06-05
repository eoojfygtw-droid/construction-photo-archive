// ============================================================
// Telegram 流程模擬頁:三種情境的聊天室模擬
//   情境 1:照片有 GPS → 自動歸檔成功
//   情境 2:照片沒有 GPS → Bot 要求選擇工地(可點按鈕互動)
//   情境 3:文字輸入 #A001 → 直接歸到指定工地
// ============================================================
import { useState } from 'react';

type Scenario = 1 | 2 | 3;

/** 聊天泡泡資料 */
interface Bubble {
  from: 'user' | 'bot';
  name: string;
  photo?: string; // 照片假圖文字
  text: string;
}

/** 情境 1:有 GPS 自動歸檔 */
const SCENARIO_1: Bubble[] = [
  {
    from: 'user',
    name: '李志成(監工)',
    photo: '📷 3F 天花配管(以 document 原圖上傳,含 GPS)',
    text: '3F 水電配管完成,留存記錄',
  },
  {
    from: 'bot',
    name: '工地歸檔 Bot',
    text:
      '✅ 已歸檔:\n' +
      '工地:A001 青山苑\n' +
      '日期:2026-06-05\n' +
      '紀錄:A001-20260605-002\n' +
      '判斷來源:photo_gps(照片 GPS,距工地中心 32m)',
  },
];

/** 情境 3:#A001 指定工地 */
const SCENARIO_3: Bubble[] = [
  {
    from: 'user',
    name: '王大明(工地主任)',
    photo: '📷 牆面空心近拍 ×3(一般 photo 上傳,無 GPS)',
    text: '#A001 5F 泥作 牆面空心,需打除重做',
  },
  {
    from: 'bot',
    name: '工地歸檔 Bot',
    text:
      '✅ 已歸檔:\n' +
      '工地:A001 青山苑\n' +
      '日期:2026-06-05\n' +
      '紀錄:A001-20260605-001\n' +
      '判斷來源:manual_code(訊息含工地代碼 #A001)\n' +
      '已設定您未來 2 小時的預設工地為 A001。',
  },
];

/** 情境 2 的前半段(等使用者點選工地) */
const SCENARIO_2_HEAD: Bubble[] = [
  {
    from: 'user',
    name: '王大明(工地主任)',
    photo: '📷 樓梯間踢腳板缺角 ×2(一般 photo 上傳,EXIF 已被壓縮移除)',
    text: '樓梯間踢腳板缺角',
  },
  {
    from: 'bot',
    name: '工地歸檔 Bot',
    text:
      '⚠️ 這批照片無法判斷工地:\n' +
      '・照片無 GPS(一般傳照片會被 Telegram 壓縮,EXIF 遺失)\n' +
      '・訊息無工地代碼\n' +
      '・您 2 小時內沒有指定過工地\n\n' +
      '已暫存於 _inbox,請選擇工地:',
  },
];

const PROJECT_CHOICES = [
  { code: 'A001', name: '青山苑' },
  { code: 'A002', name: '文心匯' },
  { code: 'B001', name: '河岸天景' },
];

export default function TelegramSim() {
  const [scenario, setScenario] = useState<Scenario>(1);
  // 情境 2:使用者選了哪個工地(null = 還沒選)
  const [picked, setPicked] = useState<{ code: string; name: string } | null>(null);

  const switchScenario = (s: Scenario) => {
    setScenario(s);
    setPicked(null); // 切換情境時重置互動狀態
  };

  const bubbles: Bubble[] =
    scenario === 1 ? SCENARIO_1 : scenario === 3 ? SCENARIO_3 : SCENARIO_2_HEAD;

  return (
    <div>
      <div className="page-title">Telegram 流程模擬</div>
      <div className="page-desc">
        模擬工地人員在 Telegram 群組傳照片後,Bot 的自動歸檔行為。共三種情境,情境 2 可實際點選按鈕。
      </div>

      <div className="scenario-tabs">
        <button className={scenario === 1 ? 'active' : ''} onClick={() => switchScenario(1)}>
          情境 1:照片有 GPS,自動歸檔
        </button>
        <button className={scenario === 2 ? 'active' : ''} onClick={() => switchScenario(2)}>
          情境 2:無 GPS,Bot 要求選工地
        </button>
        <button className={scenario === 3 ? 'active' : ''} onClick={() => switchScenario(3)}>
          情境 3:文字 #A001 指定工地
        </button>
      </div>

      <div className="chat-window">
        {bubbles.map((b, i) => (
          <div key={i} className={b.from === 'user' ? 'bubble bubble-user' : 'bubble bubble-bot'}>
            <div className="bubble-name">{b.name}</div>
            {b.photo && <div className="bubble-photo">{b.photo}</div>}
            <div>{b.text}</div>
          </div>
        ))}

        {/* 情境 2:工地選擇按鈕(inline keyboard 模擬) */}
        {scenario === 2 && !picked && (
          <div className="bubble bubble-bot">
            <div className="bubble-name">工地歸檔 Bot</div>
            <div className="chat-buttons">
              {PROJECT_CHOICES.map((p) => (
                <button key={p.code} onClick={() => setPicked(p)}>
                  {p.code} {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 情境 2:選擇後的 Bot 回覆 */}
        {scenario === 2 && picked && (
          <>
            <div className="bubble bubble-user">
              <div className="bubble-name">王大明(工地主任)</div>
              <div>(點選按鈕:{picked.code} {picked.name})</div>
            </div>
            <div className="bubble bubble-bot">
              <div className="bubble-name">工地歸檔 Bot</div>
              <div>
                {'✅ 已歸檔:\n' +
                  `工地:${picked.code} ${picked.name}\n` +
                  '日期:2026-06-05\n' +
                  `紀錄:${picked.code}-20260605-003\n` +
                  '判斷來源:user_selected(使用者手動選擇)\n' +
                  `已設定您未來 2 小時的預設工地為 ${picked.code}。`}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ marginTop: 16, maxWidth: 520 }}>
        <h3>工地判斷優先順序(正式版邏輯)</h3>
        <ol style={{ paddingLeft: 20, lineHeight: 1.9 }}>
          <li>訊息中的工地代碼(/A001 或 #青山案)→ manual_code</li>
          <li>照片 EXIF GPS 落在工地半徑內 → photo_gps</li>
          <li>Telegram 位置訊息 → telegram_location</li>
          <li>使用者 2 小時內指定過的工地 → recent_context</li>
          <li>以上皆無 → Bot 按鈕詢問 → user_selected;未回覆前為 unresolved</li>
        </ol>
        <div className="hint">
          ※ 重要缺失照片建議用「傳送檔案(document)」上傳原圖,一般傳照片會被壓縮、EXIF GPS 會遺失。
        </div>
      </div>
    </div>
  );
}
