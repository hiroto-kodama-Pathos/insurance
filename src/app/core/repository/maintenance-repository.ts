// 誤登録の従業員の削除（Cloud Functions を呼ぶ。設計書 2.19）
// サブコレクション・給与・賞与もまとめて消し、月次確定に含まれているかをサーバーで確かめるため、管理者だけが呼び出せる関数を通す。
import { inject, Service } from '@angular/core';
import { EmployeeRepository } from './employee-repository';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

@Service()
export class MaintenanceRepository {
  private readonly employeeRepo = inject(EmployeeRepository);

  /** 誤って登録した従業員を削除する（月次確定に一度も含まれていない人だけ） */
  async deleteMistakenEmployee(employeeId: string): Promise<void> {
    try {
      await httpsCallable(functions, 'deleteMistakenEmployee')({ employeeId });
    } finally {
      // 使い回している従業員の一覧から、削除した人を消す
      this.employeeRepo.clearCache();
    }
  }
}
