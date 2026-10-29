// 第三課題のデータは、すべて apps/socialInsurance の下に置く（第二課題のデータと分けるため）。
// コレクションの参照は、必ずこの関数を通して作る。
// 注意：第二課題のルールに collectionGroup('tasks') があるため、'tasks' という名前のコレクションは作らない。
import { collection, CollectionReference, doc, DocumentReference } from 'firebase/firestore';
import { db } from './firebase';

const ROOT = ['apps', 'socialInsurance'] as const;

/** apps/socialInsurance/{name} */
export function siCol(name: string): CollectionReference {
  return collection(db, ...ROOT, name);
}

/** apps/socialInsurance/{name}/{id} */
export function siDoc(name: string, id: string): DocumentReference {
  return doc(db, ...ROOT, name, id);
}

/** apps/socialInsurance/employees/{employeeId}/{sub} */
export function employeeSubCol(employeeId: string, sub: string): CollectionReference {
  return collection(db, ...ROOT, 'employees', employeeId, sub);
}

/** apps/socialInsurance/closings/{yearMonth}/offices（月次確定の事業所ごとの結果） */
export function closingOfficesCol(yearMonth: string): CollectionReference {
  return collection(db, ...ROOT, 'closings', yearMonth, 'offices');
}
