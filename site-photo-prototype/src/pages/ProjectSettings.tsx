// ============================================================
// 工地設定頁:工地清單 + 模擬新增 / 編輯(代碼、名稱、GPS、半徑、啟用)
// ============================================================
import { useState } from 'react';
import { useData } from '../DataContext';
import { Project, projectFolderName } from '../mockData';

/** 表單空白值 */
const EMPTY_FORM = {
  code: '',
  name: '',
  centerLat: '',
  centerLng: '',
  radiusMeters: '300',
  active: true,
};

export default function ProjectSettings() {
  const { projects, addProject, updateProject } = useData();
  const [editingId, setEditingId] = useState<number | null>(null); // null = 新增模式
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setMessage('');
  };

  const openEdit = (p: Project) => {
    setEditingId(p.id);
    setForm({
      code: p.code,
      name: p.name,
      centerLat: String(p.centerLat),
      centerLng: String(p.centerLng),
      radiusMeters: String(p.radiusMeters),
      active: p.active,
    });
    setShowForm(true);
    setMessage('');
  };

  const handleSave = () => {
    if (!form.code || !form.name) {
      setMessage('工地代碼與名稱為必填');
      return;
    }
    const data = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      centerLat: Number(form.centerLat) || 0,
      centerLng: Number(form.centerLng) || 0,
      radiusMeters: Number(form.radiusMeters) || 300,
      active: form.active,
    };
    if (editingId === null) {
      addProject(data);
      setMessage(`已新增工地 ${data.code} ${data.name}(模擬)`);
    } else {
      updateProject({ ...data, id: editingId });
      setMessage(`已更新工地 ${data.code} ${data.name}(模擬)`);
    }
    setShowForm(false);
  };

  const toggleActive = (p: Project) => {
    updateProject({ ...p, active: !p.active });
    setMessage(`${p.code} ${p.name} 已${p.active ? '停用' : '啟用'}(模擬)`);
  };

  return (
    <div>
      <div className="page-title">工地設定</div>
      <div className="page-desc">
        GPS 歸檔規則:照片 GPS 距離工地中心點 ≤ 判斷半徑 → 自動歸檔;多個符合或皆不符合 → 要求人工選擇,不硬猜。
      </div>

      {message && <div className="notice">{message}</div>}

      <div style={{ marginBottom: 12 }}>
        <button className="primary" onClick={openAdd}>+ 新增工地</button>
      </div>

      {showForm && (
        <div className="card">
          <h3>{editingId === null ? '新增工地' : '編輯工地'}</h3>
          <div className="filter-bar">
            <div className="field">
              <label>工地代碼 *</label>
              <input
                type="text"
                value={form.code}
                placeholder="例:A003"
                disabled={editingId !== null}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
            <div className="field">
              <label>工地名稱 *</label>
              <input
                type="text"
                value={form.name}
                placeholder="例:向上段新案"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label>中心緯度</label>
              <input
                type="text"
                value={form.centerLat}
                placeholder="24.1618"
                onChange={(e) => setForm({ ...form, centerLat: e.target.value })}
              />
            </div>
            <div className="field">
              <label>中心經度</label>
              <input
                type="text"
                value={form.centerLng}
                placeholder="120.6469"
                onChange={(e) => setForm({ ...form, centerLng: e.target.value })}
              />
            </div>
            <div className="field">
              <label>判斷半徑(公尺)</label>
              <input
                type="number"
                value={form.radiusMeters}
                onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })}
              />
            </div>
            <div className="field">
              <label>啟用</label>
              <select
                value={form.active ? '1' : '0'}
                onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
              >
                <option value="1">啟用</option>
                <option value="0">停用</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" onClick={handleSave}>儲存</button>
            <button onClick={() => setShowForm(false)}>取消</button>
          </div>
        </div>
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>代碼</th>
              <th>名稱</th>
              <th>中心 GPS</th>
              <th>判斷半徑</th>
              <th>狀態</th>
              <th>資料夾名稱</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td className="mono">{p.centerLat}, {p.centerLng}</td>
                <td>{p.radiusMeters} m</td>
                <td>
                  {p.active
                    ? <span className="badge badge-green">啟用</span>
                    : <span className="badge badge-gray">停用</span>}
                </td>
                <td><span className="mono">{projectFolderName(p)}</span></td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="small" onClick={() => openEdit(p)}>編輯</button>
                    <button className="small" onClick={() => toggleActive(p)}>
                      {p.active ? '停用' : '啟用'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
