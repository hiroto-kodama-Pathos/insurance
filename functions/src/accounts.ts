// アカウントの発行・変更（設計書 4章 セキュリティルール・3章 設定）
// カスタムクレーム（siRole・siScope）は Admin SDK でしか設定できないため、管理者だけが呼び出せる関数で行う。
// 第二課題と同じ Firebase Authentication を使うので、アカウントは削除せず、第三課題の権限を外して止める。
import { getAuth, UserRecord } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { CallableRequest, HttpsError, onCall } from "firebase-functions/v2/https";

const REGION = "asia-northeast1";
const SI = "apps/socialInsurance";

export type SiRole = "admin" | "staff";

/** 一覧に返すアカウント */
export type AccountView = {
  uid: string;
  email: string;
  siRole: SiRole | null;
  siScope: string | null;
  disabled: boolean;
  lastSignIn: string | null;
};

function toView(u: UserRecord): AccountView {
  const c = u.customClaims ?? {};
  return {
    uid: u.uid,
    email: u.email ?? "",
    siRole: c.siRole === "admin" || c.siRole === "staff" ? c.siRole : null,
    siScope: typeof c.siScope === "string" ? c.siScope : null,
    disabled: u.disabled,
    lastSignIn: u.metadata.lastSignInTime ?? null,
  };
}

/** 呼び出した人が第三課題の管理者か */
function requireAdmin(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError("unauthenticated", "ログインしてください");
  if (req.auth.token.siRole !== "admin") throw new HttpsError("permission-denied", "アカウントを管理できるのは管理者だけです");
  return req.auth.uid;
}

/** 権限と担当範囲を確かめる（管理者の担当範囲は常に全担当） */
async function checkClaims(role: unknown, scope: unknown): Promise<{ siRole: SiRole; siScope: string }> {
  if (role !== "admin" && role !== "staff") throw new HttpsError("invalid-argument", "権限を選んでください");
  if (role === "admin") return { siRole: "admin", siScope: "all" };
  if (typeof scope !== "string" || scope === "") throw new HttpsError("invalid-argument", "担当範囲を選んでください");
  if (scope !== "all") {
    const office = await getFirestore().doc(`${SI}/offices/${scope}`).get();
    if (!office.exists) throw new HttpsError("invalid-argument", "担当範囲の適用事業所が見つかりません");
  }
  return { siRole: "staff", siScope: scope };
}

/** 第三課題の権限がある（または以前あった）アカウントの一覧 */
export const listSiAccounts = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const list: AccountView[] = [];
  let pageToken: string | undefined;
  do {
    const page = await getAuth().listUsers(1000, pageToken);
    for (const u of page.users) if (u.customClaims && ("siRole" in u.customClaims || "siRoleRemoved" in u.customClaims)) list.push(toView(u));
    pageToken = page.pageToken;
  } while (pageToken);
  return list.sort((a, b) => a.email.localeCompare(b.email));
});

/**
 * アカウントを発行する。すでにあるメールアドレス（第二課題のアカウントなど）なら、そのアカウントに第三課題の権限を付ける
 * 新しく作るときは、管理者が決めた初期パスワードを設定する（本人に別の方法で伝え、変えてもらう）
 */
export const createSiAccount = onCall({ region: REGION }, async (req) => {
  requireAdmin(req);
  const { email, password, siRole, siScope } = req.data ?? {};
  if (typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError("invalid-argument", "メールアドレスを正しく入力してください");
  const claims = await checkClaims(siRole, siScope);
  const auth = getAuth();
  let user: UserRecord;
  let created = false;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    if (typeof password !== "string" || password.length < 8) throw new HttpsError("invalid-argument", "初期パスワードを8文字以上で入力してください");
    user = await auth.createUser({ email, password });
    created = true;
  }
  const others = { ...(user.customClaims ?? {}) };
  delete others.siRoleRemoved;
  await auth.setCustomUserClaims(user.uid, { ...others, ...claims });
  return { uid: user.uid, created };
});

/** 権限・担当範囲を変える。自分の管理者の権限は外せない（管理者がいなくならないように） */
export const updateSiAccount = onCall({ region: REGION }, async (req) => {
  const me = requireAdmin(req);
  const { uid, siRole, siScope } = req.data ?? {};
  if (typeof uid !== "string" || uid === "") throw new HttpsError("invalid-argument", "アカウントを選んでください");
  const claims = await checkClaims(siRole, siScope);
  if (uid === me && claims.siRole !== "admin") throw new HttpsError("failed-precondition", "自分の管理者の権限は外せません");
  const user = await getAuth().getUser(uid);
  const others = { ...(user.customClaims ?? {}) };
  delete others.siRoleRemoved;
  await getAuth().setCustomUserClaims(uid, { ...others, ...claims });
  // 変えた権限は、次にトークンを取り直したときから効く。すぐに効かせるため、ログイン中のトークンを無効にする
  await getAuth().revokeRefreshTokens(uid);
  return { uid };
});

/** 第三課題を使えないようにする（第二課題など、ほかの権限は残す）。自分は止められない */
export const removeSiAccess = onCall({ region: REGION }, async (req) => {
  const me = requireAdmin(req);
  const { uid } = req.data ?? {};
  if (typeof uid !== "string" || uid === "") throw new HttpsError("invalid-argument", "アカウントを選んでください");
  if (uid === me) throw new HttpsError("failed-precondition", "自分のアカウントは止められません");
  const user = await getAuth().getUser(uid);
  const others = { ...(user.customClaims ?? {}) };
  delete others.siRole;
  delete others.siScope;
  // 一覧に残すため、権限を外したことを記録しておく
  await getAuth().setCustomUserClaims(uid, { ...others, siRoleRemoved: true });
  await getAuth().revokeRefreshTokens(uid);
  return { uid };
});
