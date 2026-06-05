// ============================================================
// 匯出報表頁:篩選 → 預覽 → 模擬匯出 Excel(顯示預計檔名)
// ============================================================
import { useState } from 'react';
import { useData } from '../DataContext';
import { StatusBadge } from '../components';
import { ALL_STATUSES, recordFolderPath, TODAY } from '../mockData';

export default function ExportPage() {
  const { records, projects } = useData();
  const [fProject, setFProject] = useState('');
  const [fFrom, setFFrom] = useState('2026-06-01');
  const [fTo, setFTo] = useState(TODAY);
  const [fStatus, setFStatus] = useState('');
  const [exportMsg, setExportMsg] = useState('');

  const filtered = records
    .filter((r) => (fProject ? r.projectCode === fProject : true))
    .filter((r) => (fFrom ? r.date >= fFrom : true))
    .filter((r) => (fTo ? r.date <= fTo : true))
    .filter((r) => (fStatus ? r.status === fStatus : true))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  // 預計匯出檔名:工地紀錄_{工地或全部}_{起日}_{迄日}.xlsx
  const fileName = `工地紀錄_${fProject || '全部工地'}_${fFrom.replace(/-/g, '')}-${fTo.replace(/-/g, '')}${fStatus ? `_${fStatus}` : ''}.xlsx`;

  const handleExport = () => {
    setExportMsg(`(模擬)已匯出 ${filtered.length} 筆紀錄 → ${fileName}。正式版將輸出實際 Excel 檔案。`);
  };

  return (
    <div>
      <div className="page-title">匯出報表</div>
      <div className="page-desc">篩選後預覽,確認再匯出 Excel(此處僅模擬)</div>

      <div className="filter-bar">
        <div className="field">
          <label>工地</label>
          <select value={fProject} onChange={(e) => setFProject(e.target.value)}>
            <option value="">全部</option>
            {projects.map((p) => (
              <option key={p.id} value={p.code}>{p.code} {p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>起日</label>
          <input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        </div>
        <div className="field">
          <label>迄日</label>
          <input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        </div>
        <div className="field">
          <label>狀態</label>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">全部</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button className="primary" onClick={handleExport}>模擬匯出 Excel</button>
      </div>

      <div className="card">
        <h3>預計匯出檔名</h3>
        <span className="mono">{fileName}</span>
      </div>

      {exportMsg && <div className="notice">{exportMsg}</div>}

      <div className="card table-wrap">
        <h3>匯出資料預覽({filtered.length} 筆)</h3>
        <table>
          <thead>
            <tr>
              <th>紀錄編號</th>
              <th>日期</th>
              <th>工地</th>
              <th>回報人</th>
              <th>文字備註</th>
              <th>照片數</th>
              <th>狀態</th>
              <th>資料夾路徑</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td>{r.recordNo}</td>
                <td>{r.date}</td>
                <td>{r.projectCode ?? '未歸檔'}</td>
                <td>{r.reporter}</td>
                <td>{r.textNote ? r.textNote.slice(0, 20) : '—'}</td>
                <td>{r.photos.length}</td>
                <td><StatusBadge status={r.status} /></td>
                <td><span className="mono" style={{ fontSize: 11 }}>{recordFolderPath(r, projects)}</span></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="muted">無符合條件的紀錄</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
