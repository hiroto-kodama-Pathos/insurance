// 適用除外（設計書 2.22）
// 種類と期間（届出に書く該当年月日・非該当年月日）を登録すると、該当する保険だけを0円にする。
import { ageReachedDate, is75OrOlderOn } from './age';
import { addDays } from './bonus-premium';
import { Exemption, exemptedInsurances } from './eligibility';
import { isValidDate } from './new-employee';
import { dateLabel } from './year-month';

export type ExemptionType = Exemption['type'];

export const EXEMPTION_LABEL: Record<ExemptionType, string> = {
  care: '介護保険（国外居住・適用除外施設への入所など）',
  healthNhiUnion: '健康保険（国民健康保険組合）',
  healthLateElderly: '健康保険（後期高齢者医療の障害認定）',
  healthAgreement: '健康保険（社会保障協定）',
  pensionAgreement: '厚生年金（社会保障協定）',
};

/** 0円にする保険 */
export const EXEMPTION_TARGETS: Record<ExemptionType, string> = {
  care: '介護保険',
  healthNhiUnion: '健康保険・介護保険・支援金',
  healthLateElderly: '健康保険・介護保険・支援金',
  healthAgreement: '健康保険・介護保険・支援金',
  pensionAgreement: '厚生年金',
};

/** 入力欄の注記（届出に書く日） */
export const EXEMPTION_DATE_HINT: Record<ExemptionType, string> = {
  care: '国外転出・施設入所は、その日の翌日。帰国して住所を持った日・施設の退所日が非該当の日',
  healthNhiUnion: '承認日',
  healthLateElderly: '後期高齢者医療の障害認定日',
  healthAgreement: '適用証明書の期間',
  pensionAgreement: '適用証明書の期間',
};

/** 届け出ること（日本年金機構の案内による）。deadline は画面に出す期限の文、deadlineDate は期限の日（日付で決まらないものは null） */
export function exemptionNotice(type: ExemptionType, startDate: string): { name: string; deadline: string; deadlineDate: string | null } {
  switch (type) {
    case 'care':
      return { name: '介護保険適用除外等該当・非該当届', deadline: '遅滞なく', deadlineDate: null };
    case 'healthNhiUnion': {
      const d = addDays(startDate, 14);
      return { name: '健康保険被保険者適用除外承認申請書', deadline: `${dateLabel(d)}まで（事実発生日から14日以内）`, deadlineDate: d };
    }
    case 'healthLateElderly': {
      const d = addDays(startDate, 5);
      return { name: '健康保険被保険者資格喪失届（後期高齢者医療の被保険者になるため）', deadline: `${dateLabel(d)}まで（5日以内）`, deadlineDate: d };
    }
    default:
      return { name: '適用証明書の写しを添えた届出（年金事務所の案内に沿って）', deadline: '適用証明書の交付後、速やかに', deadlineDate: null };
  }
}

export type ExemptionInput = { type: ExemptionType; startDate: string; endDate: string };
export type ExemptionErrors = Partial<Record<'type' | 'startDate' | 'endDate', string>>;

/**
 * 追加・終了日の変更のチェック（同じ種類の期間は重ねない）。
 * 生年月日を渡すと、後期高齢者医療の障害認定は65歳以上75歳未満の人だけにする（障害認定は65〜74歳の人が受けるもの。
 * 75歳からは障害認定なしで後期高齢者医療の被保険者になり、資格喪失で扱う。年齢の誤りで健康保険料を0円にしないため）
 */
export function checkExemption(
  existing: (Exemption & { id: string })[],
  input: ExemptionInput,
  editingId: string | null = null,
  birthDate: string | null = null,
): ExemptionErrors {
  const e: ExemptionErrors = {};
  if (!isValidDate(input.startDate)) e.startDate = '該当年月日を正しく入力してください';
  else if (input.type === 'healthLateElderly' && birthDate && isValidDate(birthDate)) {
    if (input.startDate < ageReachedDate(birthDate, 65))
      e.startDate = '後期高齢者医療の障害認定は、65歳以上75歳未満の人が受けるものです。この日はまだ65歳になっていません（生年月日と認定日を確かめてください）';
    else if (is75OrOlderOn(birthDate, input.startDate))
      e.startDate = '75歳からは、障害認定なしで後期高齢者医療の被保険者になります。適用除外ではなく、75歳の誕生日での資格喪失として登録してください';
  }
  if (input.endDate !== '' && !isValidDate(input.endDate)) e.endDate = '非該当年月日を正しく入力してください';
  else if (input.endDate !== '' && isValidDate(input.startDate) && input.endDate <= input.startDate)
    e.endDate = '非該当年月日は該当年月日より後の日にしてください';
  if (Object.keys(e).length > 0) return e;
  const end = input.endDate === '' ? '9999-12-31' : input.endDate;
  const overlap = existing.some(
    (x) => x.id !== editingId && x.type === input.type && x.startDate < end && (x.endDate === null || input.startDate < x.endDate),
  );
  if (overlap) e.startDate = '同じ種類の適用除外の期間と重なっています';
  return e;
}

/** その月に0円にしている保険（一覧の「適用除外」の表示用）。なければ空文字 */
export function exemptionNote(exemptions: Exemption[], yearMonth: string): string {
  const x = exemptedInsurances(exemptions, yearMonth);
  const names = [x.health ? '健康保険・介護保険・支援金' : x.care ? '介護保険' : '', x.pension ? '厚生年金' : ''].filter((n) => n);
  return names.length ? `適用除外（${names.join('・')}）` : '';
}
