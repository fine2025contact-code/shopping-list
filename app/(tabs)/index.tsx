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
type Card = { id: string; shopName: string; cardNumber: string };

const SHOPS = [{ id: '1', name: 'スーパー', latitude: 0, longitude: 0 }];
const NOTIFY_RADIUS = 200;

export default function HomeScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [text, setText] = useState('');
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [showCards, setShowCards] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [shopName, setShopName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [barcodeUrl, setBarcodeUrl] = useState<string>('');
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
    if (selectedCard) {
      try {
        const canvas = document.createElement('canvas');
        const bwipjs = require('@bwip-js/browser');
        bwipjs.toCanvas(canvas, {
          bcid: 'code128',
          text: selectedCard.cardNumber,
          scale: 3,
          height: 20,
          includetext: true,
        });
        setBarcodeUrl(canvas.toDataURL('image/png'));
      } catch (e) {
        console.log(e);
        setBarcodeUrl('');
      }
    } else {
      setBarcodeUrl('');
    }
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
      createdAt: Date.now()
    });
    setShopName('');
    setCardNumber('');
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
                <Text style={styles.cardShopName}>{card.shopName}</Text>
                <Text style={styles.cardNumber}>{card.cardNumber}</Text>
                <TouchableOpacity onPress={() => deleteCard(card.id)}>
                  <Text style={styles.deleteBtn}>削除</Text>
                </TouchableOpacity>
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
          <Text style={styles.modalTitle}>{selectedCard?.shopName}</Text>
          <View style={styles.barcodeContainer}>
            {barcodeUrl ? (
              <img src={barcodeUrl} style={{ width: '100%', height: 120 }} alt="barcode" />
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
  cardShopName: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 4 },
  cardNumber: { fontSize: 14, color: '#666', marginBottom: 8 },
  cardNumberLarge: { fontSize: 20, fontWeight: '600', color: '#1a1a1a', marginTop: 12 },
  addCardBtn: { backgroundColor: '#4a90e2', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  closeBtn: { backgroundColor: '#ddd', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 10 },
  closeBtnText: { color: '#333', fontWeight: '600', fontSize: 15 },
  barcodeContainer: { backgroundColor: '#fff', borderRadius: 10, padding: 20, alignItems: 'center', marginVertical: 20 },
});