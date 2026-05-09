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
  Platform,
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
type Shop = { id: string; name: string; latitude: number; longitude: number };

const SHOPS: Shop[] = [
  { id: '1', name: 'スーパー', latitude: 0, longitude: 0 },
];

const NOTIFY_RADIUS = 200;

export default function HomeScreen() {
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [nearbyShop, setNearbyShop] = useState<string | null>(null);
  const notifiedShops = useRef<Set<string>>(new Set());

  useEffect(() => {
    const q = query(collection(db, 'items'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snapshot => {
      setItems(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Item)));
    });
    return unsub;
  }, []);

  useEffect(() => {
    setupLocationAndNotifications();
  }, []);

  const setupLocationAndNotifications = async () => {
    const { status: notifStatus } = await Notifications.requestPermissionsAsync();
    if (notifStatus !== 'granted') {
      Alert.alert('通知の許可が必要です');
      return;
    }
    const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
    if (locStatus !== 'granted') {
      Alert.alert('位置情報の許可が必要です');
      return;
    }
    await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 50 },
      (loc) => {
        setLocation(loc);
        checkNearbyShops(loc);
      }
    );
  };

  const checkNearbyShops = (loc: Location.LocationObject) => {
    SHOPS.forEach(shop => {
      if (shop.latitude === 0) return;
      const dist = getDistance(
        loc.coords.latitude, loc.coords.longitude,
        shop.latitude, shop.longitude
      );
      if (dist < NOTIFY_RADIUS && !notifiedShops.current.has(shop.id)) {
        notifiedShops.current.add(shop.id);
        setNearbyShop(shop.name);
        Notifications.scheduleNotificationAsync({
          content: {
            title: `${shop.name}に到着しました`,
            body: '買い物リストを確認してください',
          },
          trigger: null,
        });
      }
    });
  };

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  };

  const addItem = async () => {
    if (!text.trim()) return;
    await addDoc(collection(db, 'items'), {
      name: text.trim(), done: false, createdAt: Date.now()
    });
    setText('');
  };

  const toggleItem = async (id: string, done: boolean) => {
    await updateDoc(doc(db, 'items', id), { done: !done });
  };

  const deleteItem = async (id: string) => {
    await deleteDoc(doc(db, 'items', id));
  };

  const saveShopLocation = async () => {
    if (!location) {
      Alert.alert('位置情報を取得中です。少し待ってください。');
      return;
    }
    SHOPS[0].latitude = location.coords.latitude;
    SHOPS[0].longitude = location.coords.longitude;
    Alert.alert('お店の場所を登録しました', `緯度: ${location.coords.latitude.toFixed(4)}\n経度: ${location.coords.longitude.toFixed(4)}`);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Text style={styles.title}>買い物リスト</Text>

      {nearbyShop && (
        <View style={styles.nearbyBanner}>
          <Text style={styles.nearbyText}>{nearbyShop}に到着しました</Text>
        </View>
      )}

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

      <TouchableOpacity style={styles.shopBtn} onPress={saveShopLocation}>
        <Text style={styles.shopBtnText}>現在地をお店として登録</Text>
      </TouchableOpacity>

      {location && (
        <Text style={styles.locationText}>
          現在地: {location.coords.latitude.toFixed(4)}, {location.coords.longitude.toFixed(4)}
        </Text>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5', paddingTop: 60, paddingHorizontal: 20 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 12, color: '#1a1a1a' },
  nearbyBanner: { backgroundColor: '#4a90e2', borderRadius: 10, padding: 12, marginBottom: 12 },
  nearbyText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
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
  shopBtn: { backgroundColor: '#2ecc71', borderRadius: 10, padding: 14, marginTop: 12, alignItems: 'center' },
  shopBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  locationText: { textAlign: 'center', color: '#aaa', fontSize: 12, marginTop: 8 },
});