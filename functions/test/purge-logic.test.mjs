// 退職者データの消去の判定のテスト（npm test で実行。lib にビルドしたものを読む）
import assert from "node:assert/strict";
import { test } from "node:test";
import { addYears, anonymizeRows, anonymousId, findPurgeTargets, jstDate, lastClosedDates, purgeDueDate, retiredOn } from "../lib/purge-logic.js";

test("退職・死亡で資格を失った人だけが対象（在籍中・未加入・加入の条件から外れた人は対象外）", () => {
  assert.equal(retiredOn([{ acquiredDate: "2020-04-01", lostDate: "2026-11-01", lostReason: "retirement" }]), "2026-11-01");
  assert.equal(retiredOn([{ acquiredDate: "2020-04-01", lostDate: null }]), null);
  assert.equal(retiredOn([]), null);
  assert.equal(retiredOn([{ acquiredDate: "2020-04-01", lostDate: "2026-11-01", lostReason: "conditions" }]), null);
  // 再入社して加入中なら対象外
  assert.equal(retiredOn([
    { acquiredDate: "2018-04-01", lostDate: "2019-04-01", lostReason: "retirement" },
    { acquiredDate: "2022-04-01", lostDate: null },
  ]), null);
});

test("保管期間は、最後の月次確定と資格喪失日の遅いほうから数える", () => {
  assert.equal(addYears("2024-02-29", 2), "2026-02-28");
  assert.equal(purgeDueDate("2026-11-01", null, 2), "2028-11-01");
  assert.equal(purgeDueDate("2026-11-01", "2027-01-05", 2), "2029-01-05");
  assert.equal(purgeDueDate("2026-11-01", "2026-10-20", 5), "2031-11-01");
});

test("今日消去する人", () => {
  const employees = [
    { id: "a", qualifications: [{ acquiredDate: "2020-04-01", lostDate: "2024-04-01", lostReason: "retirement" }] },
    { id: "b", qualifications: [{ acquiredDate: "2020-04-01", lostDate: "2024-04-01", lostReason: "retirement" }] },
    { id: "c", qualifications: [{ acquiredDate: "2020-04-01", lostDate: null }] },
  ];
  // b は退職後の2024-11-10に訂正の確定があったので、まだ消さない
  const closed = new Map([["b", "2024-11-10"]]);
  assert.deepEqual(findPurgeTargets(employees, closed, 2, "2026-10-30").map((t) => t.employeeId), ["a"]);
  assert.deepEqual(findPurgeTargets(employees, closed, 2, "2026-11-10").map((t) => t.employeeId), ["a", "b"]);
});

test("月次確定の行は、氏名・社員番号・従業員IDを匿名IDにし、金額は残す", () => {
  const rows = [
    { employeeId: "a", employeeNumber: "0001", name: "山田 太郎", premiums: { health: 1 } },
    { employeeId: "c", employeeNumber: "0003", name: "鈴木 一郎", premiums: { health: 2 } },
  ];
  const out = anonymizeRows(rows, new Set(["a"]));
  const anon = anonymousId("a");
  assert.match(anon, /^退職者-[0-9a-f]{8}$/);
  assert.deepEqual(out[0], { employeeId: anon, employeeNumber: anon, name: anon, premiums: { health: 1 } });
  assert.equal(out[1], rows[1]);
  assert.equal(anonymizeRows(rows, new Set(["x"])), null);
  assert.equal(anonymousId("a"), anon);
});

test("その人を含む最後の確定の日（日本時間）", () => {
  assert.equal(jstDate("2026-10-31T16:00:00.000Z"), "2026-11-01");
  const map = lastClosedDates([
    { closedAt: "2026-09-05T01:00:00.000Z", rows: [{ employeeId: "a", employeeNumber: "", name: "" }] },
    { closedAt: "2026-10-05T01:00:00.000Z", rows: [], bonusRows: [{ employeeId: "a", employeeNumber: "", name: "" }] },
    { closedAt: null, rows: [{ employeeId: "b", employeeNumber: "", name: "" }] },
  ]);
  assert.equal(map.get("a"), "2026-10-05");
  assert.equal(map.has("b"), false);
});
