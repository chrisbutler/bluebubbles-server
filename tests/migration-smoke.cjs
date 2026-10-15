// Run with Electron in Node mode; argument must be a disposable copy of config.db.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ts = require('../packages/server/node_modules/typescript');
const { minify } = require('terser');
const { DataSource } = require('typeorm');
(async () => {
  const migrationDir = path.resolve(__dirname, '../packages/server/src/server/databases/server/migrations');
  const migrations = [];
  for (const file of fs.readdirSync(migrationDir).filter(n => n.endsWith('.ts'))) {
    const js = ts.transpileModule(fs.readFileSync(path.join(migrationDir, file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const result = await minify(js, { toplevel: true, keep_classnames: false });
    const exports = {};
    vm.runInNewContext(result.code, { exports, require: n => n === '@server' ? { Server: () => ({ log() {} }) } : require(n) });
    for (const Migration of Object.values(exports)) {
      const instance = new Migration();
      if (!/\d{13}$/.test(instance.name)) throw new Error('Missing stable migration name in ' + file);
      migrations.push(Migration);
    }
  }
  const db = new DataSource({ type: 'better-sqlite3', database: process.argv[2], entities: [], migrations, migrationsRun: true });
  await db.initialize();
  const columns = await db.query('PRAGMA table_info(contact)');
  if (!columns.some(c => c.name === 'external_id')) throw new Error('Migration did not add external_id');
  console.log('Minified migration check passed; copied database migrated successfully.');
  await db.destroy();
})().catch(e => { console.error(e.message); process.exitCode = 1; });
