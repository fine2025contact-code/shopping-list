import bwipjs from '@bwip-js/browser';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  addDoc,
  collection,
  deleteDoc,
  doc, onSnapshot,
  orderBy,
  query,
  updateDoc,
  where
} from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';

// Cookieヘルパー（iOSのPWAでlocalStorageが消えるのを防ぐため）
function setCookie(name: string, value: string, days: number) {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  if (typeof document !== 'undefined') {
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
  }
}
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}
function deleteCookie(name: string) {
  if (typeof document !== 'undefined') {
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
  }
}
import {
  Alert,
  Animated,
  Dimensions,
  FlatList, KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet, Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { db } from '../../firebaseConfig';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type Item = { id: string; name: string; done: boolean; createdAt: number; familyCode: string };
type Card = {
  id: string;
  shopName: string;
  cardNumber: string;
  logoUrl?: string;
  color?: string;
  familyCode: string;
  codeType: string;
  order?: number;
  createdAt?: number;
};

// ---------------------------------------------------------------------------
// 在庫（日用品ストック）
//   考え方：毎回「使った」を記録するのは続かないので、
//           「1日にどれくらい減るか」だけ登録しておき、
//           経過時間から自動で減らす。書き込みは補充・修正した時だけ。
// ---------------------------------------------------------------------------
type Stock = {
  id: string;
  familyCode: string;
  name: string;
  unit: string;          // 個 / 袋 / g / ml など
  qty: number;           // lastCalcAt の時点の残量
  perDay: number;        // 1日の消費量（0 = 自動で減らさない）
  alertDays: number;     // 残り何日で知らせるか（perDay > 0 のとき）
  alertQty: number;      // 残りいくつで知らせるか（perDay = 0 のとき）
  autoAdd: boolean;      // 少なくなったら買い物リストへ自動で入れる
  lastCalcAt: number;    // qty を確定した時刻
  notifiedAt?: number | null; // 買い物リストへ自動追加した時刻（補充で消す）
  createdAt: number;
};

// 「買ってきた物をまとめて1枚」の写真＋その日の補充内容
type Restock = {
  id: string;
  familyCode: string;
  photo?: string;        // data URL（圧縮済み・ネット購入時は無し）
  memo?: string;
  lines: { name: string; qty: number; unit: string }[];
  createdAt: number;
};

const SHOPS = [{ id: '1', name: 'スーパー', latitude: 0, longitude: 0 }];
const NOTIFY_RADIUS = 200;

// ===========================================================================
// カラーテーマ
//   白  ＝ 背景・カード
//   緑  ＝ 「選択中」を示す色（ダイヤルの選択、タブの選択、チェック済み）
//   朱  ＝ 「操作するもの」（追加・削除・コード変更）
// ===========================================================================
const C = {
  bg: '#FFFFFF',
  green: '#008000',
  greenLine: 'rgba(0,128,0,0.30)',
  greenFaint: 'rgba(0,128,0,0.22)',
  greenGhost: 'rgba(0,128,0,0.10)',
  or: '#FF4500',
  tx: '#12240F',
  txMuted: '#5A6B57',
  txFaint: '#93A190',
  line: '#E6E9E3',
  field: '#F4F6F2',
};

const COLORS = [
  '#008000', '#FF4500', '#2E7D32', '#C2621A',
  '#1B5E20', '#8A6A3B', '#4A7C59', '#6B4E71',
];

const CODE_TYPES = [
  { label: 'バーコード (CODE128)', value: 'CODE128', short: 'CODE128' },
  { label: 'バーコード (EAN-13 / JAN)', value: 'EAN13', short: 'EAN-13' },
  { label: 'バーコード (CODE39)', value: 'CODE39', short: 'CODE39' },
  { label: 'バーコード (NW-7 / CODABAR)', value: 'NW7', short: 'NW-7' },
  { label: 'バーコード (ITF)', value: 'ITF', short: 'ITF' },
  { label: 'QRコード', value: 'QR', short: 'QRコード' },
];

// 在庫で使う単位
const STOCK_UNITS = ['個', '本', '袋', '箱', '巻', '枚', 'g', 'ml', '回分'];

// 消費ペースの入力単位（1日あたりへ換算するための係数）
const PACE_PERIODS = [
  { label: '1日で', value: 'day', perDayFactor: 1 },
  { label: '1週間で', value: 'week', perDayFactor: 1 / 7 },
  { label: '1か月で', value: 'month', perDayFactor: 1 / 30 },
];

// よく使う物のひな型。名前をタップするだけで単位とペースが埋まる
const STOCK_PRESETS = [
  { name: '犬のごはん', unit: 'g', qty: 3000, pace: 200, period: 'day' },
  { name: 'コーヒー豆', unit: 'g', qty: 500, pace: 20, period: 'day' },
  { name: 'トイレットペーパー', unit: '巻', qty: 12, pace: 1, period: 'day' },
  { name: 'ティッシュ', unit: '箱', qty: 5, pace: 1, period: 'week' },
  { name: '洗濯洗剤', unit: 'ml', qty: 1500, pace: 40, period: 'day' },
  { name: '食器用洗剤', unit: 'ml', qty: 600, pace: 15, period: 'day' },
  { name: 'シャンプー', unit: 'ml', qty: 500, pace: 12, period: 'day' },
  { name: '米', unit: 'g', qty: 5000, pace: 300, period: 'day' },
  { name: '牛乳', unit: '本', qty: 2, pace: 1, period: 'week' },
  { name: 'ゴミ袋', unit: '枚', qty: 30, pace: 1, period: 'day' },
  { name: '猫砂', unit: 'g', qty: 5000, pace: 200, period: 'day' },
  { name: '乾電池', unit: '本', qty: 8, pace: 1, period: 'month' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// 「今」の推定残量。qty を確定した時刻からの経過分を引く。
// 画面表示は毎回この計算で出し、Firestore には書き込まない。
function effectiveQty(s: Stock): number {
  if (!s.perDay || s.perDay <= 0) return s.qty;
  const base = s.lastCalcAt || s.createdAt || Date.now();
  const days = Math.max(0, (Date.now() - base) / DAY_MS);
  return Math.max(0, s.qty - s.perDay * days);
}

// 残り日数（自動で減らさない物は null）
function daysLeft(s: Stock): number | null {
  if (!s.perDay || s.perDay <= 0) return null;
  return effectiveQty(s) / s.perDay;
}

// 「そろそろ買う」の判定
function isLow(s: Stock): boolean {
  const d = daysLeft(s);
  if (d === null) return effectiveQty(s) <= (s.alertQty ?? 1);
  return d <= (s.alertDays ?? 5);
}

// 端数が出るので、整数はそのまま・小数は1桁で表示する
function fmtQty(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function fmtDays(d: number): string {
  if (d < 1) return 'あと1日以内';
  return `あと約${Math.floor(d)}日`;
}

// ---------------------------------------------------------------------------
// 写真の圧縮
//   Firestore の1ドキュメント上限（1MiB）に収めるため、
//   長辺1000pxに縮小し、収まるまで画質を落とす。
//   保存されるのは data URL の文字列そのものなので、
//   文字数（＝おおよそのバイト数）で判定する。
// ---------------------------------------------------------------------------
const PHOTO_MAX_CHARS = 700 * 1024;

async function compressImage(file: File): Promise<string> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('写真を読み込めませんでした'));
    reader.readAsDataURL(file);
  });

  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('写真を表示できませんでした'));
    im.src = dataUrl;
  });

  const maxSide = 1000;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('写真を変換できませんでした');
  ctx.drawImage(img, 0, 0, w, h);

  for (const q of [0.7, 0.6, 0.5, 0.4, 0.3]) {
    const out = canvas.toDataURL('image/jpeg', q);
    if (out.length <= PHOTO_MAX_CHARS) return out;
  }
  const last = canvas.toDataURL('image/jpeg', 0.25);
  if (last.length > PHOTO_MAX_CHARS) {
    throw new Error('この写真は大きすぎて保存できません。もう一度撮り直してください');
  }
  return last;
}

const PRESET_SHOPS = [
  { name: 'キラヤ', logoUrl: 'https://www.google.com/s2/favicons?domain=kiraya-iida.com&sz=64' },
  { name: 'カインズ', logoUrl: 'https://www.google.com/s2/favicons?domain=cainz.com&sz=64' },
  { name: 'ニトリ', logoUrl: 'https://www.google.com/s2/favicons?domain=nitori-net.jp&sz=64' },
  { name: '楽天', logoUrl: 'https://www.google.com/s2/favicons?domain=rakuten.co.jp&sz=64' },
  { name: 'Tポイント', logoUrl: 'https://www.google.com/s2/favicons?domain=tsite.jp&sz=64' },
  { name: 'シャトレーゼ', logoUrl: 'https://www.google.com/s2/favicons?domain=chateraise.co.jp&sz=64' },
];

// ---------------------------------------------------------------------------
// バーコード生成
//
// 自前のCODE128/EAN-13描画にはチェックディジット誤り・パターン表不足・
// EAN-13の白黒反転・クワイエットゾーン0などの不具合があり、レジで読めなかった。
// 実績のある bwip-js に一本化している。詳細は _backup/ の旧実装を参照。
// ---------------------------------------------------------------------------

const BCID: Record<string, string> = {
  CODE128: 'code128',
  EAN13: 'ean13',
  CODE39: 'code39',
  NW7: 'rationalizedCodabar',
  ITF: 'interleaved2of5',
  QR: 'qrcode',
};

// EAN-13 のチェックディジット（先頭12桁から算出）
function ean13CheckDigit(digits12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits12[i], 10) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

function prepareText(codeType: string, raw: string): string {
  const v = raw.trim();
  switch (codeType) {
    case 'EAN13':
    case 'ITF':
      return v.replace(/[^0-9]/g, '');
    case 'CODE39':
      return v.toUpperCase().replace(/[^0-9A-Z\-. $\/+%]/g, '');
    case 'NW7': {
      const body = v.toUpperCase().replace(/[^0-9\-$:\/.+ABCD]/g, '');
      const hasStart = /^[ABCD]/.test(body);
      const hasStop = /[ABCD]$/.test(body);
      return `${hasStart ? '' : 'A'}${body}${hasStop ? '' : 'A'}`;
    }
    default:
      return v;
  }
}

