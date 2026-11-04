import { Pipe, PipeTransform } from '@angular/core';
import { dateLabel, yearMonthLabel } from '../calc/year-month';

/** テンプレートで年月を「2026年11月」の形で出す：{{ yearMonth() | ym }}。年月の並び（配列）は「・」でつなぐ */
@Pipe({ name: 'ym' })
export class YearMonthPipe implements PipeTransform {
  transform(value: string | readonly string[] | null | undefined): string {
    return Array.isArray(value) ? value.map((v) => yearMonthLabel(v)).join('・') : yearMonthLabel(value as string | null | undefined);
  }
}

/** テンプレートで日付を「2026年11月19日」の形で出す：{{ x.paidDate | ymd }}。日付の並び（配列）は「・」でつなぐ */
@Pipe({ name: 'ymd' })
export class DateLabelPipe implements PipeTransform {
  transform(value: string | readonly string[] | null | undefined): string {
    return Array.isArray(value) ? value.map((v) => dateLabel(v)).join('・') : dateLabel(value as string | null | undefined);
  }
}
