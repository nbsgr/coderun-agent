import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const SQL = await initSqlJs();
  
  const appData = process.env.APPDATA;
  const globalStorage = path.join(appData, 'Code', 'User', 'globalStorage', 'Bala-Siva-Ganesh.ai-agent');
  
  console.log('=== Global Storage Directory ===');
  console.log(globalStorage);
  console.log('');
  
  const regPath = path.join(globalStorage, 'registry.db');
  if (fs.existsSync(regPath)) {
    const buf = fs.readFileSync(regPath);
    const db = new SQL.Database(buf);
    console.log('=== registry.db ===');
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    for (const t of tables) {
      const name = t.values[0][0];
      console.log('\nTable:', name);
      const rows = db.exec('SELECT * FROM "' + name + '"');
      if (rows.length && rows[0].values.length) {
        console.log('  Columns:', rows[0].columns.join(', '));
        for (const row of rows[0].values) {
          console.log('  Row:', row.join(' | '));
        }
      } else {
        console.log('  (empty)');
      }
    }
    db.close();
  } else {
    console.log('registry.db not found yet — run the extension first');
  }
  
  console.log('');
  
  const projectsDir = path.join(globalStorage, 'projects');
  if (fs.existsSync(projectsDir)) {
    const projects = fs.readdirSync(projectsDir);
    console.log('=== Projects (' + projects.length + ') ===');
    for (const p of projects) {
      const indexPath = path.join(projectsDir, p, 'index.db');
      if (fs.existsSync(indexPath)) {
        const buf = fs.readFileSync(indexPath);
        const db = new SQL.Database(buf);
        console.log('\nProject:', p);
        const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
        for (const t of tables) {
          const name = t.values[0][0];
          const cnt = db.exec('SELECT COUNT(*) FROM "' + name + '"');
          const count = cnt.length ? cnt[0].values[0][0] : 0;
          console.log('  ' + name + ':', count, 'rows');
        }
        db.close();
      }
    }
  } else {
    console.log('No projects folder yet');
  }
  
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
