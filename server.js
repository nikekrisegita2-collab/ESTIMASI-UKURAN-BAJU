require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const mqtt = require('mqtt');
const db = require('./db');
const { classifyUkuran } = require('./sizeTable');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Route eksplisit untuk root — harus sebelum express.static agar
// tidak di-override oleh default index.html dari folder public.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index_new.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers ----------
function toNumberOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Satu fungsi yang dipakai bersama oleh endpoint HTTP maupun subscriber MQTT,
// supaya data yang masuk dari jalur mana pun selalu diklasifikasikan dengan
// cara yang sama sebelum disimpan.
function simpanBacaanSensor({ device_id, height, chest, waist, shoulder }) {
  const h = toNumberOrNull(height);
  const c = toNumberOrNull(chest);
  const w = toNumberOrNull(waist);
  const s = toNumberOrNull(shoulder);

  if (h === null && c === null && w === null && s === null) {
    return { error: 'Minimal satu nilai ukuran harus dikirim (height, chest, waist, shoulder).' };
  }

  // Klasifikasi ukuran langsung di sini (server), berdasarkan tinggi & dada.
  const { size, catatan } = classifyUkuran(h, c);

  const stmt = db.prepare(
    `INSERT INTO sensor_readings (device_id, height, chest, waist, shoulder, size, size_note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(device_id || 'unknown-device', h, c, w, s, size, catatan);

  return db.prepare('SELECT * FROM sensor_readings WHERE id = ?').get(info.lastInsertRowid);
}

// ---------- MQTT subscriber (data langsung dari mikrokontroler) ----------
// Atur lewat environment variable, misal di file .env atau saat menjalankan:
//   MQTT_BROKER_URL=mqtt://alamat-broker:1883
//   MQTT_TOPIC=sensor/ukuran-baju
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://gerbil.rmq.cloudamqp.com';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'sensor/ukuran-baju';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'wxpvavbg:wxpvavbg';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'P_-kUISpxl-uBkWCzIRCvQYrYOAOY6z3';

const mqttOptions = {};
if (MQTT_USERNAME) mqttOptions.username = MQTT_USERNAME;
if (MQTT_PASSWORD) mqttOptions.password = MQTT_PASSWORD;

const mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

// --- SSE Setup ---
let sseClients = [];

app.get('/api/sensor/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // Segera kirim headers ke client

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

function broadcastSensorData(data) {
  sseClients.forEach(client => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}
// -----------------

mqttClient.on('connect', () => {
  console.log(`MQTT terhubung ke ${MQTT_BROKER_URL}, subscribe topic "${MQTT_TOPIC}"`);
  mqttClient.subscribe(MQTT_TOPIC, (err) => {
    if (err) console.error('Gagal subscribe MQTT:', err.message);
  });
});

mqttClient.on('error', (err) => {
  console.error('MQTT error:', err.message);
});

mqttClient.on('message', (topic, messageBuffer) => {
  if (topic !== MQTT_TOPIC) return;
  try {
    // Payload yang diharapkan dari mikrokontroler, contoh:
    // { "device_id": "esp32-01", "height": 167, "chest": 94 }
    const payload = JSON.parse(messageBuffer.toString());
    const hasil = simpanBacaanSensor(payload);
    if (hasil.error) {
      console.warn('Data MQTT ditolak:', hasil.error, payload);
    } else {
      console.log(`Data sensor tersimpan dari MQTT (id=${hasil.id}, size=${hasil.size})`);
      broadcastSensorData(hasil); // Kirim data real-time ke index.html
    }
  } catch (e) {
    console.error('Error saat memproses payload MQTT:', e);
    console.error('Payload mentah:', messageBuffer.toString());
  }
});

// ---------- Sensor endpoints (untuk alat IoT / ESP32 / Arduino) ----------

// Endpoint HTTP tetap dipertahankan (berguna untuk testing manual lewat
// Postman/curl tanpa perlu publish MQTT, dan sebagai fallback).
app.post('/api/sensor', (req, res) => {
  const hasil = simpanBacaanSensor(req.body || {});
  if (hasil.error) return res.status(400).json({ error: hasil.error });
  broadcastSensorData(hasil); // Kirim update real-time via SSE
  res.status(201).json(hasil);
});

// Frontend mengambil data sensor terbaru untuk ditampilkan di kartu atas
app.get('/api/sensor/latest', (req, res) => {
  const row = db.prepare('SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 1').get();
  if (!row) return res.status(404).json({ error: 'Belum ada data sensor.' });
  res.json(row);
});

// Riwayat semua pembacaan sensor (opsional, untuk grafik/riwayat nanti)
app.get('/api/sensor/history', (req, res) => {
  const rows = db.prepare('SELECT * FROM sensor_readings ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

// ---------- Profile / order endpoints (Kustomisasi & Fitting) ----------

app.get('/api/profiles', (req, res) => {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY id DESC').all();
  res.json(rows);
});

app.get('/api/profiles/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Profil tidak ditemukan.' });
  res.json(row);
});

app.post('/api/profiles', (req, res) => {
  const {
    name, fit_type, sleeve, pocket, collar,
    height, chest, waist, shoulder, size,
  } = req.body || {};

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Nama pesanan/profil wajib diisi.' });
  }

  const stmt = db.prepare(`
    INSERT INTO profiles (name, fit_type, sleeve, pocket, collar, height, chest, waist, shoulder, size)
    VALUES (@name, @fit_type, @sleeve, @pocket, @collar, @height, @chest, @waist, @shoulder, @size)
  `);

  const info = stmt.run({
    name: String(name).trim(),
    fit_type: fit_type || 'Slim Fit',
    sleeve: sleeve || 'Panjang',
    pocket: pocket || 'Tanpa Saku',
    collar: collar || 'Classic Point',
    height: toNumberOrNull(height),
    chest: toNumberOrNull(chest),
    waist: toNumberOrNull(waist),
    shoulder: toNumberOrNull(shoulder),
    size: size || null,
  });

  const saved = db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(saved);
});

// Update status fitting, misalnya "Menunggu Fitting" -> "Sudah Fitting"
app.patch('/api/profiles/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Status wajib diisi.' });

  const existing = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Profil tidak ditemukan.' });

  db.prepare(`UPDATE profiles SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, req.params.id);

  const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/profiles/:id', (req, res) => {
  const info = db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Profil tidak ditemukan.' });
  res.status(204).end();
});

// Fallback: serve the SPA for any other route
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index_new.html'));
});

app.listen(PORT, () => {
  console.log(`FitViz server berjalan di http://localhost:${PORT}`);
});
