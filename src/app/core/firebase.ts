// Firebase の初期化。アプリ全体でこの db・auth を使う。
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { firebaseConfig, useEmulators } from '../../environments/firebase-config';

export const firebaseApp = initializeApp(firebaseConfig);

/** 第二課題と同じ (default) データベース */
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);

if (useEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
