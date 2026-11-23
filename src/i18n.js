// UI copy in Chinese and English.
const STR = {
  zh: {
    ariaCanvas: '三维场景：一只戴红围巾的鹈鹕骑着自行车，行驶在日落时分的海岸公路上。',
    loading: '正在孵化鹈鹕…',
    tagline: '一只鹈鹕 · 一辆单车 · 一段海岸线',
    unitKmh: 'km/h', unitRpm: 'rpm', unitKm: 'km',
    statsSpeed: '车速', statsCadence: '踏频', statsDist: '里程',
    bell: '车铃', soundOn: '关闭声音', soundOff: '开启声音', shot: '截图', share: '分享链接', hide: '隐藏界面', controls: '控制',
    ride: '骑行', speed: '速度', sprint: '冲刺 · 嘎！',
    world: '环境', time: '时刻', sunrise: '日出', noon: '正午', sunset: '日落', midnight: '午夜',
    autoTime: '自动昼夜', night: '切到夜晚', day: '回到黄昏',
    camera: '视角', camHero: '英雄', camSide: '侧面', camFront: '正面', camChase: '追随', camFace: '特写', camDetail: '机械', camTop: '俯瞰', camWide: '海岸',
    paint: '涂装',
    fx: '效果', bloom: '泛光', wire: '线框', slow: '慢动作', autoRotate: '自动环绕', cinematic: '电影机位',
    keysHint: '拖拽旋转 · 滚轮缩放 · ↑↓ 调速 · Space 冲刺 · B 车铃 · N 昼夜 · C 视角 · P 暂停 · H 隐藏界面 · 点一点鹈鹕、车铃和鱼',
    fallbackTitle: '无法启动 3D 场景',
    fallbackBody: '当前浏览器不支持 WebGL2。请用最新版 Chrome、Edge、Safari 或 Firefox 打开。',
    timeDawn: '日出', timeMorning: '上午', timeNoon: '正午', timeAfternoon: '下午', timeGolden: '黄昏', timeSunset: '日落', timeDusk: '暮色', timeNight: '夜晚',
    toastBell: '叮铃铃～', toastHonk: '嘎——！', toastShared: '链接已复制', toastShareFail: '复制失败，请从地址栏复制',
    toastShot: '截图已保存', toastPaused: '已暂停 · 按 P 继续', toastResumed: '继续骑行', toastHidden: '按 H 恢复界面',
    qHigh: '高画质', qMid: '中画质', qLow: '省电',
    honk: '嘎！',
  },
  en: {
    ariaCanvas: '3D scene: a pelican in a red scarf riding a bicycle along a coastal road at sunset.',
    loading: 'Hatching the pelican…',
    tagline: 'One pelican · one bicycle · one coastline',
    unitKmh: 'km/h', unitRpm: 'rpm', unitKm: 'km',
    statsSpeed: 'Speed', statsCadence: 'Cadence', statsDist: 'Distance',
    bell: 'Bell', soundOn: 'Mute', soundOff: 'Sound', shot: 'Snapshot', share: 'Share', hide: 'Hide UI', controls: 'Controls',
    ride: 'Ride', speed: 'Speed', sprint: 'Sprint · HONK!',
    world: 'World', time: 'Time', sunrise: 'Dawn', noon: 'Noon', sunset: 'Dusk', midnight: 'Night',
    autoTime: 'Day cycle', night: 'Night', day: 'Golden hour',
    camera: 'Camera', camHero: 'Hero', camSide: 'Side', camFront: 'Front', camChase: 'Chase', camFace: 'Close-up', camDetail: 'Mechanics', camTop: 'Top', camWide: 'Coast',
    paint: 'Paint',
    fx: 'Effects', bloom: 'Bloom', wire: 'Wireframe', slow: 'Slow motion', autoRotate: 'Auto orbit', cinematic: 'Cinematic',
    keysHint: 'Drag to orbit · Scroll to zoom · ↑↓ speed · Space sprint · B bell · N day/night · C camera · P pause · H hide UI · click the pelican, the bell or the fish',
    fallbackTitle: 'The 3D scene could not start',
    fallbackBody: 'This browser has no WebGL2. Please open the page in a current Chrome, Edge, Safari or Firefox.',
    timeDawn: 'Dawn', timeMorning: 'Morning', timeNoon: 'Noon', timeAfternoon: 'Afternoon', timeGolden: 'Golden hour', timeSunset: 'Sunset', timeDusk: 'Twilight', timeNight: 'Night',
    toastBell: 'Ring ring!', toastHonk: 'HONK!', toastShared: 'Link copied', toastShareFail: 'Could not copy — use the address bar',
    toastShot: 'Snapshot saved', toastPaused: 'Paused · press P to resume', toastResumed: 'Back on the road', toastHidden: 'Press H to show the UI',
    qHigh: 'High', qMid: 'Medium', qLow: 'Eco',
    honk: 'HONK!',
  },
};

const store = {
  get(k) {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ }
  },
};

let lang = 'zh';

export const t = (key) => STR[lang][key] ?? key;
export const getLang = () => lang;

export function detectLang() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'zh' || q === 'en') return q;
  const saved = store.get('pelican.lang');
  if (saved === 'zh' || saved === 'en') return saved;
  return (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function setLang(next) {
  lang = next === 'en' ? 'en' : 'zh';
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  store.set('pelican.lang', lang);
  applyI18N();
}

export function applyI18N() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const s = STR[lang][el.dataset.i18n];
    if (s != null) el.textContent = s;
  }
  for (const el of document.querySelectorAll('[data-i18n-aria]')) {
    const s = STR[lang][el.dataset.i18nAria];
    if (s != null) el.setAttribute('aria-label', s);
  }
}

/** Human name for a time of day in [0, 1). */
export function timeLabel(v) {
  if (v >= 0.97 || v < 0.04) return t('timeDawn');
  if (v < 0.17) return t('timeMorning');
  if (v < 0.33) return t('timeNoon');
  if (v < 0.43) return t('timeAfternoon');
  if (v < 0.49) return t('timeGolden');
  if (v < 0.515) return t('timeSunset');
  if (v < 0.585) return t('timeDusk');
  return t('timeNight');
}
