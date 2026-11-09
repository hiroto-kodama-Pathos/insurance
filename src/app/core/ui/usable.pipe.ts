import { Pipe, PipeTransform } from '@angular/core';

/**
 * 選べるマスタだけにする：@for (o of offices() | usable: officeId(); ...)
 * 「使わない」にしたマスタ（archived）は新しく選べないので外す。ただし、今選ばれているもの（直す前の値）は残す
 * （履歴を直すときに、元の値が選択肢から消えて別の値に変わってしまわないように。設計書 3.10）
 */
@Pipe({ name: 'usable' })
export class UsablePipe implements PipeTransform {
  transform<T extends { id: string; archived?: boolean }>(list: readonly T[] | null | undefined, current?: string | null): T[] {
    return (list ?? []).filter((x) => !x.archived || x.id === current);
  }
}
