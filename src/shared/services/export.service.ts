import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { TransactionService } from './transaction.service';
import { CategoryService } from './category.service';
import { AccountService } from './account.service';

@Injectable({ providedIn: 'root' })
export class ExportService {
  constructor(
    private transactionService: TransactionService,
    private categoryService: CategoryService,
    private accountService: AccountService
  ) {}

  // On Android: writes to the app cache and opens the share sheet (Drive,
  // WhatsApp, email...). On the web: regular file download.
  async exportFile(filename: string, content: string, mimeType: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      await Share.share({ title: filename, files: [uri] });
      return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  buildCsv(): string {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = ['date,type,category,account,to_account,amount,note'];
    for (const t of this.transactionService.sorted()) {
      const category = t.categoryId ? this.categoryService.byId(t.categoryId)?.name ?? '' : '';
      const account = this.accountService.byId(t.accountId)?.name ?? '';
      const toAccount = t.toAccountId ? this.accountService.byId(t.toAccountId)?.name ?? '' : '';
      rows.push(
        [t.date, t.type, escape(category), escape(account), escape(toAccount), t.amount, escape(t.note ?? '')].join(',')
      );
    }
    return rows.join('\n');
  }
}
