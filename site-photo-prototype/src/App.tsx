// ============================================================
// App — 左側選單 + 路由
// ============================================================
import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import RecordList from './pages/RecordList';
import RecordDetail from './pages/RecordDetail';
import Unresolved from './pages/Unresolved';
import ProjectSettings from './pages/ProjectSettings';
import ExportPage from './pages/ExportPage';
import TelegramSim from './pages/TelegramSim';
import { useData } from './DataContext';

export default function App() {
  const { records } = useData();
  const unresolvedCount = records.filter((r) => r.projectCode === null).length;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">
          工地照片歸檔系統
          <div className="sidebar-sub">Prototype v0(全部假資料)</div>
        </div>
        <nav>
          <NavLink to="/" end>首頁儀表板</NavLink>
          <NavLink to="/records">紀錄列表</NavLink>
          <NavLink to="/unresolved">無法判斷工地({unresolvedCount})</NavLink>
          <NavLink to="/projects">工地設定</NavLink>
          <NavLink to="/export">匯出報表</NavLink>
          <NavLink to="/telegram">Telegram 流程模擬</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/records" element={<RecordList />} />
          <Route path="/records/:id" element={<RecordDetail />} />
          <Route path="/unresolved" element={<Unresolved />} />
          <Route path="/projects" element={<ProjectSettings />} />
          <Route path="/export" element={<ExportPage />} />
          <Route path="/telegram" element={<TelegramSim />} />
        </Routes>
      </main>
    </div>
  );
}
