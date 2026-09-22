import Database from 'better-sqlite3';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[2]) {
  const codes = {};
  for (let i = 0; i < 2000; i++) {
    let db;
    try {
      db = new Database(process.argv[2], { timeout: 0 });
      db.pragma('quick_check');
      db.pragma('journal_mode = WAL');
      db.prepare('SELECT * FROM probe').all();
    } catch (error) {
      codes[error.code] = (codes[error.code] ?? 0) + 1;
      if (!error.code?.startsWith('SQLITE_BUSY') && codes[error.code] <= 3) {
        console.error('NATIVE_SQLITE_DIAGNOSTIC', JSON.stringify({code:error.code,message:error.message,stack:error.stack}));
      }
    } finally {
      db?.close();
    }
  }
  process.send(codes);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'shep-windows-sqlite-'));
  const path = join(dir, 'data');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY); INSERT INTO probe VALUES (1)');
  db.close();
  const reports = await Promise.all(Array.from({length: 8}, () => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), [path]);
    let report;
    child.on('message', message => { report = message; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(report) : reject(new Error(`Child failed: ${code}`)));
  })));
  console.log('NATIVE_SQLITE_COUNTS', JSON.stringify(reports));
  const check = new Database(path);
  console.log('POST_STRESS_INTEGRITY', JSON.stringify(check.pragma('quick_check')));
  check.close();
  rmSync(dir, {recursive:true, force:true});
}
