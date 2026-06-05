// ============================================================
// DataContext — 全站共用的記憶體狀態(模擬資料庫)
// 狀態修改、人工歸檔、工地新增編輯都只改記憶體,重新整理即還原
// ============================================================
import React, { createContext, useContext, useState } from 'react';
import {
  MOCK_PROJECTS,
  MOCK_RECORDS,
  Project,
  RecordStatus,
  SiteRecord,
} from './mockData';

interface DataContextValue {
  records: SiteRecord[];
  projects: Project[];
  /** 修改紀錄狀態 */
  setRecordStatus: (id: number, status: RecordStatus) => void;
  /** 修改人工備註 */
  setRecordNote: (id: number, note: string) => void;
  /** 人工選擇工地完成歸檔(無法判斷 → user_selected) */
  assignProject: (id: number, projectCode: string) => void;
  /** 新增工地 */
  addProject: (p: Omit<Project, 'id'>) => void;
  /** 編輯工地 */
  updateProject: (p: Project) => void;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [records, setRecords] = useState<SiteRecord[]>(MOCK_RECORDS);
  const [projects, setProjects] = useState<Project[]>(MOCK_PROJECTS);

  const setRecordStatus = (id: number, status: RecordStatus) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
  };

  const setRecordNote = (id: number, note: string) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, manualNote: note } : r)));
  };

  const assignProject = (id: number, projectCode: string) => {
    setRecords((rs) =>
      rs.map((r) => {
        if (r.id !== id) return r;
        // 模擬歸檔:換編號、設定工地、判斷方式改為 user_selected、狀態脫離未分類
        const dateNo = r.date.replace(/-/g, '');
        const seq = String(
          rs.filter((x) => x.projectCode === projectCode && x.date === r.date).length + 1,
        ).padStart(3, '0');
        return {
          ...r,
          projectCode,
          recordNo: `${projectCode}-${dateNo}-${seq}`,
          resolveMethod: 'user_selected',
          status: r.status === '未分類' ? '一般記錄' : r.status,
        };
      }),
    );
  };

  const addProject = (p: Omit<Project, 'id'>) => {
    setProjects((ps) => [...ps, { ...p, id: Math.max(...ps.map((x) => x.id)) + 1 }]);
  };

  const updateProject = (p: Project) => {
    setProjects((ps) => ps.map((x) => (x.id === p.id ? p : x)));
  };

  return (
    <DataContext.Provider
      value={{ records, projects, setRecordStatus, setRecordNote, assignProject, addProject, updateProject }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData 必須在 DataProvider 內使用');
  return ctx;
}
