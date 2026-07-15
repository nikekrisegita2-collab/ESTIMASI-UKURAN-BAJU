const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = path.join(__dirname, 'fitviz.db');

let db;
try {
  db = new DatabaseSync(dbPath);

  // Busy timeout saja (tanpa WAL) supaya init cepat & tidak hang saat startup.
  // WAL mode sempat menyebabkan proses initialization hang tanpa error di
  // beberapa environment deploy, jadi sengaja tidak diaktifkan.
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
  } catch (e) {
    console.error('Gagal set PRAGMA busy_timeout, melanjutkan tanpa itu:', e.message);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT DEFAULT 'default',
      height REAL,
      chest REAL,
      waist REAL,
      shoulder REAL,
      size TEXT,
      size_note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      fit_type TEXT DEFAULT 'Slim Fit',
      sleeve TEXT DEFAULT 'Panjang',
      pocket TEXT DEFAULT 'Tanpa Saku',
      collar TEXT DEFAULT 'Classic Point',
      height REAL,
      chest REAL,
      waist REAL,
      shoulder REAL,
      status TEXT DEFAULT 'Menunggu Fitting',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrasi ringan: kalau fitviz.db lama sudah ada dari sebelum kolom size
  // ditambahkan, ALTER TABLE di sini akan menambahkannya. Aman diulang-ulang
  // karena dibungkus try/catch (SQLite akan error kalau kolom sudah ada).
  for (const kolom of ['size TEXT', 'size_note TEXT']) {
    try {
      db.exec(`ALTER TABLE sensor_readings ADD COLUMN ${kolom}`);
    } catch (e) {
      // kolom sudah ada, abaikan
    }
  }

  // Migrasi: tambah kolom size di tabel profiles (untuk menyimpan estimasi ukuran)
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN size TEXT`);
  } catch (e) {
    // kolom sudah ada, abaikan
  }

  // Seed one example sensor reading if table is empty, so the UI has something
  // to show on first run (remove this block if you don't want demo data).
  try {
    const countRow = db.prepare('SELECT COUNT(*) AS c FROM sensor_readings').get();
    if (countRow.c === 0) {
      db.prepare(
        `INSERT INTO sensor_readings (device_id, height, chest, waist, shoulder) VALUES (?, ?, ?, ?, ?)`
      ).run('demo-device', 175, 102, 88, 46);
    }
  } catch (e) {
    console.error('Gagal seed data demo sensor_readings:', e.message);
  }
} catch (err) {
  console.error('Gagal inisialisasi database SQLite:', err.message);
  throw err;
}

module.exports = db;
