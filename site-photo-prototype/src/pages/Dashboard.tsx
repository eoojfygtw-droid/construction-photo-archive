// ============================================================
// 首頁儀表板:今日紀錄數 / 待處理 / 無法判斷 / 各工地照片數 / 最近 10 筆
// ============================================================
import { Link } from 'react-router-dom';
import { useData } from '../DataContext';
import { StatusBadge, ResolveBadge } from '../components';
import { TODAY, projectFolderName } from '../mockData';

export default function Dashboard() {
  const { records, projects } = useData();

  const todayRecords = records.filter((r) => r.date === TODAY);
  const pendingCount = records.filter((r) => r.status === '待處理').length;
  const unresolvedCount = records.filter((r) => r.projectCode === null).length;

  // 各工地照片數統計
  const photoCountByProject = projects
    .filter((p) => p.active)
    .map((p) => ({
      project: p,
      photos: records
        .filter((r) => r.projectCode === p.code)
        .reduce((sum, r) => sum + r.photos.length, 0),
      recordCount: records.filter((r) => r.projectCode === p.code).length,
    }));

  // 最近 10 筆(依日期+時間倒序)
  const recent = [...records]
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, 10);

  return (
    <div>
      <div className="page-title">首頁儀表板</div>
      <div className="page-desc">今日:{TODAY}(模擬日期)</div>

      <div className="stat-row">
        <div className="stat-box">
          <div className="num">{todayRecords.length}</div>
          <div className="label">今日紀錄數</div>
        </div>
        <div className="stat-box attn">
          <div className="num">{pendingCount}</div>
          <div className="label">待處理數</div>
        </div>
        <div className="stat-box warn">
          <div className="num">{unresolvedCount}</div>
          <div className="label">無法判斷工地數</div>
        </div>
      </div>

      <div className="card">
        <h3>各工地照片數</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>工地代碼</th>
                <th>工地名稱</th>
                <th>紀錄數</th>
                <th>照片數</th>
                <th>資料夾</th>
              </tr>
            </thead>
            <tbody>
              {photoCountByProject.map(({ project, photos, recordCount }) => (
                <tr key={project.id}>
                  <td>{project.code}</td>
                  <td>{project.name}</td>
                  <td>{recordCount}</td>
                  <td>{photos}</td>
                  <td><span className="mono">data/projects/{projectFolderName(project)}/</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>最近 10 筆紀錄</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>紀錄編號</th>
                <th>日期時間</th>
                <th>工地</th>
                <th>回報人</th>
                <th>摘要</th>
                <th>判斷方式</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/records/${r.id}`}>{r.recordNo}</Link></td>
                  <td>{r.date} {r.time}</td>
                  <td>{r.projectCode ?? <span className="muted">未歸檔</span>}</td>
                  <td>{r.reporter}</td>
                  <td>{r.textNote ? r.textNote.slice(0, 18) : <span className="muted">(無文字)</span>}</td>
                  <td><ResolveBadge method={r.resolveMethod} /></td>
                  <td><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
