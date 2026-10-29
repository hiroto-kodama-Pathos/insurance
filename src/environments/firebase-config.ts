// Firebase の接続設定
// firebaseConfig は Firebase コンソールの「プロジェクトの設定」→「マイアプリ」のウェブアプリの値を貼る。
// 第二課題と同じプロジェクト（kensyu10170）なので、第二課題で使っている値と同じでよい。
// この値は公開されても問題ない（読み書きの制限はセキュリティルールで行う）。

export const firebaseConfig = {
  apiKey: 'AIzaSyArQPUkXjLent4Nqby18F9AaQevD3zggtk',
  authDomain: 'kensyu10170.firebaseapp.com',
  projectId: 'kensyu10170',
  storageBucket: 'kensyu10170.firebasestorage.app',
  messagingSenderId: '801098494264',
  appId: '1:801098494264:web:1fa69b3a6368380a4851cd',
};

/**
 * true のあいだは、本番ではなくローカルのエミュレータにつなぐ。
 * 第二課題と共用の本番データベースを、開発中に書き換えないため。
 * 本番にデプロイするときだけ false にする。
 */
export const useEmulators = true;
