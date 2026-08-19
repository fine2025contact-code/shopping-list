import bwipjs from '@bwip-js/browser';
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
  maxAngle: 38,      // 端のカードの最大角度
  size: 50,          // 通常の丸の直径
  sizeSel: 62,       // 選択中の丸の直径
};

// 残りの高さに5枚が収まる角度を求める（狭い画面でも端が切れないようにする）
function dialAngles(halfHeight: number): number[] {
  const usable = Math.max(60, halfHeight - 40);            // 丸の半径ぶん余白を取る
  const ratio = Math.min(Math.sin((DIAL.maxAngle * Math.PI) / 180), usable / DIAL.r);
  const maxA = (Math.asin(Math.max(0.12, ratio)) * 180) / Math.PI;
  return [-maxA, -maxA / 2, 0, maxA / 2, maxA];
}

export default function HomeScreen() {
  const [familyCode, setFamilyCode] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState('');
  const [activeTab, setActiveTab] = useState<'list' | 'cards'>('list');
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

  useEffect(() => { setupLocationAndNotifications(); }, []);

  useEffect(() => {
    Animated.timing(indicatorAnim, {
      toValue: activeTab === 'list' ? 0 : 1,
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
    try {
      setBarcode(renderCode(selectedCard.codeType, selectedCard.cardNumber, availableCodeWidth(selectedCard.codeType)));
      setBarcodeError('');
    } catch (e: any) {
      setBarcode(null);
      const v = validateCode(selectedCard.codeType, selectedCard.cardNumber);
      setBarcodeError(v || `コードを生成できませんでした：${e?.message ?? e}`);
    }
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
  const dragAccum = useRef(0);
  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => { dragAccum.current = 0; },
    onPanResponderMove: (_e, g) => {
      const step = 64;               // これだけ動かすと1枚送る
      const delta = g.dy - dragAccum.current;
      if (delta <= -step) {
        dragAccum.current = g.dy;
        setSelectedIndex(i => (i + 1) % Math.max(cards.length, 1));
      } else if (delta >= step) {
        dragAccum.current = g.dy;
        setSelectedIndex(i => (i - 1 + Math.max(cards.length, 1)) % Math.max(cards.length, 1));
      }
    },
  }), [cards.length]);

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
    await addDoc(collection(db, 'items'), {
      name: text.trim(), done: false, createdAt: Date.now(), familyCode
    });
    setText('');
  };

  const toggleItem = async (id: string, done: boolean) => {
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
        <View style={styles.arc}>
          <Text style={styles.empty}>カードが登録されていません</Text>
        </View>
      );
    }
    const cy = arcHeight > 0 ? arcHeight / 2 : 190;
    const angles = dialAngles(cy);
    const railLeft = DIAL.cx - DIAL.r;
    const railTop = cy - DIAL.r;

    return (
      <View
        style={styles.arc}
        onLayout={e => setArcHeight(e.nativeEvent.layout.height)}
        {...panResponder.panHandlers}
      >
        {/* 円弧のレール */}
        <View pointerEvents="none" style={[styles.rail, {
          left: railLeft, top: railTop, width: DIAL.r * 2, height: DIAL.r * 2, borderRadius: DIAL.r,
        }]} />
        <View pointerEvents="none" style={[styles.rail2, {
          left: railLeft + 26, top: railTop + 26,
          width: (DIAL.r - 26) * 2, height: (DIAL.r - 26) * 2, borderRadius: DIAL.r - 26,
        }]} />

        {angles.map((angDeg, k) => {
          const isSel = k === 2;
          const idx = (selectedIndex + (k - 2) + cards.length * 2) % cards.length;
          const card = cards[idx];
          if (!card) return null;
          const a = (angDeg * Math.PI) / 180;
          const x = DIAL.cx + DIAL.r * Math.cos(a);
          const y = cy + DIAL.r * Math.sin(a);
          const sz = isSel ? DIAL.sizeSel : DIAL.size;
          return (
            <TouchableOpacity
              key={`${card.id}-${k}`}
              activeOpacity={0.75}
              onPress={() => setSelectedIndex(idx)}
              onLongPress={() => setMenuCard(card)}
              style={[styles.slot, {
                left: x - sz / 2,
                top: y - sz / 2,
                opacity: (k === 0 || k === 4) ? 0.4 : 1,
              }]}
            >
              <View style={[
                styles.dot,
                { width: sz, height: sz, borderRadius: sz / 2 },
                isSel && styles.dotSel,
              ]}>
                {card.logoUrl ? (
                  // @ts-ignore
                  <img src={card.logoUrl} alt="" style={{
                    width: sz - 18, height: sz - 18, objectFit: 'contain', borderRadius: 8,
                  }} />
                ) : (
                  <Text style={[styles.dotText, { fontSize: isSel ? 24 : 20 }, isSel && styles.dotTextSel]}>
                    {card.shopName[0]}
                  </Text>
                )}
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
            width: (tabBarWidth - 10) / 2,
            transform: [{
              translateX: indicatorAnim.interpolate({
                inputRange: [0, 1], outputRange: [0, (tabBarWidth - 10) / 2],
              }),
            }],
          }]} />
        )}
        <TouchableOpacity style={styles.tabBtn} onPress={() => setActiveTab('list')} activeOpacity={0.8}>
          <Text style={[styles.tabText, activeTab === 'list' && styles.tabTextActive]}>買い物リスト</Text>
          {items.filter(i => !i.done).length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'list' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'list' && styles.tabBadgeTextActive]}>
                {items.filter(i => !i.done).length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.tabBtn} onPress={() => setActiveTab('cards')} activeOpacity={0.8}>
          <Text style={[styles.tabText, activeTab === 'cards' && styles.tabTextActive]}>ポイントカード</Text>
          {cards.length > 0 && (
            <View style={[styles.tabBadge, activeTab === 'cards' && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, activeTab === 'cards' && styles.tabBadgeTextActive]}>
                {cards.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
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

      {/* ===== タブ2：ポイントカード（上＝コード／下＝ダイヤル） ===== */}
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
  container: { flex: 1, backgroundColor: C.bg, paddingTop: 50, paddingHorizontal: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 4 },
  familyCodeLabel: { fontSize: 12.5, color: C.txMuted, flexShrink: 1 },
  changeCode: { fontSize: 12.5, color: C.or, fontWeight: '800' },

  // タブ
  tabBar: {
    flexDirection: 'row', backgroundColor: C.field, borderRadius: 19, padding: 5,
    borderWidth: 1, borderColor: C.line, marginBottom: 16, position: 'relative',
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

  // 上のコードシート（薄いグリーンの縁取り）
  codeSheet: {
    backgroundColor: '#fff', borderRadius: 24, borderWidth: 1.5, borderColor: C.greenLine,
    paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center', marginBottom: 12,
  },
  codeSheetName: { fontSize: 15, fontWeight: '800', color: C.green, marginBottom: 10 },
  codeSheetNum: { fontSize: 17, fontWeight: '800', color: C.tx, marginTop: 8, letterSpacing: 2 },
  codeSheetHint: { fontSize: 10.5, color: C.txFaint, marginTop: 6, textAlign: 'center' },
  errorText: { color: '#C0392B', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // ダイヤル
  dialHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 2, marginBottom: 6 },
  dialHeadText: { fontSize: 12, fontWeight: '800', color: C.txMuted, letterSpacing: 1 },
  addPill: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: C.or, alignItems: 'center', justifyContent: 'center' },
  addPillText: { color: '#fff', fontSize: 12.5, fontWeight: '800' },
  arc: { flex: 1, marginHorizontal: -16, overflow: 'hidden' },
  rail: { position: 'absolute', borderWidth: 1.5, borderColor: C.greenFaint },
  rail2: { position: 'absolute', borderWidth: 1, borderColor: C.greenGhost },
  slot: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 13 },
  dot: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
    borderWidth: 2, borderColor: C.greenLine,
  },
  dotSel: { backgroundColor: C.green, borderWidth: 3, borderColor: '#fff' },
  dotText: { color: C.green, fontWeight: '800' },
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