// 登録時のチェック。問題なければ空文字を返す
function validateCode(codeType: string, raw: string): string {
  const v = raw.trim();
  if (!v) return '番号を入力してください';

  if (codeType === 'EAN13') {
    const d = v.replace(/[^0-9]/g, '');
    if (d.length !== 12 && d.length !== 13) {
      return `EAN-13（JAN）は12桁または13桁の数字です（現在 ${d.length} 桁）`;
    }
    if (d.length === 13) {
      const cd = ean13CheckDigit(d.slice(0, 12));
      if (d[12] !== cd) {
        return `チェックディジットが一致しません（正しくは末尾 ${cd}）。カード裏面の番号を確認してください`;
      }
    }
    return '';
  }
  if (codeType === 'ITF') {
    const d = v.replace(/[^0-9]/g, '');
    if (!d) return 'ITFは数字のみです';
    if (d.length % 2 !== 0) return `ITFは桁数が偶数である必要があります（現在 ${d.length} 桁）`;
    return '';
  }
  if (codeType === 'CODE39') {
    if (/[^0-9A-Za-z\-. $\/+%]/.test(v)) {
      return 'CODE39で使えるのは 0-9 / A-Z / - . $ / + % / 半角スペース のみです';
    }
    return '';
  }
  if (codeType === 'NW7') {
    if (/[^0-9\-$:\/.+ABCDabcd]/.test(v)) {
      return 'NW-7（CODABAR）で使えるのは 0-9 / - $ : / . + と開始終了記号 A-D のみです';
    }
    return '';
  }
  if (codeType === 'CODE128') {
    if (/[^\x20-\x7E]/.test(v)) {
      return 'CODE128には半角の英数字・記号のみ使用できます（全角文字は不可）';
    }
    return '';
  }
  return '';
}

type CodeImage = { url: string; width: number; height: number };

