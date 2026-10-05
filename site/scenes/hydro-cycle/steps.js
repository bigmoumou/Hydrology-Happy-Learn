// 導覽步驟：對應課本 1.2 節與圖 1-1、1-2（課本 p.3–6）
// cam：[相機位置, 注視點]；flows：要強調的粒子系統；kind：課本的分類
export const STEPS = [
  {
    id: 'cover', zh: '封面', en: 'Cover', text: '', cam: [[80, 58, 128], [-14, 4, -6]], flows: 'all',
  },
  {
    id: 'overview', zh: '水文循環總覽', en: 'Hydrologic cycle',
    text: '水從海洋與地表蒸發進入大氣，凝結成雲後降到地表，再經地表與地下流回河川和海洋。這一連串不斷重複的過程就是水文循環。',
    cam: [[88, 98, 168], [3, 2, 3]], flows: 'all',
  },
  {
    id: 'precipitation', zh: '降水', en: 'precipitation', kind: '液體傳輸',
    text: '水蒸氣因凝結作用（condensation）形成雲，再以雨、雪、霜等不同形態從大氣降到地表。',
    cam: [[40, 30, 98], [-20, 22, -4]], flows: ['rain'],
  },
  {
    id: 'interception', zh: '截留', en: 'interception', kind: '暫時蓄存',
    text: '雨落下時，先落在樹梢或建築物上而被攔住。被截留的水有一部分會直接蒸發回大氣，不會到達地面。',
    cam: [[-14, 15, 54], [-26, 8, 30]], flows: ['drip', 'rain'],
  },
  {
    id: 'depression', zh: '窪蓄', en: 'depression storage', kind: '暫時蓄存',
    text: '在地表漫流的水，遇到地面凹陷處就聚積下來，形成大大小小的水窪。',
    cam: [[30, 16, 46], [18, 1, 24]], flows: ['overland'],
  },
  {
    id: 'infiltration', zh: '入滲', en: 'infiltration', kind: '液體傳輸',
    text: '直接落到地面的雨滴，一部分由地表滲入土壤之中。看切面上由地表往下的淺藍色粒子。',
    cam: [[-5, 26, 82], [-11, 4, 30]], flows: ['infil'],
  },
  {
    id: 'overland', zh: '漫地流／地表逕流', en: 'overland flow / surface runoff', kind: '液體傳輸',
    text: '沒有入滲的雨水在地表漫流，稱為漫地流；漫地流經河川網路進入河川後，稱為地表逕流。',
    cam: [[-2, 52, 70], [-8, 4, 2]], flows: ['overland'],
  },
  {
    id: 'interflow', zh: '中間流', en: 'interflow', kind: '液體傳輸',
    text: '滲入地表的水在還沒深達地下水位之前，就在淺層土壤中側向流動、流出進入河川。',
    cam: [[-5, 12, 64], [0.5, 2.0, 38]], flows: ['interflow'],
  },
  {
    id: 'percolation', zh: '滲漏', en: 'percolation', kind: '通往地下水',
    text: '一部分的水繼續往下深層滲漏，穿過未飽和層（土壤孔隙裡還有空氣），到達地下水位以下。',
    cam: [[-9, 15, 66], [-16, 5.5, 34]], flows: ['perc'],
  },
  {
    id: 'groundwater', zh: '地下水', en: 'groundwater', kind: '液體傳輸',
    text: '在地下水位以下的飽和含水層中，水流得很慢，最後流入河川或海洋。久旱不雨時河川仍有水，就是靠它。',
    cam: [[10, 22, 116], [6, -4, 32]], flows: ['gw'],
  },
  {
    id: 'exfiltration', zh: '出滲', en: 'exfiltration', kind: '液體傳輸',
    text: '當表層土壤乾燥時，土壤水份會由下層往上傳輸到地表。',
    cam: [[29, 8.5, 58], [23.5, 2.0, 39]], flows: ['exfil'],
  },
  {
    id: 'evaporation', zh: '蒸發', en: 'evaporation', kind: '汽體傳輸',
    text: '日照旺盛時，土壤或水面（窪蓄、河川、湖泊與海洋）的水分子吸收太陽能，由液態轉為汽態進入大氣。',
    cam: [[70, 22, 62], [40, 8, 0]], flows: ['evap'],
  },
  {
    id: 'transpiration', zh: '蒸散', en: 'transpiration', kind: '汽體傳輸',
    text: '土壤中的水被植物根系吸收，上傳到莖葉，再散失到大氣中。',
    cam: [[-8, 30, 58], [-24, 14, 16]], flows: ['transp'],
  },
  {
    // 互動實驗頁：退後一點，看得到實驗室和模型後方的科學家
    id: 'lab', zh: '互動實驗', en: 'Lab', text: '', cam: [[96, 86, 292], [-4, 8, -6]], flows: 'all',
  },
];
