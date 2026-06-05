// ============================================================
// 共用小元件:狀態徽章、判斷方式徽章、照片縮圖(假圖)
// ============================================================
import { MockPhoto, RecordStatus, ResolveMethod, RESOLVE_METHOD_LABEL } from './mockData';

/** 狀態 → 顏色 class */
const STATUS_CLASS: Record<RecordStatus, string> = {
  一般記錄: 'badge badge-blue',
  待處理: 'badge badge-orange',
  已改善: 'badge badge-green',
  結案: 'badge badge-dark',
  不列管: 'badge badge-gray',
  未分類: 'badge badge-red',
};

export function StatusBadge({ status }: { status: RecordStatus }) {
  return <span className={STATUS_CLASS[status]}>{status}</span>;
}

export function ResolveBadge({ method }: { method: ResolveMethod }) {
  const cls = method === 'unresolved' ? 'badge badge-red' : 'badge badge-outline';
  return (
    <span className={cls} title={method}>
      {RESOLVE_METHOD_LABEL[method]}
    </span>
  );
}

/** 照片縮圖(灰底假圖,顯示描述文字) */
export function PhotoThumb({ photo, size = 'md' }: { photo: MockPhoto; size?: 'sm' | 'md' }) {
  return (
    <div className={size === 'sm' ? 'photo-thumb photo-thumb-sm' : 'photo-thumb'}>
      <div className="photo-icon">📷</div>
      <div className="photo-label">{photo.label}</div>
      <div className="photo-meta">
        {photo.uploadType === 'document' ? '原圖(document)' : '壓縮(photo)'}
        {photo.hasExif ? ' · 含GPS' : ' · 無GPS'}
      </div>
    </div>
  );
}

/** 語音備註區塊(假播放器) */
export function VoiceBlock({ transcript }: { transcript: string }) {
  return (
    <div className="voice-block">
      <div className="voice-player">
        <span className="voice-play">▶</span>
        <span className="voice-bar" />
        <span className="voice-time">0:23</span>
      </div>
      {transcript && <div className="voice-transcript">語音轉文字(模擬):{transcript}</div>}
    </div>
  );
}
