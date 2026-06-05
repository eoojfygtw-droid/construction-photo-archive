// ============================================================
// 紀錄詳細頁:照片、文字、語音、GPS、工地判斷、資料夾路徑、
//             狀態修改、人工備註
// ============================================================
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useData } from '../DataContext';
import { PhotoThumb, ResolveBadge, StatusBadge, VoiceBlock } from '../components';
import { ALL_STATUSES, RecordStatus, recordFolderPath } from '../mockData';

export default function RecordDetail() {
  const { id } = useParams();
  const { records, projects, setRecordStatus, setRecordNote } = useData();
  const record = records.find((r) => r.id === Number(id));
  const [noteDraft, setNoteDraft] = useState(record?.manualNote ?? '');
  const [saved, setSaved] = useState('');

  if (!record) {
    return (
      <div>
        <div className="page-title">找不到紀錄</div>
        <Link to="/records">← 回紀錄列表</Link>
      </div>
    );
  }

  const project = projects.find((p) => p.code === record.projectCode);

  const handleStatusChange = (s: RecordStatus) => {
    setRecordStatus(record.id, s);
    setSaved(`狀態已更新為「${s}」(模擬)`);
  };

  const handleNoteSave = () => {
    setRecordNote(record.id, noteDraft);
    setSaved('人工備註已儲存(模擬)');
  };

  return (
    <div>
      <div className="page-title">紀錄詳細:{record.recordNo}</div>
      <div className="page-desc">
        <Link to="/records">← 回紀錄列表</Link>
      </div>

      {saved && <div className="notice">{saved}</div>}

      <div className="card">
        <h3>基本資訊</h3>
        <dl className="detail-grid">
          <dt>回報人</dt>
          <dd>{record.reporter}</dd>
          <dt>回報時間</dt>
          <dd>{record.date} {record.time}</dd>
          <dt>系統判斷工地</dt>
          <dd>
            {project
              ? `${project.code} ${project.name}`
              : <span className="muted">未歸檔(在 _inbox 暫存區)</span>}
            {' '}<ResolveBadge method={record.resolveMethod} />
          </dd>
          <dt>GPS 資訊</dt>
          <dd>
            {record.gps
              ? `緯度 ${record.gps.lat} / 經度 ${record.gps.lng}(距工地中心 ${record.gps.distanceM} 公尺)`
              : <span className="muted">照片無 EXIF GPS,亦無位置訊息</span>}
          </dd>
          <dt>資料夾路徑</dt>
          <dd><span className="mono">{recordFolderPath(record, projects)}</span></dd>
          <dt>目前狀態</dt>
          <dd><StatusBadge status={record.status} /></dd>
        </dl>
      </div>

      <div className="card">
        <h3>照片({record.photos.length} 張)</h3>
        <div className="photo-grid">
          {record.photos.map((p, i) => (
            <PhotoThumb key={i} photo={p} />
          ))}
        </div>
        <div className="hint">
          ※ Prototype 使用假圖。「壓縮(photo)」表示 Telegram 一般傳照片,EXIF 會被壓掉;
          「原圖(document)」表示以檔案方式上傳,保留 EXIF / GPS。
        </div>
      </div>

      <div className="card">
        <h3>文字備註</h3>
        <div>{record.textNote || <span className="muted">(無文字備註)</span>}</div>
      </div>

      <div className="card">
        <h3>語音備註</h3>
        {record.voiceCount > 0 ? (
          <VoiceBlock transcript={record.voiceTranscript} />
        ) : (
          <span className="muted">(無語音備註)</span>
        )}
      </div>

      <div className="card">
        <h3>狀態修改</h3>
        <div className="filter-bar">
          <div className="field">
            <label>變更狀態</label>
            <select
              value={record.status}
              onChange={(e) => handleStatusChange(e.target.value as RecordStatus)}
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="hint">※ 正式版會記錄狀態異動歷程(誰、何時、從什麼狀態改到什麼狀態)</div>
      </div>

      <div className="card">
        <h3>人工備註</h3>
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="輸入後台人工備註,例如:已開缺失單、廠商預計改善日期…"
        />
        <div style={{ marginTop: 8 }}>
          <button className="primary" onClick={handleNoteSave}>儲存備註</button>
        </div>
      </div>
    </div>
  );
}
