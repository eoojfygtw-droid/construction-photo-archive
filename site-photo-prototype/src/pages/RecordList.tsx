// ============================================================
// 紀錄列表頁:依工地 / 日期 / 狀態 / 回報人篩選
// ============================================================
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../DataContext';
import { StatusBadge, ResolveBadge } from '../components';
import { ALL_STATUSES } from '../mockData';

export default function RecordList() {
  const { records, projects } = useData();
  const [fProject, setFProject] = useState('');
  const [fDate, setFDate] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fReporter, setFReporter] = useState('');

  const reporters = useMemo(
    () => Array.from(new Set(records.map((r) => r.reporter))),
    [records],
  );

  const filtered = records
    .filter((r) => (fProject ? r.projectCode === fProject : true))
    .filter((r) => (fDate ? r.date === fDate : true))
    .filter((r) => (fStatus ? r.status === fStatus : true))
    .filter((r) => (fReporter ? r.reporter === fReporter : true))
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));

  return (
    <div>
      <div className="page-title">紀錄列表</div>
      <div className="page-desc">共 {filtered.length} 筆</div>

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
          <label>日期</label>
          <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
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
        <div className="field">
          <label>回報人</label>
          <select value={fReporter} onChange={(e) => setFReporter(e.target.value)}>
            <option value="">全部</option>
            {reporters.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
        <button onClick={() => { setFProject(''); setFDate(''); setFStatus(''); setFReporter(''); }}>
          清除篩選
        </button>
      </div>

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>紀錄編號</th>
              <th>日期時間</th>
              <th>工地</th>
              <th>回報人</th>
              <th>照片</th>
              <th>語音</th>
              <th>GPS 判斷</th>
              <th>判斷方式</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/records/${r.id}`}>{r.recordNo}</Link></td>
                <td>{r.date} {r.time}</td>
                <td>{r.projectCode ?? <span className="muted">未歸檔</span>}</td>
                <td>{r.reporter}</td>
                <td>{r.photos.length} 張</td>
                <td>{r.voiceCount > 0 ? `${r.voiceCount} 則` : '—'}</td>
                <td>
                  {r.gps
                    ? `有(距中心 ${r.gps.distanceM}m)`
                    : <span className="muted">無 GPS</span>}
                </td>
                <td><ResolveBadge method={r.resolveMethod} /></td>
                <td><StatusBadge status={r.status} /></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="muted">無符合條件的紀錄</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
