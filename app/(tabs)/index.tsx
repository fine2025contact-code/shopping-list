import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  addDoc,
  collection,
  deleteDoc,
  doc, onSnapshot,
  orderBy,
  query,
  updateDoc
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

type Item = { id: string; name: string; done: boolean; createdAt: number };
type Card = { id: string; shopName: string; cardNumber: string; logoUrl?: string };

const SHOPS = [{ id: '1', name: 'スーパー', latitude: 0, longitude: 0 }];
const NOTIFY_RADIUS = 200;

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

export default function HomeScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState('');
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [showCards, setShowCards] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [shopName, setShopName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [barcodeUrl, setBarcodeUrl] = useState('');
  const notifiedShops = useRef<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(db, 'items'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snapshot => {
      setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Item)));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'cards'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snapshot => {
      setCards(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Card)));
    });
    return unsub;
  }, []);

  useEffect(() => { setupLocationAndNotifications(); }, []);

  useEffect(() => {
    if (!selectedCard) { setBarcodeUrl(''); return; }
    if (typeof document === 'undefined') return;
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 100;
    drawBarcode(canvas, selectedCard.cardNumber);
    setBarcodeUrl(canvas.toDataURL('image/png'));
  }, [selectedCard]);

  const setupLocationAndNotifications = async () => {
    const { status: notifStatus } = await Notifications.requestPermissionsAsync();
    if (notifStatus !== 'granted') return;
    const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
    if (locStatus !== 'granted') return;
    await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 50 },
      (loc) => { setLocation(loc); checkNearbyShops(loc); }
    );
  };

  const checkNearbyShops = (loc: Location.LocationObject) => {
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

  const addItem = async () => {
    if (!text.trim()) return;
    await addDoc(collection(db, 'items'), { name: text.trim(), done: false, createdAt: Date.now() });
    setText('');
  };

  const toggleItem = async (id: string, done: boolean) => {
    await updateDoc(doc(db, 'items', id), { done: !done });
  };

  const deleteItem = async (id: string) => {
    await deleteDoc(doc(db, 'items', id));
  };

  const addCard = async () => {
    if (!shopName.trim() || !cardNumber.trim()) {
      Alert.alert('お店の名前とカード番号を入力してください');
      return;
    }
    await addDoc(collection(db, 'cards'), {
      shopName: shopName.trim(),
      cardNumber: cardNumber.trim(),
      logoUrl: logoUrl.trim(),
      createdAt: Date.now()
    });
    setShopName('');
    setCardNumber('');
    setLogoUrl('');
    setShowAddCard(false);
  };

  const deleteCard = async (id: string) => {
    await deleteDoc(doc(db, 'cards', id));
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={styles.title}>買い物リスト</Text>

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

      {/* ポイントカード一覧モーダル */}
      <Modal visible={showCards} animationType="slide">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>ポイントカード</Text>
          <ScrollView>
            {cards.map(card => (
              <TouchableOpacity key={card.id} style={styles.cardItem}
                onPress={() => { setSelectedCard(card); setShowCards(false); }}>
                <View style={styles.cardHeader}>
                  {card.logoUrl ? (
                    // @ts-ignore
                    <img src={card.logoUrl} style={{ width: 50, height: 50, objectFit: 'contain', marginRight: 12, borderRadius: 8 }} alt="logo" />
                  ) : (
                    <View style={styles.logoPlaceholder}>
                      <Text style={styles.logoPlaceholderText}>{card.shopName[0]}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardShopName}>{card.shopName}</Text>
                    <Text style={styles.cardNumber}>{card.cardNumber}</Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteCard(card.id)}>
                    <Text style={styles.deleteBtn}>削除</Text>
                  </TouchableOpacity>
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

      {/* カード追加モーダル */}
      <Modal visible={showAddCard} animationType="slide">
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>カードを追加</Text>
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
          <TouchableOpacity style={[styles.addCardBtn, { marginTop: 16 }]} onPress={addCard}>
            <Text style={styles.addBtnText}>保存</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setShowAddCard(false)}>
            <Text style={styles.closeBtnText}>キャンセル</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* バーコード表示モーダル */}
      <Modal visible={!!selectedCard} animationType="slide">
        <View style={styles.modal}>
          <View style={styles.cardHeader}>
            {selectedCard?.logoUrl ? (
              // @ts-ignore
              <img src={selectedCard.logoUrl} style={{ width: 60, height: 60, objectFit: 'contain', marginRight: 12, borderRadius: 8 }} alt="logo" />
            ) : (
              <View style={styles.logoPlaceholder}>
                <Text style={styles.logoPlaceholderText}>{selectedCard?.shopName[0]}</Text>
              </View>
            )}
            <Text style={styles.modalTitle}>{selectedCard?.shopName}</Text>
          </View>
          <View style={styles.barcodeContainer}>
            {barcodeUrl ? (
              // @ts-ignore
              <img src={barcodeUrl} style={{ width: 300, height: 100 }} alt="barcode" />
            ) : (
              <Text style={styles.empty}>バーコードを生成中...</Text>
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
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 60, paddingHorizontal: 20 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 12, color: '#1a1a1a' },
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
  deleteBtn: { color: '#e24a4a', fontSize: 14 },
  empty: { textAlign: 'center', color: '#aaa', marginTop: 40, fontSize: 15 },
  cardBtn: { backgroundColor: '#9b59b6', borderRadius: 10, padding: 14, marginTop: 12, alignItems: 'center' },
  cardBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  modal: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 60, paddingHorizontal: 20 },
  modalTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, color: '#1a1a1a' },
  cardItem: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10, borderWidth: 0.5, borderColor: '#eee' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardShopName: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  cardNumber: { fontSize: 14, color: '#666' },
  cardNumberLarge: { fontSize: 20, fontWeight: '600', color: '#1a1a1a', marginTop: 12 },
  addCardBtn: { backgroundColor: '#4a90e2', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  closeBtn: { backgroundColor: '#ddd', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  closeBtnText: { color: '#333', fontWeight: '600', fontSize: 15 },
  barcodeContainer: { backgroundColor: '#fff', borderRadius: 10, padding: 20, alignItems: 'center', marginVertical: 20 },
  logoPlaceholder: { width: 50, height: 50, borderRadius: 8, backgroundColor: '#4a90e2', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  logoPlaceholderText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
});