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
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList, KeyboardAvoidingView,
  Modal,
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

const COLORS = [
  '#4a90e2', '#e24a4a', '#2ecc71', '#f39c12',
  '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
];

const CODE_TYPES = [
  { label: 'バーコード (CODE128)', value: 'CODE128' },
  { label: 'バーコード (EAN-13)', value: 'EAN13' },
  { label: 'QRコード', value: 'QR' },
];

const PRESET_SHOPS = [
  { name: 'キラヤ', logoUrl: 'https://www.google.com/s2/favicons?domain=kiraya-iida.com&sz=64' },
  { name: 'カインズ', logoUrl: 'https://www.google.com/s2/favicons?domain=cainz.com&sz=64' },
  { name: 'ニトリ', logoUrl: 'https://www.google.com/s2/favicons?domain=nitori-net.jp&sz=64' },
  { name: '楽天', logoUrl: 'https://www.google.com/s2/favicons?domain=rakuten.co.jp&sz=64' },
  { name: 'Tポイント', logoUrl: 'https://www.google.com/s2/favicons?domain=tsite.jp&sz=64' },
  { name: 'シャトレーゼ', logoUrl: 'https://www.google.com/s2/favicons?domain=chateraise.co.jp&sz=64' },
];

const C128: Record<string, number[]> = {
  ' ':[2,1,2,2,2,2],'!':[2,2,2,1,2,2],'"':[2,2,2,2,2,1],'#':[1,2,1,2,2,3],
  '$':[1,2,1,3,2,2],'%':[1,3,1,2,2,2],'&':[1,2,2,2,1,3],"'":[1,2,2,3,1,2],
  '(':[1,3,2,2,1,2],')':[2,2,1,2,1,3],'*':[2,2,1,3,1,2],'+':[2,3,1,2,1,2],
  ',':[1,1,2,2,3,2],'-':[1,2,2,1,3,2],'.':[1,2,2,2,3,1],'/':[1,1,3,2,2,2],
  '0':[1,2,3,1,2,2],'1':[1,2,3,2,2,1],'2':[2,2,3,2,1,1],'3':[2,2,1,1,3,2],
  '4':[2,2,1,2,3,1],'5':[2,1,3,2,1,2],'6':[2,2,3,1,1,2],'7':[3,1,2,1,3,1],
  '8':[3,1,1,2,2,2],'9':[3,2,1,1,2,2],':':[3,2,1,2,2,1],';':[3,1,2,2,1,2],
  '<':[3,2,2,1,1,2],'=':[3,2,2,2,1,1],'>':[2,1,2,1,2,3],'?':[2,1,2,3,2,1],
  '@':[2,3,2,1,2,1],'A':[1,1,1,3,2,3],'B':[1,3,1,1,2,3],'C':[1,3,1,3,2,1],
  'D':[1,1,2,3,1,3],'E':[1,3,2,1,1,3],'F':[1,3,2,3,1,1],'G':[2,1,1,3,1,3],
  'H':[2,3,1,1,1,3],'I':[2,3,1,3,1,1],'J':[1,1,3,1,2,3],'K':[1,1,3,3,2,1],
  'L':[1,3,3,1,2,1],'M':[1,1,2,1,3,3],'N':[1,1,2,3,3,1],'O':[1,3,2,1,3,1],
  'P':[3,1,1,1,2,3],'Q':[3,1,1,3,2,1],'R':[3,3,1,1,2,1],'S':[3,1,2,1,1,3],
  'T':[3,1,2,3,1,1],'U':[3,3,2,1,1,1],'V':[3,1,3,1,1,2],'W':[3,1,3,2,1,1],
  'X':[3,3,3,1,1,1],'Y':[1,1,2,1,1,5],'Z':[1,1,2,5,1,1],
};
const START_B = [2,1,1,4,1,2];
const STOP = [2,3,3,1,1,1,2];
const C128_KEYS = Object.keys(C128);

