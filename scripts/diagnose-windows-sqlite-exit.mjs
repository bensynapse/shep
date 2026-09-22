import Database from 'better-sqlite3';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.argv[2]) {
  let db;
  let code = 'OK';
  try {
    db = new Database(process.argv[2], { timeout: 0 });
    db.pragma('quick_check');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('mmap_size = 268435456');
    db.pragma('busy_timeout = 5000');
    db.exec('UPDATE probe SET value = value + 1');
    db.prepare('SELECT * FROM probe').all();
  } catch (error) {
    code = error.code;
    if (!code?.startsWith('SQLITE_BUSY')) console.error('SQLITE_EXIT_DIAGNOSTIC', JSON.stringify({code,stack:error.stack}));
  }
  if (process.argv[3] === 'clean') db?.close();
  process.send(code, () => process.exit(0));
} else {
  for (const mode of ['abrupt', 'clean']) {
    const dir = mkdtempSync(join(tmpdir(), 'shep-windows-sqlite-exit-'));
    const path = join(dir, 'data');
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO probe VALUES (1,0)');
    db.close();
    const counts = {};
    await Promise.all(Array.from({length: 4}, async () => {
      for (let i = 0; i < 75; i++) await new Promise((resolve, reject) => {
        const child = fork(fileURLToPath(import.meta.url), [path, mode]);
        child.on('message', code => { counts[code] = (counts[code] ?? 0) + 1; });
        child.on('error', reject);
        child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Child failed: ${code}`)));
      });
    }));
    const check = new Database(path);
    console.log('SQLITE_EXIT_COUNTS', mode, JSON.stringify(counts), JSON.stringify(check.pragma('quick_check')));
    check.close();
    rmSync(dir, {recursive:true, force:true});
  }
}
