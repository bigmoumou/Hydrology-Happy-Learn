// 介面語言：由 <html lang> 決定（/en/ 底下的頁面是 lang="en"）。
// 共用的 JS 用 tr(中文, 英文) 取字；中文頁輸出的文字和原本完全一樣，錄影不受影響。
export const EN = /^en\b/i.test(document.documentElement.lang || '');
export const tr = (zh, en) => (EN ? en : zh);

// 3D 標籤：中文頁是「中文＋小字英文」；英文頁只放英文（預設把小字英文首字大寫）
export const labelText = (zh, en, enMain) => (EN ? [enMain ?? en.charAt(0).toUpperCase() + en.slice(1), ''] : [zh, en]);

// 3D 載入進度的階段名稱（程式內部用中文當鍵，只在顯示時翻譯）
const STAGE_EN = { '地形骨架': 'Terrain', '侵蝕模擬': 'Erosion', '河道與水文分析': 'Rivers', '環境遮蔽': 'Shading', '建立 3D 模型': 'Building 3D model', '完成': 'Done' };
export const stageName = (s) => (EN ? STAGE_EN[s] || s : s);
