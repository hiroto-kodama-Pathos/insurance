// 第三課題（社会保険料計算アプリ）の Cloud Functions
import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions";

initializeApp();

// 予期しないアクセスの集中で費用がかさまないように、同時に動く数を抑える
setGlobalOptions({ maxInstances: 10 });

export { createSiAccount, listSiAccounts, removeSiAccess, updateSiAccount } from "./accounts.js";
export { deleteMistakenEmployee, purgeRetiredEmployees } from "./purge.js";
