// ============================================================
// 無法判斷工地頁:顯示未歸檔紀錄,人工選擇工地後模擬完成歸檔
// ============================================================
import { useState } from 'react';
import { useData } from '../DataContext';
import { PhotoThumb, VoiceBlock } from '../components';

export default function Unresolved() {
  const { records, projects, assignProject } = useData();
  const [message, setMessage] = useState('');

  const unresolved = records.filter((r) => r.projectCode === null);
  const activeProjects = projects.filter((p) => p.active);

  const handleAssign = (recordId: number, code: string) => {
    const p = projects.find((x) => x.code === code);
    assignProject(recordId, code);
    setMessage(`已將紀錄歸檔至「${code} ${p?.name ?? ''}」,檔案已從 _inbox 搬移至工地資料夾(模擬)`);
  };

  return (
    <div>
      <div className="page-title">無法判斷工地</div>
      <div className="page-desc">
        沒有 GPS、無工地代碼、也無近期上下文的紀錄,暫存於 <span className="mono">data/_inbox/</span>,
        請人工選擇工地完成歸檔。
      </div>

      {message && <div className="notice">{message}</div>}

      {unresolved.length === 0 && (
        <div className="card">目前沒有待歸檔的紀錄。</div>
      )}

      {unresolved.map((r) => (
        <div className="card" key={r.id}>
          <h3>{r.recordNo}</h3>
          <dl className="detail-grid" style={{ marginBottom: 10 }}>
            <dt>回報人</dt>
            <dd>{r.reporter}</dd>
            <dt>回報時間</dt>
            <dd>{r.date} {r.time}</dd>
            <dt>文字說明</dt>
            <dd>{r.textNote || <span className="muted">(無文字)</span>}</dd>
            <dt>無法判斷原因</dt>
            <dd className="muted">
              {r.photos.every((p) => !p.hasExif)
                ? '照片無 EXIF GPS(以一般 photo 上傳被壓縮),且訊息無工地代碼'
                : 'GPS 不在任何工地範圍內'}
            </dd>
          </dl>

          <div className="photo-grid" style={{ marginBottom: 10 }}>
            {r.photos.map((p, i) => (
              <PhotoThumb key={i} photo={p} size="sm" />
            ))}
          </div>

          {r.voiceCount > 0 && <VoiceBlock transcript={r.voiceTranscript} />}

          <div style={{ marginTop: 12 }}>
            <div className="hint" style={{ marginBottom: 6 }}>選擇歸檔工地:</div>
            <div className="chat-buttons">
              {activeProjects.map((p) => (
                <button key={p.id} className="small" onClick={() => handleAssign(r.id, p.code)}>
                  {p.code} {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