function buildBars(value: string): number[] {
  const bars = [...START_B];
  let checksum = 104;
  value.split('').forEach((ch, i) => {
    const idx = C128_KEYS.indexOf(ch);
    const pat = idx >= 0 ? C128[ch] : C128[' '];
    bars.push(...pat);
    checksum += (i + 1) * (idx >= 0 ? idx + 32 : 0);
  });
  const modIdx = checksum % 103;
  bars.push(...(Object.values(C128)[modIdx] ?? C128[' ']));
  bars.push(...STOP);
  return bars;
}

function drawBarcode(canvas: HTMLCanvasElement, value: string) {
  const bars = buildBars(value);
  const total = bars.reduce((a, b) => a + b, 0);
  const W = canvas.width;
  const H = canvas.height;
  const scale = W / total;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  let x = 0;
  bars.forEach((w, i) => {
    if (i % 2 === 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x * scale, 0, w * scale, H);
    }
    x += w;
  });
}

function drawEAN13(canvas: HTMLCanvasElement, value: string) {
  const digits = value.replace(/\s/g, '').substring(0, 13).padStart(13, '0');
  const L = [[3,2,1,1],[2,2,2,1],[2,1,2,2],[1,4,1,1],[1,1,3,2],[1,2,3,1],[1,1,1,4],[1,3,1,2],[1,2,1,3],[3,1,1,2]];
  const G = [[1,1,2,3],[1,2,2,2],[2,2,1,2],[1,1,4,1],[2,3,1,1],[1,3,2,1],[4,1,1,1],[2,1,3,1],[3,1,2,1],[2,1,1,3]];
  const R = [[3,2,1,1],[2,2,2,1],[2,1,2,2],[1,4,1,1],[1,1,3,2],[1,2,3,1],[1,1,1,4],[1,3,1,2],[1,2,1,3],[3,1,1,2]].map(p => [...p].reverse());
  const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const moduleWidth = W / 95;
  let x = 0;

  const drawBar = (modules: number, dark: boolean) => {
    if (dark) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x * moduleWidth, 0, modules * moduleWidth, H * 0.85);
    }
    x += modules;
  };

  drawBar(1, true); drawBar(1, false); drawBar(1, true);

  const parity = PARITY[parseInt(digits[0])];

  for (let i = 1; i <= 6; i++) {
    const d = parseInt(digits[i]);
    const pattern = parity[i-1] === 'L' ? L[d] : G[d];
    pattern.forEach((m, j) => drawBar(m, j % 2 === 0));
  }

  drawBar(1, false); drawBar(1, true); drawBar(1, false); drawBar(1, true); drawBar(1, false);

  for (let i = 7; i <= 12; i++) {
    const d = parseInt(digits[i]);
    const pattern = R[d];
    pattern.forEach((m, j) => drawBar(m, j % 2 === 0));
  }

  drawBar(1, true); drawBar(1, false); drawBar(1, true);

  ctx.fillStyle = '#000';
  ctx.font = `${moduleWidth * 8}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(digits[0], moduleWidth * 2, H);
  for (let i = 1; i <= 6; i++) {
    ctx.fillText(digits[i], (3 + (i-1)*7 + 3.5) * moduleWidth, H);
  }
  for (let i = 7; i <= 12; i++) {
    ctx.fillText(digits[i], (50 + (i-7)*7 + 3.5) * moduleWidth, H);
  }
}

function generateQRUrl(value: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(value)}`;
}

