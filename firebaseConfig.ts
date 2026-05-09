import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC4aO87v3JV0ltomhFyf4v2CJhs1Oz_pa8",
  authDomain: "shopping-list-8795f.firebaseapp.com",
  projectId: "shopping-list-8795f",
  storageBucket: "shopping-list-8795f.firebasestorage.app",
  messagingSenderId: "844687216841",
  appId: "1:844687216841:web:3ecd5ad5521376f66c3d18"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);