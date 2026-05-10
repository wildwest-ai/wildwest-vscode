import * as fs from 'fs';
import * as path from 'path';

export interface Memo {
  schema_version: '1';
  wwuid: string;
  wwuid_type: 'memo';
  from: string;
  to: string;
  type: string;
  date: string;
  subject: string;
  status: 'sent' | 'delivered' | 'acked' | 'archived';
  body: string;
  filename: string;
  ack_status?: string;
  original_memo?: string;
}

interface MemosIndex {
  memos: Memo[];
}

export class MemoStorageService {
  private memoDir: string;
  private indexPath: string;

  constructor(exportPath: string) {
    this.memoDir = path.join(exportPath, 'staged', 'storage', 'memos');
    this.indexPath = path.join(exportPath, 'staged', 'storage', 'memos-index.json');
  }

  write(memo: Memo): void {
    fs.mkdirSync(this.memoDir, { recursive: true });
    fs.writeFileSync(path.join(this.memoDir, `${memo.wwuid}.json`), JSON.stringify(memo, null, 2), 'utf8');
    this.upsertIndex(memo);
  }

  updateStatus(wwuid: string, status: Memo['status'], ackStatus?: string): void {
    const filePath = path.join(this.memoDir, `${wwuid}.json`);
    if (!fs.existsSync(filePath)) return;
    const memo = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Memo;
    memo.status = status;
    if (ackStatus !== undefined) memo.ack_status = ackStatus;
    fs.writeFileSync(filePath, JSON.stringify(memo, null, 2), 'utf8');
    this.upsertIndex(memo);
  }

  list(filter?: { status?: string; to?: string; from?: string }): Memo[] {
    const index = this.readIndex();
    return index.memos.filter((m) => {
      if (filter?.status && m.status !== filter.status) return false;
      if (filter?.to && m.to !== filter.to) return false;
      if (filter?.from && m.from !== filter.from) return false;
      return true;
    });
  }

  getByWwuid(wwuid: string): Memo | null {
    const filePath = path.join(this.memoDir, `${wwuid}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Memo;
    } catch {
      return null;
    }
  }

  private readIndex(): MemosIndex {
    if (!fs.existsSync(this.indexPath)) return { memos: [] };
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as MemosIndex;
    } catch {
      return { memos: [] };
    }
  }

  private upsertIndex(memo: Memo): void {
    const index = this.readIndex();
    const i = index.memos.findIndex((m) => m.wwuid === memo.wwuid);
    if (i >= 0) {
      index.memos[i] = memo;
    } else {
      index.memos.push(memo);
    }
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }
}