export default function HomeScreen() {
  const [familyCode, setFamilyCode] = useState<string | null>(null);
  const [inputCode, setInputCode] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState('');
  const [showCards, setShowCards] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [shopName, setShopName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const [selectedCodeType, setSelectedCodeType] = useState('CODE128');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [barcodeUrl, setBarcodeUrl] = useState('');
  const notifiedShops = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('familyCode');
      if (saved) setFamilyCode(saved);
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
    });
    return unsub;
  }, [familyCode]);

  useEffect(() => { setupLocationAndNotifications(); }, []);

  useEffect(() => {
    if (!selectedCard) { setBarcodeUrl(''); return; }
    if (selectedCard.codeType === 'QR') {
      setBarcodeUrl(generateQRUrl(selectedCard.cardNumber));
      return;
    }
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 150;
    if (selectedCard.codeType === 'EAN13') {
      drawEAN13(canvas, selectedCard.cardNumber);
    } else {
      drawBarcode(canvas, selectedCard.cardNumber);
    }
    setBarcodeUrl(canvas.toDataURL('image/png'));
  }, [selectedCard]);

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
    if (typeof window !== 'undefined') localStorage.setItem('familyCode', code);
    setFamilyCode(code);
  };

  const addItem = async () => {
    if (!text.trim() || !familyCode) return;
    await addDoc(collection(db, 'items'), {
      name: text.trim(),
      done: false,
      createdAt: Date.now(),
      familyCode
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
      Alert.alert('お店の名前とカード番号を入力してください');
      return;
    }
    const newOrder = cards.length;
    await addDoc(collection(db, 'cards'), {
      shopName: shopName.trim(),
      cardNumber: cardNumber.trim(),
      logoUrl: logoUrl.trim(),
      color: selectedColor,
      codeType: selectedCodeType,
      familyCode,
      order: newOrder,
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
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('本当に削除しますか？');
      if (confirmed) await deleteDoc(doc(db, 'cards', id));
    } else {
      Alert.alert('カードを削除', '本当に削除しますか？', [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: async () => await deleteDoc(doc(db, 'cards', id)) },
      ]);
    }
  };

  const moveCard = async (id: string, direction: 'up' | 'down') => {
    const index = cards.findIndex(c => c.id === id);
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === cards.length - 1) return;
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    const currentOrder = cards[index].order ?? index;
    const swapOrder = cards[swapIndex].order ?? swapIndex;
    await updateDoc(doc(db, 'cards', id), { order: swapOrder });
    await updateDoc(doc(db, 'cards', cards[swapIndex].id), { order: currentOrder });
  };

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
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity style={styles.loginBtn} onPress={enterCode}>
          <Text style={styles.loginBtnText}>開始する</Text>
        </TouchableOpacity>
        <Text style={styles.loginHint}>※ 家族全員が同じコードを使うと、リストが共有されます</Text>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>買い物リスト</Text>
        <TouchableOpacity onPress={() => {
          if (typeof window !== 'undefined') localStorage.removeItem('familyCode');
          setFamilyCode(null);
          setInputCode('');
        }}>
          <Text style={styles.changeCode}>コード変更</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="アイテムを入力..."
          onSubmitEditing={addItem}
        />
        <TouchableOpacity style={styles.addBtn} onPress={addItem}>
          <Text style={styles.addBtnText}>追加</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={items}
        keyExtractor={i => i.id}
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

      <TouchableOpacity style={styles.cardBtn} onPress={() => setShowCards(true)}>
        <Text style={styles.cardBtnText}>ポイントカード・バーコード</Text>
      </TouchableOpacity>

      <Modal visible={showCards} animationType="slide">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>ポイントカード</Text>
          <ScrollView>
            {cards.map((card, index) => (
              <TouchableOpacity key={card.id} style={styles.cardItem}
                onPress={() => { setSelectedCard(card); setShowCards(false); }}>
                <View style={styles.cardHeader}>
                  {card.logoUrl ? (
                    // @ts-ignore
                    <img src={card.logoUrl} style={{ width: 50, height: 50, objectFit: 'contain', marginRight: 12, borderRadius: 8 }} alt="logo" />
                  ) : (
                    <View style={[styles.logoPlaceholder, { backgroundColor: card.color || COLORS[0] }]}>
                      <Text style={styles.logoPlaceholderText}>{card.shopName[0]}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardShopName}>{card.shopName}</Text>
                    <Text style={styles.cardNumber}>{card.cardNumber}</Text>
                    <Text style={styles.codeTypeLabel}>{CODE_TYPES.find(c => c.value === card.codeType)?.label || 'バーコード'}</Text>
                  </View>
                  <View style={styles.cardActions}>
                    <TouchableOpacity onPress={() => moveCard(card.id, 'up')} disabled={index === 0}>
                      <Text style={[styles.arrowBtn, index === 0 && styles.arrowBtnDisabled]}>↑</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => moveCard(card.id, 'down')} disabled={index === cards.length - 1}>
                      <Text style={[styles.arrowBtn, index === cards.length - 1 && styles.arrowBtnDisabled]}>↓</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteCard(card.id)}>
                      <Text style={styles.deleteBtn}>削除</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
            {cards.length === 0 && <Text style={styles.empty}>カードが登録されていません</Text>}
          </ScrollView>
          <TouchableOpacity style={styles.addCardBtn} onPress={() => setShowAddCard(true)}>
            <Text style={styles.addBtnText}>カードを追加</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setShowCards(false)}>
            <Text style={styles.closeBtnText}>閉じる</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal visible={showAddCard} animationType="slide">
        <ScrollView style={styles.modal}>
          <Text style={styles.modalTitle}>カードを追加</Text>

          <Text style={styles.colorLabel}>よく使うお店から選択</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
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
          />
          <TextInput
            style={[styles.input, { marginTop: 12 }]}
            value={cardNumber}
            onChangeText={setCardNumber}
            placeholder="カード番号"
            keyboardType="numeric"
          />
          <TextInput
            style={[styles.input, { marginTop: 12 }]}
            value={logoUrl}
            onChangeText={setLogoUrl}
            placeholder="ロゴ画像のURL（省略可）"
            autoCapitalize="none"
          />

          <Text style={styles.colorLabel}>コードの種類</Text>
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

          <Text style={styles.colorLabel}>アイコンの色（ロゴURLなしの場合）</Text>
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

          <TouchableOpacity style={[styles.addCardBtn, { marginTop: 16 }]} onPress={addCard}>
            <Text style={styles.addBtnText}>保存</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.closeBtn, { marginBottom: 40 }]} onPress={() => setShowAddCard(false)}>
            <Text style={styles.closeBtnText}>キャンセル</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>

      <Modal visible={!!selectedCard} animationType="slide">
        <View style={styles.modal}>
          <View style={styles.cardHeader}>
            {selectedCard?.logoUrl ? (
              // @ts-ignore
              <img src={selectedCard.logoUrl} style={{ width: 60, height: 60, objectFit: 'contain', marginRight: 12, borderRadius: 8 }} alt="logo" />
            ) : (
              <View style={[styles.logoPlaceholder, { backgroundColor: selectedCard?.color || COLORS[0] }]}>
                <Text style={styles.logoPlaceholderText}>{selectedCard?.shopName[0]}</Text>
              </View>
            )}
            <Text style={styles.modalTitle}>{selectedCard?.shopName}</Text>
          </View>
          <View style={styles.barcodeContainer}>
            {barcodeUrl ? (
              selectedCard?.codeType === 'QR' ? (
                // @ts-ignore
                <img src={barcodeUrl} style={{ width: 200, height: 200 }} alt="qrcode" />
              ) : (
                // @ts-ignore
                <img src={barcodeUrl} style={{ width: '100%', height: 150 }} alt="barcode" />
              )
            ) : (
              <Text style={styles.empty}>生成中...</Text>
            )}
            <Text style={styles.cardNumberLarge}>{selectedCard?.cardNumber}</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={() => { setSelectedCard(null); setShowCards(true); }}>
            <Text style={styles.closeBtnText}>戻る</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  loginContainer: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 120, paddingHorizontal: 32 },
  loginTitle: { fontSize: 32, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 8, textAlign: 'center' },
  loginSubtitle: { fontSize: 16, color: '#666', marginBottom: 32, textAlign: 'center' },
  loginInput: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, borderWidth: 0.5, borderColor: '#ddd', marginBottom: 16, textAlign: 'center' },
  loginBtn: { backgroundColor: '#4a90e2', borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 16 },
  loginBtnText: { color: '#fff', fontWeight: '600', fontSize: 17 },
  loginHint: { fontSize: 13, color: '#aaa', textAlign: 'center' },
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 60, paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a1a' },
  changeCode: { fontSize: 13, color: '#4a90e2' },
  inputRow: { flexDirection: 'row', marginBottom: 16, gap: 8 },
  input: { flex: 1, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, borderWidth: 0.5, borderColor: '#ddd' },
  addBtn: { backgroundColor: '#4a90e2', borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, borderWidth: 0.5, borderColor: '#eee' },
  itemLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#4a90e2', alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: '#4a90e2' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  itemText: { fontSize: 16, color: '#1a1a1a' },
  itemDone: { textDecorationLine: 'line-through', color: '#aaa' },
  deleteBtn: { color: '#e24a4a', fontSize: 14, textAlign: 'center' },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 40, fontSize: 15 },
  cardBtn: { backgroundColor: '#9b59b6', borderRadius: 10, padding: 14, marginTop: 12, alignItems: 'center' },
  cardBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  modal: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 60, paddingHorizontal: 20 },
  modalTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#1a1a1a' },
  cardItem: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10, borderWidth: 0.5, borderColor: '#eee' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardActions: { flexDirection: 'column', alignItems: 'center', gap: 4 },
  arrowBtn: { color: '#4a90e2', fontSize: 20, textAlign: 'center', paddingHorizontal: 8 },
  arrowBtnDisabled: { color: '#ddd' },
  cardShopName: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  cardNumber: { fontSize: 14, color: '#666' },
  codeTypeLabel: { fontSize: 12, color: '#aaa', marginTop: 2 },
  cardNumberLarge: { fontSize: 20, fontWeight: '600', color: '#1a1a1a', marginTop: 12 },
  addCardBtn: { backgroundColor: '#4a90e2', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  closeBtn: { backgroundColor: '#ddd', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  closeBtnText: { color: '#333', fontWeight: '600', fontSize: 15 },
  barcodeContainer: { backgroundColor: '#fff', borderRadius: 10, padding: 20, alignItems: 'center', marginVertical: 20 },
  logoPlaceholder: { width: 50, height: 50, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  logoPlaceholderText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  colorLabel: { fontSize: 14, color: '#666', marginTop: 16, marginBottom: 8 },
  colorRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  colorCircle: { width: 36, height: 36, borderRadius: 18 },
  colorCircleSelected: { borderWidth: 3, borderColor: '#1a1a1a' },
  presetItem: { alignItems: 'center', padding: 10, marginRight: 10, backgroundColor: '#fff', borderRadius: 10, borderWidth: 0.5, borderColor: '#eee', width: 70 },
  presetItemSelected: { borderColor: '#4a90e2', borderWidth: 2 },
  presetName: { fontSize: 10, color: '#666', marginTop: 4, textAlign: 'center' },
  codeTypeRow: { flexDirection: 'column', gap: 8 },
  codeTypeBtn: { backgroundColor: '#fff', borderRadius: 10, padding: 12, borderWidth: 0.5, borderColor: '#ddd' },
  codeTypeBtnSelected: { backgroundColor: '#4a90e2', borderColor: '#4a90e2' },
  codeTypeBtnText: { fontSize: 14, color: '#666', textAlign: 'center' },
  codeTypeBtnTextSelected: { color: '#fff', fontWeight: '600' },
});