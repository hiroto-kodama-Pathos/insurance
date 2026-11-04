// Firebase の初期化。アプリ全体でこの db・auth を使う。
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { firebaseConfig, useEmulators } from '../../environments/firebase-config';

export const firebaseApp = initializeApp(firebaseConfig);

/** 第二課題と同じ (default) データベース */
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);
/** Cloud Functions（アカウントの発行・変更。東京リージョン） */
export const functions = getFunctions(firebaseApp, 'asia-northeast1');

if (useEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
