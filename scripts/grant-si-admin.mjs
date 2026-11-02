// 本番（kensyu10170）の最初の管理者を決める（運営者が一度だけ使う）
// アカウントの発行・権限の変更はアプリの「アカウントと権限」で管理者が行うが、最初の管理者だけはアプリからは作れないため、
// Admin SDK で、すでにある Firebase Authentication のアカウントに、第三課題の管理者の権限（siRole: admin・siScope: all）を付ける。
//
// 使い方（鍵の場所の指定は load-grades.mjs の先頭と同じ）：
//   1. Firebase コンソール → Authentication → ユーザー で、管理者にするアカウント（メールアドレス・パスワード）があることを確かめる
//      なければ「ユーザーを追加」で作る（パスワードはこのスクリプトに渡さない）
//   2. 確認だけ：node scripts/grant-si-admin.mjs メールアドレス
//      付ける  ：node scripts/grant-si-admin.mjs メールアドレス --yes
//   3. アプリでログインし直すと、管理者として使える（ログイン中なら、いったんログアウトしてから）
//
// 第二課題で付けた権限（カスタムクレーム）は消さずに残し、siRole・siScope だけを足す。
import { getAuth } from 'firebase-admin/auth';
import { checkEnvironment, openSi, PROJECT_ID, shouldWrite } from './lib/admin.mjs';

const email = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!email) {
  console.error('管理者にするアカウントのメールアドレスを指定してください：node scripts/grant-si-admin.mjs メールアドレス');
  process.exit(1);
}
checkEnvironment();
openSi(); // Admin SDK を初期化する

const auth = getAuth();
let user;
try {
  user = await auth.getUserByEmail(email);
} catch {
  console.error(`${PROJECT_ID} に ${email} のアカウントがありません。Firebase コンソール → Authentication → 「ユーザーを追加」で作ってから、やり直してください。`);
  process.exit(1);
}
const current = user.customClaims ?? {};
console.log(`対象：${PROJECT_ID}（本番）の ${email}`);
console.log(`今の権限（カスタムクレーム）：${JSON.stringify(current)}`);
const next = { ...current, siRole: 'admin', siScope: 'all' };
delete next.siRoleRemoved;
console.log(`付けたあと　　　　　　　　　：${JSON.stringify(next)}`);

if (!shouldWrite) {
  console.log('\n確認だけ行いました（変えていません）。付けるときは --yes を付けて実行してください。');
  process.exit(0);
}
await auth.setCustomUserClaims(user.uid, next);
console.log('\n第三課題の管理者の権限を付けました。アプリでログインし直してください。');
process.exit(0);
