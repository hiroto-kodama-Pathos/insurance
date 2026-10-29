import { monthEnd } from './date';

//所属事業所の履歴
export type Assignment = {
  validFrom: string; //従業員がその事業所に所属した日
  officeId: string; //事業所ID
}

//適用事業所の
export type Office = {
id: string; //事業所ID
name: string; //事業所名
prefecture: string; //都道府県
insurerId: string; //保険者ID
isDefault?: boolean; //新規登録で初めから選んでおく事業所（本社など）
}

/**
 * 基準日に所属している適用事業所を返す
 *
 * 異動日当日は、新しい事業所の所属とする（異動日に元の事業所で資格を失い、新しい事業所で資格を取るため）。
 *
 * @param assignments 所属事業所の履歴（順番は問わない）
 * @param offices 適用事業所の一覧
 * @param date 基準日 'YYYY-MM-DD'（月額は monthlyBaseDate、賞与は支給日）
 * @throws 基準日に所属している事業所がないとき、または事業所が一覧にないとき
 */
export function findOffice(assignments: Assignment[], offices: Office[], date: string): Office {
    const current = assignments
    .filter((a) => a.validFrom <= date)
    .reduce<Assignment | null>(
      (latest, a) => (latest === null || a.validFrom > latest.validFrom ? a : latest),
      null,
    );
 
  if (current === null) {
    throw new Error(`${date} 時点で所属している事業所がありません`);
  }
 
  const office = offices.find((o) => o.id === current.officeId);
  if (!office) {
    throw new Error(`事業所 ${current.officeId} が登録されていません`);
  }
  return office;
}
 
/** 月額の保険料で所属事業所を決める基準日（対象月の末日） */
export function monthlyBaseDate(yearMonth: string): string {
  return monthEnd(yearMonth);
}

/**
 * 新規登録で初めから選んでおく事業所
 * 事業所が1つだけならそれ、複数ならデフォルトに設定した事業所。どちらでもなければ空
 */
export function defaultOfficeId(offices: Office[]): string {
  if (offices.length === 1) return offices[0].id;
  return offices.find((o) => o.isDefault)?.id ?? '';
}
