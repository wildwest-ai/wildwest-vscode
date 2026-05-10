import * as fs from 'fs';
import * as path from 'path';

export interface Wire {
  schema_version: '1';
  wwuid: string;
  wwuid_type: 'wire';
  from: string;
  to: string;
  type: string;
  date: string;
  subject: string;
  status: 'sent' | 'delivered' | 'acked' | 'archived';
  body: string;
  filename: string;
  ack_status?: string;
  original_wire?: string;
}

interface WiresIndex {
  wires: Wire[];
}

export class WireStorageService {
  private wireDir: string;
  private indexPath: string;

  constructor(exportPath: string) {
    this.wireDir = path.join(exportPath, 'staged', 'storage', 'wires');
    this.indexPath = path.join(exportPath, 'staged', 'storage', 'wires-index.json');
  }

  write(wire: Wire): void {
    fs.mkdirSync(this.wireDir, { recursive: true });
    fs.writeFileSync(path.join(this.wireDir, `${wire.wwuid}.json`), JSON.stringify(wire, null, 2), 'utf8');
    this.upsertIndex(wire);
  }

  updateStatus(wwuid: string, status: Wire['status'], ackStatus?: string): void {
    const filePath = path.join(this.wireDir, `${wwuid}.json`);
    if (!fs.existsSync(filePath)) return;
    const wire = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Wire;
    wire.status = status;
    if (ackStatus !== undefined) wire.ack_status = ackStatus;
    fs.writeFileSync(filePath, JSON.stringify(wire, null, 2), 'utf8');
    this.upsertIndex(wire);
  }

  list(filter?: { status?: string; to?: string; from?: string }): Wire[] {
    const index = this.readIndex();
    return index.wires.filter((w) => {
      if (filter?.status && w.status !== filter.status) return false;
      if (filter?.to && w.to !== filter.to) return false;
      if (filter?.from && w.from !== filter.from) return false;
      return true;
    });
  }

  getByWwuid(wwuid: string): Wire | null {
    const filePath = path.join(this.wireDir, `${wwuid}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Wire;
    } catch {
      return null;
    }
  }

  private readIndex(): WiresIndex {
    if (!fs.existsSync(this.indexPath)) return { wires: [] };
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf8')) as WiresIndex;
    } catch {
      return { wires: [] };
    }
  }

  private upsertIndex(wire: Wire): void {
    const index = this.readIndex();
    const i = index.wires.findIndex((w) => w.wwuid === wire.wwuid);
    if (i >= 0) {
      index.wires[i] = wire;
    } else {
      index.wires.push(wire);
    }
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }
}
