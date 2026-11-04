// 担当範囲でのクエリの絞り込み（設計書 4章 セキュリティルール）
// 特定の適用事業所の担当者は、セキュリティルールで担当事業所のデータしか読めない。
// Firestore はルールで読めないドキュメントを含むクエリを丸ごと拒否するので、クエリにも担当事業所の条件を付けて投げる。
import { QueryConstraint, where } from 'firebase/firestore';
import { Auth } from '../auth/auth';

/** 担当事業所のID（全担当なら null） */
export function scopedOffice(auth: Auth): string | null {
  const s = auth.user()?.siScope ?? 'all';
  return s === 'all' ? null : s;
}

/** 担当事業所で絞り込む条件（全担当なら条件なし） */
export function scopeWhere(auth: Auth, field = 'officeId'): QueryConstraint[] {
  const office = scopedOffice(auth);
  return office ? [where(field, '==', office)] : [];
}

/** 従業員の絞り込み（これまでに所属した事業所 officeIds に担当事業所を含む人） */
export function employeeScopeWhere(auth: Auth): QueryConstraint[] {
  const office = scopedOffice(auth);
  return office ? [where('officeIds', 'array-contains', office)] : [];
}