// 画面幅に収まる「整数倍」スケールで描画する。
// 小数スケールだとバーの境界がアンチエイリアスでぼやけ、
// レジのレーザー／CCDスキャナが細バーを取りこぼす原因になる。
function renderCode(codeType: string, rawValue: string, maxWidthPx: number): CodeImage {
  const bwip: any = (bwipjs as any)?.toCanvas ? bwipjs : (bwipjs as any)?.default;
  if (!bwip || typeof bwip.toCanvas !== 'function') {
    throw new Error('バーコード描画ライブラリを読み込めませんでした');
  }

  const isQR = codeType === 'QR';
  const base: any = {
    bcid: BCID[codeType] || 'code128',
    text: prepareText(codeType, rawValue),
    includetext: !isQR,
    textsize: 10,
    // クワイエットゾーン（規格上必須の余白）
    paddingwidth: isQR ? 4 : 12,
    paddingheight: isQR ? 4 : 3,
    backgroundcolor: 'FFFFFF',
    barcolor: '000000',
  };
  if (!isQR) base.height = 13;   // mm

  const probe = document.createElement('canvas');
  bwip.toCanvas(probe, { ...base, scale: 1 });
  const unitWidth = probe.width || 1;
  const scale = Math.max(2, Math.min(10, Math.floor(maxWidthPx / unitWidth) || 2));

  const canvas = document.createElement('canvas');
  bwip.toCanvas(canvas, { ...base, scale });
  return { url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

// コードの表示幅。QRは正方形で縦を食うので小さめに抑える
function availableCodeWidth(codeType: string): number {
  const w = typeof window !== 'undefined' ? Dimensions.get('window').width : 400;
  const usable = Math.max(230, Math.min(w, 620) - 80);
  return codeType === 'QR' ? Math.min(usable, 170) : Math.min(usable, 300);
}

// ===========================================================================
// 触覚フィードバック（振動）
//   ネイティブ: expo-haptics
//   Web:        Vibration API（Android Chrome等。iOS Safariは非対応）
// ===========================================================================
function vibrateWeb(ms: number) {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (nav && typeof nav.vibrate === 'function') {
    try { nav.vibrate(ms); } catch { /* 無視 */ }
  }
}

// ダイヤルが1段送られた時の「カチッ」
function hapticTick() {
  if (Platform.OS === 'web') { vibrateWeb(10); return; }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// 選択が確定した時
function hapticSelect() {
  if (Platform.OS === 'web') { vibrateWeb(18); return; }
  Haptics.selectionAsync().catch(() => {});
}

// 完了・保存など
function hapticSuccess() {
  if (Platform.OS === 'web') { vibrateWeb(28); return; }
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

// Web では Alert.alert が動かないので window.alert にフォールバックする
function notify(message: string) {
  if (typeof window !== 'undefined' && typeof window.alert === 'function') {
    window.alert(message);
  } else {
    Alert.alert(message);
  }
}

// ===========================================================================
// アーチダイヤルの形
//   中心は画面の左外にあり、右へ膨らむ円弧の上にカードが並ぶ
// ===========================================================================
const DIAL = {
  cx: -150,          // 円の中心X（画面左外）
  r: 320,            // 半径
  maxAngle: 34,      // 間隔の上限（これ以上は広げない）
  minAngle: 20,      // 間隔の下限（これ以下には詰めない）
  fitSlots: 0.75,    // 「1.5枚ぶん（=2で割った0.75）が収まれば良い」として角度を決める
  box: 64,           // 丸を入れる正方形（位置合わせの基準）
  span: 3,           // 中央から何枚ぶん描くか（±3枚）
  steps: 24,         // 補間の刻み数（多いほど円弧が正確）
};

// カード同士の間隔を決める角度を求める。
// 「上下2枚目まで」ではなく「1.5枚ぶんが収まれば良い」として計算することで、
// 画面が狭くても間隔を広く取れる（はみ出した端のカードは薄く消える）。
function dialMaxAngle(halfHeight: number): number {
  const usable = Math.max(56, halfHeight - DIAL.box / 2 - 6);
  const ratio = Math.min(0.94, usable / DIAL.r);
  const fitted = ((Math.asin(Math.max(0.14, ratio)) * 180) / Math.PI) / DIAL.fitSlots;
  return Math.min(DIAL.maxAngle, Math.max(DIAL.minAngle, fitted));
}

// 円弧に沿った隣り合うカードの間隔（px）。指の移動量とこれを1:1で対応させる
function dialStepPx(maxAngleDeg: number): number {
  return Math.max(40, DIAL.r * ((maxAngleDeg / 2) * Math.PI) / 180);
}

type SlotTrack = { input: number[]; x: number[]; y: number[]; opacity: number[] };

// カードi用の補間テーブルを作る。
// pos（小数のインデックス）を入れると、円弧上の座標と透明度が返るようにする。
function buildTrack(i: number, cy: number, maxAngleDeg: number): SlotTrack {
  const input: number[] = [], x: number[] = [], y: number[] = [], opacity: number[] = [];
  for (let n = 0; n <= DIAL.steps; n++) {
    // s = 中央からの相対位置。+span 〜 -span（posの増加方向に対応）
    const s = DIAL.span - (2 * DIAL.span * n) / DIAL.steps;
    const rad = ((maxAngleDeg * (s / 2)) * Math.PI) / 180;
    input.push(i - s);
    x.push(DIAL.cx + DIAL.r * Math.cos(rad));
    y.push(cy + DIAL.r * Math.sin(rad));
    const a = Math.abs(s);
    opacity.push(a <= 1 ? 1 : a <= 2 ? 1 - (a - 1) * 0.72 : a <= 2.5 ? 0.28 * (1 - (a - 2) / 0.5) : 0);
  }
  return { input, x, y, opacity };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function HomeScreen() {
  const [familyCode, setFamilyCode] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState('');
  const [activeTab, setActiveTab] = useState<'list' | 'stock' | 'cards'>('list');

  // ---- 在庫 ----
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [tick, setTick] = useState(0);          // 残量の表示を定期的に更新するため
  const [showStockForm, setShowStockForm] = useState(false);
  const [editStock, setEditStock] = useState<Stock | null>(null);
  const [sName, setSName] = useState('');
  const [sUnit, setSUnit] = useState('個');
  const [sQty, setSQty] = useState('');
  const [sPace, setSPace] = useState('');
  const [sPeriod, setSPeriod] = useState('day');
  const [sAlertDays, setSAlertDays] = useState('5');
  const [sAlertQty, setSAlertQty] = useState('1');
  const [sAutoAdd, setSAutoAdd] = useState(true);
  const [stockMenu, setStockMenu] = useState<Stock | null>(null);

  // ---- まとめ補充（買ってきた物を1枚の写真＋数量で登録） ----
  const [showRestock, setShowRestock] = useState(false);
  const [rPhoto, setRPhoto] = useState<string | null>(null);
  const [rMemo, setRMemo] = useState('');
  const [rLines, setRLines] = useState<Record<string, number>>({});
  const [rBusy, setRBusy] = useState(false);
  const [photoView, setPhotoView] = useState<string | null>(null);
  const photoInput = useRef<any>(null);
  const autoAdded = useRef<Set<string>>(new Set());
  const [showAddCard, setShowAddCard] = useState(false);
  const [shopName, setShopName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [selectedCodeType, setSelectedCodeType] = useState('CODE128');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [menuCard, setMenuCard] = useState<Card | null>(null);
  const [barcode, setBarcode] = useState<CodeImage | null>(null);
  const [barcodeError, setBarcodeError] = useState('');
  const [previewImg, setPreviewImg] = useState<CodeImage | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [tabBarWidth, setTabBarWidth] = useState(0);
  const [arcHeight, setArcHeight] = useState(0);
  const notifiedShops = useRef<Set<string>>(new Set());

  const indicatorAnim = useRef(new Animated.Value(0)).current;
  const contentAnim = useRef(new Animated.Value(1)).current;
  const useNative = Platform.OS !== 'web';

  const selectedCard = cards.length > 0 ? cards[Math.min(selectedIndex, cards.length - 1)] : null;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = getCookie('familyCode') || localStorage.getItem('familyCode');
      if (saved) {
        setFamilyCode(saved);
        setCookie('familyCode', saved, 365);
      }
    }
  }, []);

  useEffect(() => {
    if (!familyCode) return;
    const q = query(
      collection(db, 'items'),
      where('familyCode', '==', familyCode),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, snapshot => {
      setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Item)));
    });
    return unsub;
  }, [familyCode]);

  useEffect(() => {
    if (!familyCode) return;
    const q = query(
      collection(db, 'cards'),
      where('familyCode', '==', familyCode),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(q, snapshot => {
      const rawCards = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Card));
      const sorted = [...rawCards].sort((a, b) => {
        const orderA = a.order !== undefined ? a.order : (a.createdAt ?? 0);
        const orderB = b.order !== undefined ? b.order : (b.createdAt ?? 0);
        return orderA - orderB;
      });
      setCards(sorted);
      setSelectedIndex(i => (sorted.length === 0 ? 0 : Math.min(i, sorted.length - 1)));
    });
    return unsub;
  }, [familyCode]);

  // 在庫。where だけで取り、並び替えは手元でやる（複合インデックス不要）
  useEffect(() => {
    if (!familyCode) return;
    const q = query(collection(db, 'stocks'), where('familyCode', '==', familyCode));
    const unsub = onSnapshot(q, snapshot => {
      const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Stock));
      rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      setStocks(rows);
    }, () => { /* 権限エラー等は無視（在庫タブが空で表示される） */ });
    return unsub;
  }, [familyCode]);

  // 補充の記録（写真つき）。表示は直近12件だけ
  useEffect(() => {
    if (!familyCode) return;
    const q = query(collection(db, 'restocks'), where('familyCode', '==', familyCode));
    const unsub = onSnapshot(q, snapshot => {
      const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Restock));
      rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setRestocks(rows.slice(0, 12));
    }, () => { /* 同上 */ });
    return unsub;
  }, [familyCode]);

  // 残量は時間で減るので、表示を10分ごとに描き直す
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // 少なくなった物を買い物リストへ自動で入れる。
  // 二重登録を防ぐため、stocks 側の notifiedAt と同名の未チェック項目を見る。
  useEffect(() => {
    if (!familyCode || stocks.length === 0) return;
    stocks.forEach(async s => {
      if (!s.autoAdd) return;
      if (!isLow(s)) return;
      if (s.notifiedAt) return;
      if (autoAdded.current.has(s.id)) return;
      if (items.some(i => !i.done && i.name === s.name)) return;
      autoAdded.current.add(s.id);
      try {
        await addDoc(collection(db, 'items'), {
          name: s.name, done: false, createdAt: Date.now(), familyCode,
        });
        await updateDoc(doc(db, 'stocks', s.id), { notifiedAt: Date.now() });
      } catch {
        autoAdded.current.delete(s.id);
      }
    });
  }, [stocks, items, familyCode, tick]);

  useEffect(() => { setupLocationAndNotifications(); }, []);

  const TABS: { key: 'list' | 'stock' | 'cards'; label: string }[] = [
    { key: 'list', label: '買い物' },
    { key: 'stock', label: '在庫' },
    { key: 'cards', label: 'カード' },
  ];
  const tabIndex = TABS.findIndex(t => t.key === activeTab);

  useEffect(() => {
    Animated.timing(indicatorAnim, {
      toValue: Math.max(0, tabIndex),
      duration: 300,
      useNativeDriver: useNative,
    }).start();
    contentAnim.setValue(0);
    Animated.timing(contentAnim, { toValue: 1, duration: 300, useNativeDriver: useNative }).start();
  }, [activeTab]);

  // 選択中カードのコードを描画
  useEffect(() => {
    if (!selectedCard) {
      setBarcode(null);
      setBarcodeError('');
      return;
    }
    if (typeof document === 'undefined') return;
    // ダイヤルを速く回した時に何枚も描画しないよう、少しだけ待ってから生成する
    const card = selectedCard;
    const timer = setTimeout(() => {
      try {
        setBarcode(renderCode(card.codeType, card.cardNumber, availableCodeWidth(card.codeType)));
        setBarcodeError('');
      } catch (e: any) {
        setBarcode(null);
        const v = validateCode(card.codeType, card.cardNumber);
        setBarcodeError(v || `コードを生成できませんでした：${e?.message ?? e}`);
      }
    }, 90);
    return () => clearTimeout(timer);
  }, [selectedCard?.id, selectedCard?.cardNumber, selectedCard?.codeType]);

  // カード登録画面のプレビュー
  useEffect(() => {
    if (!showAddCard || typeof document === 'undefined' || !cardNumber.trim()) {
      setPreviewImg(null);
      setPreviewError('');
      return;
    }
    const v = validateCode(selectedCodeType, cardNumber);
    if (v) {
      setPreviewImg(null);
      setPreviewError(v);
      return;
    }
    try {
      setPreviewImg(renderCode(selectedCodeType, cardNumber, availableCodeWidth(selectedCodeType)));
      setPreviewError('');
    } catch (e: any) {
      setPreviewImg(null);
      setPreviewError(`このコード種別では生成できません：${e?.message ?? e}`);
    }
  }, [showAddCard, cardNumber, selectedCodeType]);

  // ダイヤルの回転（上下ドラッグで1枚ずつ送る）
  // ---- ダイヤルの回転 ----------------------------------------------------
  // pos は「小数のインデックス」。指の動きに1:1で追従させ、離した時に
  // 一番近いカードへバネでスナップする。段が変わるたびに振動する。
  const pos = useRef(new Animated.Value(0)).current;
  const posRef = useRef(0);
  const dragStart = useRef(0);
  const lastTick = useRef(0);

  useEffect(() => {
    const id = pos.addListener(({ value }) => { posRef.current = value; });
    return () => pos.removeListener(id);
  }, []);

  const cyForDial = arcHeight > 0 ? arcHeight / 2 : 190;
  const maxAngle = dialMaxAngle(cyForDial);
  const stepPx = dialStepPx(maxAngle);

  // 円弧上の座標テーブル（カード枚数・画面高さが変わった時だけ作り直す）
  const tracks = useMemo(
    () => cards.map((_, i) => buildTrack(i, cyForDial, maxAngle)),
    [cards.length, cyForDial, maxAngle]
  );

  // 指定のカードへバネで寄せる
  const springTo = (index: number) => {
    const target = clamp(index, 0, Math.max(cards.length - 1, 0));
    lastTick.current = target;
    setSelectedIndex(target);
    Animated.spring(pos, {
      toValue: target,
      useNativeDriver: useNative,
      speed: 16,
      bounciness: 5,
    }).start();
  };

  // カードが増減・並び替えされた時に位置を合わせ直す
  useEffect(() => {
    if (cards.length === 0) return;
    const target = clamp(selectedIndex, 0, cards.length - 1);
    lastTick.current = target;
    pos.setValue(target);
  }, [cards.length]);

  // ---- 指の操作 ----------------------------------------------------------
  // Web（iPhoneのSafari含む）では PanResponder ではなく Pointer Events を直接使う。
  // 理由: 縦方向のスワイプをブラウザが「画面の引っぱり／スクロール」と解釈すると
  //       途中でタッチがキャンセルされ、ダイヤルが戻ってしまう。
  //       touchAction:'none' ＋ setPointerCapture で確実に自分が握る。
  const arcEl = useRef<any>(null);   // Webでは <div> のDOMノードが入る
  const drag = useRef({ active: false, startY: 0, startPos: 0, lastY: 0, lastT: 0, vel: 0, id: -1 });

  const beginDrag = (y: number) => {
    const d = drag.current;
    d.active = true;
    d.startY = y;
    d.lastY = y;
    d.lastT = Date.now();
    d.vel = 0;
    d.startPos = posRef.current;
    pos.stopAnimation();
  };

  const moveDrag = (y: number) => {
    const d = drag.current;
    if (!d.active || cards.length === 0) return;
    const now = Date.now();
    const dt = Math.max(1, now - d.lastT);
    d.vel = (y - d.lastY) / dt;      // px/ms
    d.lastY = y;
    d.lastT = now;
    // 上へ動かす（yが減る）と次のカードへ。指の移動量と円弧の間隔は1:1
    const next = clamp(d.startPos - (y - d.startY) / stepPx, -0.6, cards.length - 0.4);
    pos.setValue(next);
    const rounded = clamp(Math.round(next), 0, cards.length - 1);
    if (rounded !== lastTick.current) {
      lastTick.current = rounded;
      setSelectedIndex(rounded);
      hapticTick();
    }
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d.active) return;
    d.active = false;
    if (cards.length === 0) return;
    // 離した勢い（フリック）を距離に換算して足す。飛びすぎないよう±1.5枚に制限
    const fling = clamp(d.vel * 100, -stepPx * 1.5, stepPx * 1.5);
    const raw = d.startPos - ((d.lastY - d.startY) + fling) / stepPx;
    springTo(clamp(Math.round(raw), 0, cards.length - 1));
    hapticSelect();
  };

  // Web: 円弧の領域に直接イベントを張る
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = arcEl.current as any;
    if (!el || typeof el.addEventListener !== 'function') return;

    const THRESHOLD = 6;   // これ以上動いたら「回す操作」と判断（それ未満はタップ扱い）
    let downY: number | null = null;
    let pointerId = -1;

    const onDown = (e: any) => {
      downY = e.clientY;
      pointerId = e.pointerId;
    };
    const onMove = (e: any) => {
      if (downY === null) return;
      if (!drag.current.active) {
        if (Math.abs(e.clientY - downY) < THRESHOLD) return;
        // ここで初めて主導権を取る。以降タップ判定は発生しない
        try { el.setPointerCapture(pointerId); } catch { /* 無視 */ }
        beginDrag(downY);
      }
      moveDrag(e.clientY);
    };
    const onUp = () => {
      if (drag.current.active) endDrag();
      downY = null;
      try { el.releasePointerCapture(pointerId); } catch { /* 無視 */ }
      pointerId = -1;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onUp);
    };
    // タブを切り替えると円弧のDOMが作り直されるので activeTab も監視する
  }, [cards.length, stepPx, activeTab]);

  // ネイティブアプリ（iOS/Android）用。Webでは使わない
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) =>
      Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (_e, g) => beginDrag(g.y0),
    onPanResponderMove: (_e, g) => moveDrag(g.y0 + g.dy),
    onPanResponderRelease: () => endDrag(),
    onPanResponderTerminate: () => endDrag(),
  }), [cards.length, stepPx]);

  const setupLocationAndNotifications = async () => {
    const { status: notifStatus } = await Notifications.requestPermissionsAsync();
    if (notifStatus !== 'granted') return;
    const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
    if (locStatus !== 'granted') return;
    await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 50 },
      (loc) => { checkNearbyShops(loc); }
    );
  };

  const checkNearbyShops = (loc: Location.LocationObject) => {
    if (items.length === 0) return;
    SHOPS.forEach(shop => {
      if (shop.latitude === 0) return;
      const dist = getDistance(loc.coords.latitude, loc.coords.longitude, shop.latitude, shop.longitude);
      if (dist < NOTIFY_RADIUS && !notifiedShops.current.has(shop.id)) {
        notifiedShops.current.add(shop.id);
        Notifications.scheduleNotificationAsync({
          content: { title: `${shop.name}に到着しました`, body: '買い物リストを確認してください' },
          trigger: null,
        });
      }
    });
  };

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  const enterCode = () => {
    if (!inputCode.trim()) return;
    const code = inputCode.trim().toLowerCase();
    setCookie('familyCode', code, 365);
    if (typeof window !== 'undefined') localStorage.setItem('familyCode', code);
    setFamilyCode(code);
  };

  const addItem = async () => {
    if (!text.trim() || !familyCode) return;
    hapticSuccess();
    await addDoc(collection(db, 'items'), {
      name: text.trim(), done: false, createdAt: Date.now(), familyCode
    });
    setText('');
  };

  const toggleItem = async (id: string, done: boolean) => {
    hapticTick();
    await updateDoc(doc(db, 'items', id), { done: !done });
  };

  const deleteItem = async (id: string) => {
    await deleteDoc(doc(db, 'items', id));
  };

  const selectPresetShop = (preset: { name: string; logoUrl: string }) => {
    setShopName(preset.name);
    setLogoUrl(preset.logoUrl);
  };

  const addCard = async () => {
    if (!shopName.trim() || !cardNumber.trim() || !familyCode) {
      notify('お店の名前とカード番号を入力してください');
      return;
    }
    const invalid = validateCode(selectedCodeType, cardNumber);
    if (invalid) {
      notify(invalid);
      return;
    }
    await addDoc(collection(db, 'cards'), {
      shopName: shopName.trim(),
      cardNumber: cardNumber.trim(),
      logoUrl: logoUrl.trim(),
      color: selectedColor,
      codeType: selectedCodeType,
      familyCode,
      order: cards.length,
      createdAt: Date.now()
    });
    setShopName('');
    setCardNumber('');
    setLogoUrl('');
    setSelectedColor(COLORS[0]);
    setSelectedCodeType('CODE128');
    setShowAddCard(false);
    hapticSuccess();
  };

  const deleteCard = async (id: string) => {
    setMenuCard(null);
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm('本当に削除しますか？')) await deleteDoc(doc(db, 'cards', id));
    } else {
      Alert.alert('カードを削除', '本当に削除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: async () => await deleteDoc(doc(db, 'cards', id)) },
      ]);
    }
  };

  const moveCard = async (id: string, direction: 'up' | 'down') => {
    const index = cards.findIndex(c => c.id === id);
    if (index < 0) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === cards.length - 1) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    const currentOrder = cards[index].order ?? index;
    const swapOrder = cards[swapIndex].order ?? swapIndex;
    await updateDoc(doc(db, 'cards', id), { order: swapOrder });
    await updateDoc(doc(db, 'cards', cards[swapIndex].id), { order: currentOrder });
    setSelectedIndex(swapIndex);
  };

  const allowsLetters = selectedCodeType === 'CODE128' || selectedCodeType === 'CODE39' || selectedCodeType === 'NW7';

  const contentStyle = {
    opacity: contentAnim,
    transform: [{ translateY: contentAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  const codeTypeShort = (v: string) => CODE_TYPES.find(c => c.value === v)?.short || 'バーコード';

  // ---------- 在庫の操作 ----------
  const lowStocks = useMemo(
    () => stocks.filter(isLow),
    [stocks, tick]
  );

  const stockBadge = (key: string) => {
    if (key === 'list') return items.filter(i => !i.done).length;
    if (key === 'stock') return lowStocks.length;
    return cards.length;
  };

  const openStockForm = (s: Stock | null) => {
    setEditStock(s);
    if (s) {
      setSName(s.name);
      setSUnit(s.unit || '個');
      setSQty(fmtQty(effectiveQty(s)));
      // 1日あたりの値を、入れやすい期間に戻して表示する
      if (!s.perDay) {
        setSPace('');
        setSPeriod('day');
      } else if (s.perDay >= 1) {
        setSPace(fmtQty(s.perDay));
        setSPeriod('day');
      } else if (s.perDay * 7 >= 1) {
        setSPace(fmtQty(s.perDay * 7));
        setSPeriod('week');
      } else {
        setSPace(fmtQty(s.perDay * 30));
        setSPeriod('month');
      }
      setSAlertDays(String(s.alertDays ?? 5));
      setSAlertQty(String(s.alertQty ?? 1));
      setSAutoAdd(s.autoAdd !== false);
    } else {
      setSName('');
      setSUnit('個');
      setSQty('');
      setSPace('');
      setSPeriod('day');
      setSAlertDays('5');
      setSAlertQty('1');
      setSAutoAdd(true);
    }
    setShowStockForm(true);
  };

  const applyStockPreset = (p: typeof STOCK_PRESETS[number]) => {
    setSName(p.name);
    setSUnit(p.unit);
    setSQty(String(p.qty));
    setSPace(String(p.pace));
    setSPeriod(p.period);
    hapticSelect();
  };

  const saveStock = async () => {
    if (!familyCode) return;
    const name = sName.trim();
    if (!name) { notify('品名を入力してください'); return; }
    const qty = parseFloat(sQty);
    if (!isFinite(qty) || qty < 0) { notify('今ある数量を入力してください'); return; }

    const paceVal = parseFloat(sPace);
    const factor = PACE_PERIODS.find(p => p.value === sPeriod)?.perDayFactor ?? 1;
    const perDay = isFinite(paceVal) && paceVal > 0 ? paceVal * factor : 0;

    const alertDays = Math.max(0, parseFloat(sAlertDays) || 0);
    const alertQty = Math.max(0, parseFloat(sAlertQty) || 0);

    const payload = {
      name, unit: sUnit, qty, perDay, alertDays, alertQty,
      autoAdd: sAutoAdd, lastCalcAt: Date.now(), notifiedAt: null, familyCode,
    };

    if (editStock) {
      await updateDoc(doc(db, 'stocks', editStock.id), payload);
    } else {
      await addDoc(collection(db, 'stocks'), { ...payload, createdAt: Date.now() });
    }
    setShowStockForm(false);
    setEditStock(null);
    hapticSuccess();
  };

  const deleteStock = async (id: string) => {
    setStockMenu(null);
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm('この在庫を削除しますか？')
      : true;
    if (ok) await deleteDoc(doc(db, 'stocks', id));
  };

  // 「使った」「買った」をその場で1つずつ動かす
  const bumpStock = async (s: Stock, delta: number) => {
    const now = effectiveQty(s);
    const next = Math.max(0, now + delta);
    hapticTick();
    await updateDoc(doc(db, 'stocks', s.id), {
      qty: next,
      lastCalcAt: Date.now(),
      // 補充して余裕ができたら、次にまた知らせられるようにする
      notifiedAt: next > now ? null : (s.notifiedAt ?? null),
    });
    if (next > now) autoAdded.current.delete(s.id);
  };

  // ---------- まとめ補充 ----------
  const openRestock = () => {
    setRPhoto(null);
    setRMemo('');
    setRLines({});
    setShowRestock(true);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setRBusy(true);
    try {
      setRPhoto(await compressImage(file));
    } catch (e: any) {
      notify(e?.message || '写真を読み込めませんでした');
    } finally {
      setRBusy(false);
    }
  };

  const setLine = (id: string, v: number) => {
    setRLines(prev => {
      const next = { ...prev };
      if (v <= 0) delete next[id];
      else next[id] = v;
      return next;
    });
  };

  const saveRestock = async () => {
    if (!familyCode) return;
    const ids = Object.keys(rLines);
    if (ids.length === 0 && !rPhoto) {
      notify('買った物の数量を入れるか、写真を選んでください');
      return;
    }
    setRBusy(true);
    try {
      const lines: Restock['lines'] = [];
      for (const id of ids) {
        const s = stocks.find(x => x.id === id);
        if (!s) continue;
        const add = rLines[id];
        const next = Math.max(0, effectiveQty(s) + add);
        await updateDoc(doc(db, 'stocks', id), {
          qty: next, lastCalcAt: Date.now(), notifiedAt: null,
        });
        autoAdded.current.delete(id);
        lines.push({ name: s.name, qty: add, unit: s.unit });
      }
      await addDoc(collection(db, 'restocks'), {
        familyCode,
        photo: rPhoto ?? null,
        memo: rMemo.trim(),
        lines,
        createdAt: Date.now(),
      });
      setShowRestock(false);
      hapticSuccess();
    } catch (e: any) {
      notify(`保存できませんでした：${e?.message ?? e}`);
    } finally {
      setRBusy(false);
    }
  };

  // 「そろそろ買う物」を買い物リストへ手で入れる
  const addLowToList = async (s: Stock) => {
    if (!familyCode) return;
    if (items.some(i => !i.done && i.name === s.name)) { notify('すでに買い物リストにあります'); return; }
    hapticSuccess();
    await addDoc(collection(db, 'items'), {
      name: s.name, done: false, createdAt: Date.now(), familyCode,
    });
    await updateDoc(doc(db, 'stocks', s.id), { notifiedAt: Date.now() });
  };

  // ---------- ログイン ----------
  if (!familyCode) {
    return (
      <KeyboardAvoidingView style={styles.loginContainer} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Text style={styles.loginTitle}>買い物リスト</Text>
        <Text style={styles.loginSubtitle}>家族コードを入力してください</Text>
        <TextInput
          style={styles.loginInput}
          value={inputCode}
          onChangeText={setInputCode}
          placeholder="例：yamada2026"
          placeholderTextColor={C.txFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.loginBtn} onPress={enterCode}>
          <Text style={styles.loginBtnText}>はじめる</Text>
        </TouchableOpacity>
        <Text style={styles.loginHint}>※ 家族全員が同じコードを使うと、リストが共有されます</Text>
      </KeyboardAvoidingView>
    );
  }

  // ---------- アーチダイヤル ----------
  const renderDial = () => {
    if (cards.length === 0) {
      return (
        <View style={styles.arc} onLayout={e => setArcHeight(e.nativeEvent.layout.height)}>
          <Text style={styles.empty}>カードが登録されていません</Text>
        </View>
      );
    }
    const railLeft = DIAL.cx - DIAL.r;
    const railTop = cyForDial - DIAL.r;

    return (
      <View
        ref={arcEl}
        style={[
          styles.arc,
          // Web専用: touchAction を切って、ブラウザに縦スワイプを取られないようにする
          Platform.OS === 'web' ? ({ touchAction: 'none', userSelect: 'none' } as any) : null,
        ]}
        onLayout={e => setArcHeight(e.nativeEvent.layout.height)}
        {...(Platform.OS === 'web' ? {} : panResponder.panHandlers)}
      >
        {/* 円弧のレール */}
        <View pointerEvents="none" style={[styles.rail, {
          left: railLeft, top: railTop, width: DIAL.r * 2, height: DIAL.r * 2, borderRadius: DIAL.r,
        }]} />
        <View pointerEvents="none" style={[styles.rail2, {
          left: railLeft + 26, top: railTop + 26,
          width: (DIAL.r - 26) * 2, height: (DIAL.r - 26) * 2, borderRadius: DIAL.r - 26,
        }]} />

        {cards.map((card, i) => {
          const track = tracks[i];
          if (!track) return null;
          const isSel = i === selectedIndex;
          const translateX = pos.interpolate({
            inputRange: track.input, outputRange: track.x, extrapolate: 'clamp',
          });
          const translateY = pos.interpolate({
            inputRange: track.input, outputRange: track.y, extrapolate: 'clamp',
          });
          const opacity = pos.interpolate({
            inputRange: track.input, outputRange: track.opacity, extrapolate: 'clamp',
          });
          return (
            <Animated.View
              key={card.id}
              style={[styles.slot, { opacity, transform: [{ translateX }, { translateY }] }]}
            >
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => { hapticSelect(); springTo(i); }}
                onLongPress={() => { hapticSelect(); setMenuCard(card); }}
                style={styles.slotTouch}
              >
                <View style={styles.dotBox}>
                  <View style={[styles.dot, isSel && styles.dotSel]}>
                    {card.logoUrl ? (
                      // @ts-ignore
                      <img src={card.logoUrl} alt="" style={{
                        width: 32, height: 32, objectFit: 'contain', borderRadius: 7,
                      }} />
                    ) : (
                      <Text style={[styles.dotText, isSel && styles.dotTextSel]}>
                        {card.shopName[0]}
                      </Text>
                    )}
                  </View>
                </View>
                <View style={styles.slotLabel}>
                  <Text numberOfLines={1} style={[styles.slotName, isSel && styles.slotNameSel]}>
                    {card.shopName}
                  </Text>
                  <Text numberOfLines={1} style={[styles.slotSub, isSel && styles.slotSubSel]}>
                    {codeTypeShort(card.codeType)}
                  </Text>
                </View>
              </TouchableOpacity>
            </Animated.View>
          );
        })}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* ヘッダー */}
      <View style={styles.headerRow}>
        <Text style={styles.familyCodeLabel} numberOfLines={1}>コード：{familyCode}</Text>
        <TouchableOpacity onPress={() => {
          deleteCookie('familyCode');
          if (typeof window !== 'undefined') localStorage.removeItem('familyCode');
          setFamilyCode(null);
          setInputCode('');
          setActiveTab('list');
        }}>
          <Text style={styles.changeCode}>コード変更</Text>
        </TouchableOpacity>
      </View>

      {/* タブ（選択中＝グリーン） */}
      <View style={styles.tabBar} onLayout={e => setTabBarWidth(e.nativeEvent.layout.width)}>
        {tabBarWidth > 0 && (
          <Animated.View style={[styles.tabIndicator, {
            width: (tabBarWidth - 10) / TABS.length,
            transform: [{
              translateX: indicatorAnim.interpolate({
                inputRange: TABS.map((_, i) => i),
                outputRange: TABS.map((_, i) => (i * (tabBarWidth - 10)) / TABS.length),
              }),
            }],
          }]} />
        )}
        {TABS.map(t => {
          const on = activeTab === t.key;
          const n = stockBadge(t.key);
          return (
            <TouchableOpacity
              key={t.key}
              style={styles.tabBtn}
              onPress={() => { hapticSelect(); setActiveTab(t.key); }}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, on && styles.tabTextActive]}>{t.label}</Text>
              {n > 0 && (
                <View style={[styles.tabBadge, on && styles.tabBadgeActive]}>
                  <Text style={[styles.tabBadgeText, on && styles.tabBadgeTextActive]}>{n}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ===== タブ1：買い物リスト ===== */}
      {activeTab === 'list' && (
        <Animated.View style={[styles.tabPage, contentStyle]}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="アイテムを入力..."
              placeholderTextColor={C.txFaint}
              onSubmitEditing={addItem}
            />
            <TouchableOpacity style={styles.addFab} onPress={addItem} activeOpacity={0.85}>
              <Text style={styles.addFabText}>＋</Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={items}
            keyExtractor={i => i.id}
            style={styles.flex1}
            contentContainerStyle={{ paddingBottom: 24 }}
            renderItem={({ item }) => (
              <View style={styles.item}>
                <TouchableOpacity onPress={() => toggleItem(item.id, item.done)} style={styles.itemLeft}>
                  <View style={[styles.check, item.done && styles.checkDone]}>
                    {item.done && <Text style={styles.checkMark}>✓</Text>}
                  </View>
                  <Text style={[styles.itemText, item.done && styles.itemDone]}>{item.name}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteItem(item.id)}>
                  <Text style={styles.deleteBtn}>削除</Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.empty}>アイテムを追加してください</Text>}
          />
        </Animated.View>
      )}

      {/* ===== タブ2：在庫 ===== */}
      {activeTab === 'stock' && (
        <Animated.View style={[styles.tabPage, contentStyle]}>
          <ScrollView style={styles.flex1} contentContainerStyle={{ paddingBottom: 28 }}>
            {/* そろそろ買う物（アプリを開いた時のお知らせ） */}
            {lowStocks.length > 0 && (
              <View style={styles.alertBox}>
                <Text style={styles.alertTitle}>そろそろ買う物　{lowStocks.length}件</Text>
                {lowStocks.map(s => {
                  const d = daysLeft(s);
                  const inList = items.some(i => !i.done && i.name === s.name);
                  return (
                    <View key={s.id} style={styles.alertRow}>
                      <View style={styles.flex1}>
                        <Text style={styles.alertName}>{s.name}</Text>
                        <Text style={styles.alertSub}>
                          残り {fmtQty(effectiveQty(s))}{s.unit}
                          {d !== null ? `・${fmtDays(d)}` : ''}
                        </Text>
                      </View>
                      {inList ? (
                        <Text style={styles.alertDone}>リスト済</Text>
                      ) : (
                        <TouchableOpacity style={styles.alertBtn} onPress={() => addLowToList(s)} activeOpacity={0.85}>
                          <Text style={styles.alertBtnText}>リストへ</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* 操作 */}
            <View style={styles.stockActions}>
              <TouchableOpacity style={styles.restockBtn} onPress={openRestock} activeOpacity={0.85}>
                <Text style={styles.restockBtnText}>買ってきた物をまとめて登録</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.stockAddBtn} onPress={() => openStockForm(null)} activeOpacity={0.85}>
                <Text style={styles.stockAddBtnText}>＋ 品目</Text>
              </TouchableOpacity>
            </View>

            {/* 買い物の記録（1枚まとめ写真） */}
            {restocks.length > 0 && (
              <View style={styles.recordBox}>
                <Text style={styles.recordTitle}>買い物の記録</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {restocks.map(r => {
                    const d = new Date(r.createdAt);
                    const label = `${d.getMonth() + 1}/${d.getDate()}`;
                    return (
                      <TouchableOpacity
                        key={r.id}
                        style={styles.recordItem}
                        activeOpacity={0.85}
                        onPress={() => { if (r.photo) setPhotoView(r.photo); }}
                      >
                        {r.photo ? (
                          // @ts-ignore
                          <img src={r.photo} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }} />
                        ) : (
                          <View style={styles.recordNoPhoto}>
                            <Text style={styles.recordNoPhotoText}>ネット{'\n'}購入</Text>
                          </View>
                        )}
                        <Text style={styles.recordDate}>{label}</Text>
                        <Text numberOfLines={1} style={styles.recordCount}>
                          {r.lines?.length ? `${r.lines.length}品` : '写真のみ'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* 在庫一覧 */}
            {stocks.length === 0 ? (
              <Text style={styles.empty}>
                「＋ 品目」で犬のごはんやコーヒーなどを{'\n'}登録すると、使うペースから残量を自動で減らします
              </Text>
            ) : (
              stocks.map(s => {
                const now = effectiveQty(s);
                const d = daysLeft(s);
                const low = isLow(s);
                const ratio = d !== null
                  ? Math.max(0, Math.min(1, d / Math.max(1, (s.alertDays ?? 5) * 3)))
                  : Math.max(0, Math.min(1, now / Math.max(1, (s.alertQty ?? 1) * 4)));
                return (
                  <View key={s.id} style={[styles.stockCard, low && styles.stockCardLow]}>
                    <TouchableOpacity
                      style={styles.flex1}
                      activeOpacity={0.85}
                      onPress={() => openStockForm(s)}
                      onLongPress={() => { hapticSelect(); setStockMenu(s); }}
                    >
                      <View style={styles.stockTop}>
                        <Text numberOfLines={1} style={styles.stockName}>{s.name}</Text>
                        <Text style={[styles.stockQty, low && styles.stockQtyLow]}>
                          {fmtQty(now)}{s.unit}
                        </Text>
                      </View>
                      <View style={styles.gauge}>
                        <View style={[
                          styles.gaugeFill,
                          { width: `${Math.round(ratio * 100)}%`, backgroundColor: low ? C.or : C.green },
                        ]} />
                      </View>
                      <Text style={styles.stockSub}>
                        {d !== null
                          ? `${fmtDays(d)}（1日 ${fmtQty(s.perDay)}${s.unit}）`
                          : `自動で減らさない（残り${fmtQty(s.alertQty ?? 1)}${s.unit}で通知）`}
                        {s.autoAdd === false ? '・自動追加オフ' : ''}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.stockBtns}>
                      <TouchableOpacity style={styles.stepBtn} onPress={() => bumpStock(s, -1)} activeOpacity={0.8}>
                        <Text style={styles.stepBtnText}>−1</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.stepBtn, styles.stepBtnPlus]} onPress={() => bumpStock(s, 1)} activeOpacity={0.8}>
                        <Text style={[styles.stepBtnText, styles.stepBtnTextPlus]}>＋1</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </Animated.View>
      )}

      {/* ===== タブ3：ポイントカード（上＝コード／下＝ダイヤル） ===== */}
      {activeTab === 'cards' && (
        <Animated.View style={[styles.tabPage, contentStyle]}>
          {/* 上：選択中カードのコード */}
          <View style={styles.codeSheet}>
            {selectedCard ? (
              <>
                <Text style={styles.codeSheetName}>{selectedCard.shopName}</Text>
                {barcodeError ? (
                  <Text style={styles.errorText}>{barcodeError}</Text>
                ) : barcode ? (
                  // @ts-ignore
                  <img
                    src={barcode.url}
                    width={barcode.width}
                    height={barcode.height}
                    alt="code"
                    style={{ width: barcode.width, height: barcode.height, maxWidth: '100%', background: '#fff' }}
                  />
                ) : (
                  <Text style={styles.codeSheetHint}>生成中...</Text>
                )}
                <Text style={styles.codeSheetNum}>{selectedCard.cardNumber}</Text>
                <Text style={styles.codeSheetHint}>※ 読み取りにくい時は画面の明るさを最大に</Text>
              </>
            ) : (
              <Text style={styles.codeSheetHint}>下の「追加」からカードを登録してください</Text>
            )}
          </View>

          {/* ダイヤルの見出し＋追加 */}
          <View style={styles.dialHead}>
            <Text style={styles.dialHeadText}>カードを選ぶ</Text>
            <TouchableOpacity style={styles.addPill} onPress={() => setShowAddCard(true)} activeOpacity={0.85}>
              <Text style={styles.addPillText}>＋ 追加</Text>
            </TouchableOpacity>
          </View>

          {/* 下：アーチダイヤル */}
          {renderDial()}
        </Animated.View>
      )}

      {/* ===== カードの操作メニュー（アイコン長押し） ===== */}
      <Modal visible={!!menuCard} transparent animationType="fade" onRequestClose={() => setMenuCard(null)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setMenuCard(null)}>
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>{menuCard?.shopName}</Text>
            <TouchableOpacity style={styles.menuRow} onPress={() => { if (menuCard) moveCard(menuCard.id, 'up'); setMenuCard(null); }}>
              <Text style={styles.menuRowText}>上に移動</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { if (menuCard) moveCard(menuCard.id, 'down'); setMenuCard(null); }}>
              <Text style={styles.menuRowText}>下に移動</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { if (menuCard) deleteCard(menuCard.id); }}>
              <Text style={[styles.menuRowText, { color: C.or, fontWeight: '800' }]}>削除</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuRow, styles.menuRowLast]} onPress={() => setMenuCard(null)}>
              <Text style={[styles.menuRowText, { color: C.txMuted }]}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ===== 在庫の操作メニュー（長押し） ===== */}
      <Modal visible={!!stockMenu} transparent animationType="fade" onRequestClose={() => setStockMenu(null)}>
        <TouchableOpacity style={styles.menuBackdrop} activeOpacity={1} onPress={() => setStockMenu(null)}>
          <View style={styles.menuCard}>
            <Text style={styles.menuTitle}>{stockMenu?.name}</Text>
            <TouchableOpacity style={styles.menuRow} onPress={() => { const s = stockMenu; setStockMenu(null); if (s) openStockForm(s); }}>
              <Text style={styles.menuRowText}>編集する</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => { if (stockMenu) deleteStock(stockMenu.id); }}>
              <Text style={[styles.menuRowText, { color: C.or, fontWeight: '800' }]}>削除</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuRow, styles.menuRowLast]} onPress={() => setStockMenu(null)}>
              <Text style={[styles.menuRowText, { color: C.txMuted }]}>閉じる</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ===== 写真の拡大 ===== */}
      <Modal visible={!!photoView} transparent animationType="fade" onRequestClose={() => setPhotoView(null)}>
        <TouchableOpacity style={styles.photoBackdrop} activeOpacity={1} onPress={() => setPhotoView(null)}>
          {photoView && (
            // @ts-ignore
            <img src={photoView} alt="" style={{ maxWidth: '92%', maxHeight: '80%', borderRadius: 14 }} />
          )}
        </TouchableOpacity>
      </Modal>

      {/* ===== 在庫の追加・編集 ===== */}
      <Modal visible={showStockForm} animationType="slide">
        <ScrollView style={styles.modal} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.modalTitle}>{editStock ? '在庫を編集' : '在庫に追加'}</Text>

          {!editStock && (
            <>
              <Text style={styles.fieldLabel}>よく使う物から選ぶ</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 6 }}>
                {STOCK_PRESETS.map(p => (
                  <TouchableOpacity
                    key={p.name}
                    onPress={() => applyStockPreset(p)}
                    style={[styles.stockPreset, sName === p.name && styles.stockPresetOn]}
                  >
                    <Text style={[styles.stockPresetText, sName === p.name && styles.stockPresetTextOn]}>{p.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={styles.fieldLabel}>品名</Text>
          <TextInput
            style={styles.input}
            value={sName}
            onChangeText={setSName}
            placeholder="例：犬のごはん"
            placeholderTextColor={C.txFaint}
          />

          <Text style={styles.fieldLabel}>単位</Text>
          <View style={styles.chipRow}>
            {STOCK_UNITS.map(u => (
              <TouchableOpacity
                key={u}
                onPress={() => setSUnit(u)}
                style={[styles.chip, sUnit === u && styles.chipOn]}
              >
                <Text style={[styles.chipText, sUnit === u && styles.chipTextOn]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>今ある数量（{sUnit}）</Text>
          <TextInput
            style={styles.input}
            value={sQty}
            onChangeText={setSQty}
            placeholder="例：3000"
            placeholderTextColor={C.txFaint}
            keyboardType="decimal-pad"
          />

          <Text style={styles.fieldLabel}>使うペース</Text>
          <Text style={styles.hintText}>
            ここを入れておくと、時間の経過にあわせて残量が自動で減ります。
            例：犬のごはんが1日200gなら「200」＋「1日で」。
            わからない物は空欄にして、使うたびに「−1」を押してください。
          </Text>
          <View style={styles.paceRow}>
            <TextInput
              style={[styles.input, { flex: 0, width: 110 }]}
              value={sPace}
              onChangeText={setSPace}
              placeholder="数量"
              placeholderTextColor={C.txFaint}
              keyboardType="decimal-pad"
            />
            <Text style={styles.paceUnit}>{sUnit} を</Text>
            <View style={styles.chipRow}>
              {PACE_PERIODS.map(p => (
                <TouchableOpacity
                  key={p.value}
                  onPress={() => setSPeriod(p.value)}
                  style={[styles.chip, sPeriod === p.value && styles.chipOn]}
                >
                  <Text style={[styles.chipText, sPeriod === p.value && styles.chipTextOn]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {parseFloat(sPace) > 0 ? (
            <>
              <Text style={styles.fieldLabel}>残り何日で知らせる？</Text>
              <View style={styles.chipRow}>
                {['3', '5', '7', '10', '14'].map(v => (
                  <TouchableOpacity
                    key={v}
                    onPress={() => setSAlertDays(v)}
                    style={[styles.chip, sAlertDays === v && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, sAlertDays === v && styles.chipTextOn]}>{v}日前</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>残りいくつで知らせる？（{sUnit}）</Text>
              <TextInput
                style={styles.input}
                value={sAlertQty}
                onChangeText={setSAlertQty}
                placeholder="例：1"
                placeholderTextColor={C.txFaint}
                keyboardType="decimal-pad"
              />
            </>
          )}

          <TouchableOpacity
            style={[styles.toggleRow, sAutoAdd && styles.toggleRowOn]}
            onPress={() => { setSAutoAdd(v => !v); hapticTick(); }}
            activeOpacity={0.85}
          >
            <View style={[styles.check, sAutoAdd && styles.checkDone]}>
              {sAutoAdd && <Text style={styles.checkMark}>✓</Text>}
            </View>
            <Text style={styles.toggleText}>少なくなったら買い物リストに自動で入れる</Text>
          </TouchableOpacity>

          {/* 入力内容の確認 */}
          {parseFloat(sQty) > 0 && parseFloat(sPace) > 0 && (
            <Text style={styles.calcNote}>
              {(() => {
                const factor = PACE_PERIODS.find(p => p.value === sPeriod)?.perDayFactor ?? 1;
                const perDay = parseFloat(sPace) * factor;
                const days = perDay > 0 ? parseFloat(sQty) / perDay : 0;
                return `いまの数量なら約${Math.floor(days)}日分。${Math.max(0, Math.floor(days) - (parseFloat(sAlertDays) || 0))}日後に「そろそろ買う物」に出ます。`;
              })()}
            </Text>
          )}

          <TouchableOpacity style={styles.saveBtn} onPress={saveStock} activeOpacity={0.85}>
            <Text style={styles.saveBtnText}>保存</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowStockForm(false); setEditStock(null); }}>
            <Text style={styles.cancelBtnText}>キャンセル</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      {/* ===== まとめ補充 ===== */}
      <Modal visible={showRestock} animationType="slide">
        <ScrollView style={styles.modal} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.modalTitle}>買ってきた物を登録</Text>
          <Text style={styles.hintText}>
            レジ袋から出す前に1枚だけ撮っておけば記録になります。
            ネットで買った物は写真なしのままで大丈夫です。
            下の品目で買った数を足してください。
          </Text>

          {Platform.OS === 'web' && (
            <>
              {/* @ts-ignore Web専用のファイル入力（カメラ or 写真ライブラリ） */}
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e: any) => pickPhoto(e.target.files?.[0])}
              />
              <TouchableOpacity
                style={styles.photoBtn}
                activeOpacity={0.85}
                onPress={() => photoInput.current?.click?.()}
              >
                <Text style={styles.photoBtnText}>
                  {rBusy ? '読み込み中...' : rPhoto ? '写真を撮り直す / 選び直す' : '写真を撮る / 選ぶ（省略可）'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {rPhoto && (
            <View style={styles.photoPreview}>
              {/* @ts-ignore */}
              <img src={rPhoto} alt="" style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 14 }} />
              <TouchableOpacity onPress={() => setRPhoto(null)}>
                <Text style={styles.photoClear}>写真を外す</Text>
              </TouchableOpacity>
            </View>
          )}

          <TextInput
            style={[styles.input, { marginTop: 12 }]}
            value={rMemo}
            onChangeText={setRMemo}
            placeholder="メモ（例：カインズでまとめ買い／楽天で注文）"
            placeholderTextColor={C.txFaint}
          />

          <Text style={styles.fieldLabel}>買った数を足す</Text>
          {stocks.length === 0 ? (
            <Text style={styles.hintText}>先に「＋ 品目」で在庫を登録してください。</Text>
          ) : (
            stocks.map(s => {
              const add = rLines[s.id] ?? 0;
              const step = s.unit === 'g' || s.unit === 'ml' ? 100 : 1;
              return (
                <View key={s.id} style={[styles.restockRow, add > 0 && styles.restockRowOn]}>
                  <View style={styles.flex1}>
                    <Text numberOfLines={1} style={styles.restockName}>{s.name}</Text>
                    <Text style={styles.restockSub}>
                      いま {fmtQty(effectiveQty(s))}{s.unit}
                      {add > 0 ? ` → ${fmtQty(effectiveQty(s) + add)}${s.unit}` : ''}
                    </Text>
                  </View>
                  <View style={styles.stockBtns}>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => { hapticTick(); setLine(s.id, add - step); }} activeOpacity={0.8}>
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.restockAdd}>{add > 0 ? `+${fmtQty(add)}` : '0'}</Text>
                    <TouchableOpacity style={[styles.stepBtn, styles.stepBtnPlus]} onPress={() => { hapticTick(); setLine(s.id, add + step); }} activeOpacity={0.8}>
                      <Text style={[styles.stepBtnText, styles.stepBtnTextPlus]}>＋</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}

          <TouchableOpacity
            style={[styles.saveBtn, rBusy && { opacity: 0.5 }]}
            onPress={saveRestock}
            disabled={rBusy}
            activeOpacity={0.85}
          >
            <Text style={styles.saveBtnText}>{rBusy ? '保存中...' : '保存'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowRestock(false)}>
            <Text style={styles.cancelBtnText}>キャンセル</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      {/* ===== カード追加 ===== */}
      <Modal visible={showAddCard} animationType="slide">
        <ScrollView style={styles.modal} contentContainerStyle={{ paddingBottom: 40 }}>
          <Text style={styles.modalTitle}>カードを追加</Text>

          <Text style={styles.fieldLabel}>よく使うお店から選択</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
            {PRESET_SHOPS.map(preset => (
              <TouchableOpacity
                key={preset.name}
                onPress={() => selectPresetShop(preset)}
                style={[styles.presetItem, shopName === preset.name && styles.presetItemSelected]}
              >
                {/* @ts-ignore */}
                <img src={preset.logoUrl} style={{ width: 36, height: 36, objectFit: 'contain' }} alt={preset.name} />
                <Text style={styles.presetName}>{preset.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TextInput
            style={styles.input}
            value={shopName}
            onChangeText={setShopName}
            placeholder="お店の名前（例：イオン）"
            placeholderTextColor={C.txFaint}
          />
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            value={cardNumber}
            onChangeText={setCardNumber}
            placeholder="カード番号"
            placeholderTextColor={C.txFaint}
            keyboardType={allowsLetters ? 'default' : 'numeric'}
            autoCapitalize={allowsLetters ? 'characters' : 'none'}
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, { marginTop: 10 }]}
            value={logoUrl}
            onChangeText={setLogoUrl}
            placeholder="ロゴ画像のURL（省略可）"
            placeholderTextColor={C.txFaint}
            autoCapitalize="none"
          />

          <Text style={styles.fieldLabel}>コードの種類</Text>
          <Text style={styles.hintText}>
            カード裏面のバーコードの下に「JAN」「CODE39」「NW-7」などの表記があればそれを選んでください。
            不明な場合は CODE128 のままで試し、読めなければ他の種類に変えてください。
          </Text>
          <View style={styles.codeTypeRow}>
            {CODE_TYPES.map(ct => (
              <TouchableOpacity
                key={ct.value}
                onPress={() => setSelectedCodeType(ct.value)}
                style={[styles.codeTypeBtn, selectedCodeType === ct.value && styles.codeTypeBtnSelected]}
              >
                <Text style={[styles.codeTypeBtnText, selectedCodeType === ct.value && styles.codeTypeBtnTextSelected]}>
                  {ct.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 登録前プレビュー：ここで出せないものはレジでも読めない */}
          <Text style={styles.fieldLabel}>プレビュー</Text>
          <View style={styles.previewContainer}>
            {previewError ? (
              <Text style={styles.errorText}>{previewError}</Text>
            ) : previewImg ? (
              // @ts-ignore
              <img
                src={previewImg.url}
                width={previewImg.width}
                height={previewImg.height}
                alt="preview"
                style={{ width: previewImg.width, height: previewImg.height, maxWidth: '100%', background: '#fff' }}
              />
            ) : (
              <Text style={styles.codeSheetHint}>カード番号を入力するとここに表示されます</Text>
            )}
          </View>

          <Text style={styles.fieldLabel}>アイコンの色（ロゴURLなしの場合）</Text>
          <View style={styles.colorRow}>
            {COLORS.map(color => (
              <TouchableOpacity
                key={color}
                onPress={() => setSelectedColor(color)}
                style={[
                  styles.colorCircle,
                  { backgroundColor: color },
                  selectedColor === color && styles.colorCircleSelected
                ]}
              />
            ))}
          </View>

          <TouchableOpacity style={styles.saveBtn} onPress={addCard} activeOpacity={0.85}>
            <Text style={styles.saveBtnText}>保存</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddCard(false)}>
            <Text style={styles.cancelBtnText}>キャンセル</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },

  // ログイン
  loginContainer: { flex: 1, backgroundColor: C.bg, paddingTop: 120, paddingHorizontal: 32 },
  loginTitle: { fontSize: 30, fontWeight: 'bold', color: C.green, marginBottom: 8, textAlign: 'center' },
  loginSubtitle: { fontSize: 15, color: C.txMuted, marginBottom: 28, textAlign: 'center' },
  loginInput: {
    backgroundColor: C.field, borderRadius: 15, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, borderWidth: 1, borderColor: C.line, marginBottom: 14, textAlign: 'center', color: C.tx,
  },
  loginBtn: { backgroundColor: C.green, borderRadius: 15, padding: 16, alignItems: 'center', marginBottom: 14 },
  loginBtnText: { color: '#fff', fontWeight: '800', fontSize: 17, letterSpacing: 2 },
  loginHint: { fontSize: 13, color: C.txFaint, textAlign: 'center' },

  // 全体
  container: { flex: 1, backgroundColor: C.bg, paddingTop: 46, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 },
  familyCodeLabel: { fontSize: 12.5, color: C.txMuted, flexShrink: 1 },
  changeCode: { fontSize: 12.5, color: C.or, fontWeight: '800' },

  // タブ
  tabBar: {
    flexDirection: 'row', backgroundColor: C.field, borderRadius: 19, padding: 5,
    borderWidth: 1, borderColor: C.line, marginBottom: 12, position: 'relative',
  },
  tabIndicator: {
    position: 'absolute', top: 5, left: 5, bottom: 5, borderRadius: 15, backgroundColor: C.green,
  },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  tabText: { fontSize: 14, color: C.txMuted, fontWeight: '700' },
  tabTextActive: { color: '#fff', fontWeight: '800' },
  tabBadge: { minWidth: 19, paddingHorizontal: 6, height: 19, borderRadius: 10, backgroundColor: C.or, alignItems: 'center', justifyContent: 'center' },
  tabBadgeActive: { backgroundColor: '#fff' },
  tabBadgeText: { fontSize: 10.5, fontWeight: '800', color: '#fff' },
  tabBadgeTextActive: { color: C.green },
  tabPage: { flex: 1 },

  // 買い物リスト
  inputRow: { flexDirection: 'row', marginBottom: 12, gap: 8, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: C.field, borderRadius: 15, paddingHorizontal: 15, paddingVertical: 12,
    fontSize: 15, borderWidth: 1, borderColor: C.line, color: C.tx,
  },
  addFab: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.or, alignItems: 'center', justifyContent: 'center' },
  addFabText: { color: '#fff', fontSize: 24, fontWeight: '700', lineHeight: 28 },
  item: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16,
    paddingVertical: 13, paddingHorizontal: 15, marginBottom: 8, borderWidth: 1, borderColor: C.line,
  },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 23, height: 23, borderRadius: 12, borderWidth: 2.5, borderColor: C.greenLine, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: C.green, borderColor: C.green },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  itemText: { fontSize: 15, color: C.tx, fontWeight: '600' },
  itemDone: { textDecorationLine: 'line-through', color: C.txFaint, fontWeight: '400' },
  deleteBtn: { color: C.or, fontSize: 12.5, fontWeight: '700' },
  empty: { textAlign: 'center', color: C.txFaint, marginTop: 40, fontSize: 15 },

  // ===== 在庫 =====
  alertBox: {
    backgroundColor: '#FFF6F2', borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,69,0,0.35)',
    padding: 12, marginBottom: 12,
  },
  alertTitle: { fontSize: 13, fontWeight: '800', color: C.or, marginBottom: 8 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  alertName: { fontSize: 15, fontWeight: '700', color: C.tx },
  alertSub: { fontSize: 11.5, color: C.txMuted, marginTop: 2 },
  alertBtn: { height: 32, paddingHorizontal: 13, borderRadius: 16, backgroundColor: C.or, alignItems: 'center', justifyContent: 'center' },
  alertBtnText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  alertDone: { fontSize: 11.5, color: C.green, fontWeight: '700' },

  stockActions: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  restockBtn: { flex: 1, backgroundColor: C.or, borderRadius: 16, paddingVertical: 13, alignItems: 'center' },
  restockBtnText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  stockAddBtn: {
    paddingHorizontal: 14, borderRadius: 16, backgroundColor: '#fff',
    borderWidth: 1.5, borderColor: C.greenLine, alignItems: 'center', justifyContent: 'center',
  },
  stockAddBtnText: { color: C.green, fontSize: 13, fontWeight: '800' },

  recordBox: { marginBottom: 14 },
  recordTitle: { fontSize: 12, fontWeight: '800', color: C.txMuted, letterSpacing: 1, marginBottom: 8 },
  recordItem: { width: 66, marginRight: 10, alignItems: 'center' },
  recordNoPhoto: {
    width: 64, height: 64, borderRadius: 10, backgroundColor: C.field,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
  },
  recordNoPhotoText: { fontSize: 9.5, color: C.txFaint, textAlign: 'center', lineHeight: 12 },
  recordDate: { fontSize: 10.5, color: C.txMuted, fontWeight: '700', marginTop: 3 },
  recordCount: { fontSize: 9.5, color: C.txFaint },

  stockCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff',
    borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 13, marginBottom: 8,
  },
  stockCardLow: { borderColor: 'rgba(255,69,0,0.45)', borderWidth: 1.5 },
  stockTop: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  stockName: { fontSize: 15.5, fontWeight: '700', color: C.tx, flexShrink: 1 },
  stockQty: { fontSize: 15, fontWeight: '800', color: C.green },
  stockQtyLow: { color: C.or },
  gauge: { height: 6, borderRadius: 3, backgroundColor: C.field, marginTop: 7, overflow: 'hidden' },
  gaugeFill: { height: 6, borderRadius: 3 },
  stockSub: { fontSize: 11, color: C.txFaint, marginTop: 6 },
  stockBtns: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 42, height: 38, borderRadius: 12, backgroundColor: C.field,
    borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center',
  },
  stepBtnPlus: { backgroundColor: C.green, borderColor: C.green },
  stepBtnText: { fontSize: 13.5, fontWeight: '800', color: C.txMuted },
  stepBtnTextPlus: { color: '#fff' },

  // 在庫フォーム
  chipRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1, borderColor: C.line,
  },
  chipOn: { backgroundColor: C.green, borderColor: C.green },
  chipText: { fontSize: 13, color: C.txMuted, fontWeight: '700' },
  chipTextOn: { color: '#fff', fontWeight: '800' },
  stockPreset: {
    paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, marginRight: 8,
    backgroundColor: '#fff', borderWidth: 1, borderColor: C.line,
  },
  stockPresetOn: { borderColor: C.green, borderWidth: 2 },
  stockPresetText: { fontSize: 13, color: C.txMuted, fontWeight: '700' },
  stockPresetTextOn: { color: C.green, fontWeight: '800' },
  paceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  paceUnit: { fontSize: 13.5, color: C.txMuted, fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 20,
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 14,
  },
  toggleRowOn: { borderColor: C.greenLine, borderWidth: 1.5 },
  toggleText: { flex: 1, fontSize: 13.5, color: C.tx, fontWeight: '700' },
  calcNote: {
    fontSize: 12, color: C.green, fontWeight: '700', marginTop: 14,
    backgroundColor: 'rgba(0,128,0,0.07)', borderRadius: 12, padding: 12, lineHeight: 18,
  },

  // まとめ補充
  photoBtn: {
    backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: C.greenLine,
    paddingVertical: 15, alignItems: 'center', marginTop: 6,
  },
  photoBtnText: { fontSize: 14, fontWeight: '800', color: C.green },
  photoPreview: { alignItems: 'center', marginTop: 12 },
  photoClear: { fontSize: 12, color: C.or, fontWeight: '800', marginTop: 8 },
  photoBackdrop: { flex: 1, backgroundColor: 'rgba(18,36,15,0.85)', alignItems: 'center', justifyContent: 'center' },
  restockRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff',
    borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 12, marginBottom: 8,
  },
  restockRowOn: { borderColor: C.greenLine, borderWidth: 1.5, backgroundColor: 'rgba(0,128,0,0.04)' },
  restockName: { fontSize: 14.5, fontWeight: '700', color: C.tx },
  restockSub: { fontSize: 11, color: C.txFaint, marginTop: 2 },
  restockAdd: { fontSize: 13, fontWeight: '800', color: C.green, minWidth: 44, textAlign: 'center' },

  // 上のコードシート（薄いグリーンの縁取り）
  codeSheet: {
    backgroundColor: '#fff', borderRadius: 24, borderWidth: 1.5, borderColor: C.greenLine,
    paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center', marginBottom: 10,
  },
  codeSheetName: { fontSize: 15, fontWeight: '800', color: C.green, marginBottom: 8 },
  codeSheetNum: { fontSize: 17, fontWeight: '800', color: C.tx, marginTop: 6, letterSpacing: 1.5 },
  codeSheetHint: { fontSize: 10, color: C.txFaint, marginTop: 4, textAlign: 'center' },
  errorText: { color: '#C0392B', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // ダイヤル
  dialHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 2, marginBottom: 2 },
  dialHeadText: { fontSize: 12, fontWeight: '800', color: C.txMuted, letterSpacing: 1 },
  addPill: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: C.or, alignItems: 'center', justifyContent: 'center' },
  addPillText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  arc: { flex: 1, marginHorizontal: -16, overflow: 'hidden' },
  rail: { position: 'absolute', borderWidth: 1.5, borderColor: C.greenFaint },
  rail2: { position: 'absolute', borderWidth: 1, borderColor: C.greenGhost },
  // 丸の中心を円弧上に合わせるため、64pxの箱の中央を基準点にする
  slot: { position: 'absolute', left: -DIAL.box / 2, top: -DIAL.box / 2 },
  slotTouch: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  dotBox: { width: DIAL.box, height: DIAL.box, alignItems: 'center', justifyContent: 'center' },
  dot: {
    width: 50, height: 50, borderRadius: 25,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
    borderWidth: 2, borderColor: C.greenLine,
  },
  dotSel: {
    backgroundColor: C.green, borderWidth: 3, borderColor: '#fff',
    transform: [{ scale: 1.24 }],
  },
  dotText: { color: C.green, fontWeight: '800', fontSize: 20 },
  dotTextSel: { color: '#fff' },
  slotLabel: { maxWidth: 118 },
  slotName: { fontSize: 14, fontWeight: '700', color: C.txMuted },
  slotNameSel: { fontSize: 17, fontWeight: '800', color: C.green },
  slotSub: { fontSize: 10.5, color: C.txFaint, marginTop: 2 },
  slotSubSel: { color: C.txMuted, fontWeight: '600' },

  // 長押しメニュー
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(18,36,15,0.35)', alignItems: 'center', justifyContent: 'center', padding: 32 },
  menuCard: { width: '100%', maxWidth: 320, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1.5, borderColor: C.greenLine, overflow: 'hidden' },
  menuTitle: { fontSize: 15, fontWeight: '800', color: C.green, textAlign: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  menuRow: { paddingVertical: 15, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.line },
  menuRowLast: { borderBottomWidth: 0 },
  menuRowText: { fontSize: 15, fontWeight: '700', color: C.tx },

  // カード追加モーダル
  modal: { flex: 1, backgroundColor: C.bg, paddingTop: 56, paddingHorizontal: 16 },
  modalTitle: { fontSize: 23, fontWeight: 'bold', marginBottom: 8, color: C.green },
  fieldLabel: { fontSize: 13, color: C.txMuted, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  hintText: { fontSize: 12, color: C.txFaint, marginBottom: 10, lineHeight: 18 },
  previewContainer: {
    backgroundColor: '#fff', borderRadius: 18, borderWidth: 1.5, borderColor: C.greenLine,
    padding: 16, alignItems: 'center', minHeight: 90, justifyContent: 'center',
  },
  colorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  colorCircle: { width: 36, height: 36, borderRadius: 18 },
  colorCircleSelected: { borderWidth: 3, borderColor: C.tx },
  presetItem: {
    alignItems: 'center', padding: 10, marginRight: 10, backgroundColor: '#fff',
    borderRadius: 14, borderWidth: 1, borderColor: C.line, width: 72,
  },
  presetItemSelected: { borderColor: C.green, borderWidth: 2 },
  presetName: { fontSize: 10, color: C.txMuted, marginTop: 4, textAlign: 'center' },
  codeTypeRow: { flexDirection: 'column', gap: 8 },
  codeTypeBtn: { backgroundColor: '#fff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: C.line },
  codeTypeBtnSelected: { backgroundColor: C.green, borderColor: C.green },
  codeTypeBtnText: { fontSize: 14, color: C.txMuted, textAlign: 'center' },
  codeTypeBtnTextSelected: { color: '#fff', fontWeight: '800' },
  saveBtn: { backgroundColor: C.green, borderRadius: 18, padding: 15, alignItems: 'center', marginTop: 22 },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15.5, letterSpacing: 1.5 },
  cancelBtn: { backgroundColor: C.field, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 15, alignItems: 'center', marginTop: 10 },
  cancelBtnText: { color: C.txMuted, fontWeight: '700', fontSize: 14.5 },
});
