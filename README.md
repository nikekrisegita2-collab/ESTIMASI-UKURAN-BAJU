# FitViz — Web Kustomisasi Kemeja & Data Sensor

Aplikasi web full-stack: frontend (single-page, tema dark sesuai desain asli) + backend
Node.js/Express + database SQLite bawaan Node (`node:sqlite`, tanpa perlu install
database eksternal seperti MySQL/PostgreSQL).

## Struktur Proyek

```
fitviz/
├── server.js         # Server Express + semua route API
├── db.js             # Setup & skema database SQLite
├── package.json
├── public/
│   └── index.html    # Frontend single-page (Kustomisasi + Fitting)
└── fitviz.db          # File database (dibuat otomatis saat server pertama kali jalan)
```

## Cara Menjalankan (Lokal)

Prasyarat: **Node.js versi 22.5 atau lebih baru** (menyediakan modul `node:sqlite`).

```bash
cd fitviz
npm install
npm start
```

Buka `http://localhost:3000` di browser. Server otomatis membuat file `fitviz.db`
dan mengisi satu data sensor contoh saat pertama kali dijalankan.

> Modul `node:sqlite` masih berstatus *experimental* di Node.js sehingga akan muncul
> peringatan `ExperimentalWarning` di konsol — ini aman diabaikan. Jika Anda ingin
> memakai database lain (MySQL/PostgreSQL) di kemudian hari, cukup ganti isi `db.js`
> dan bagian query di `server.js`, struktur route API tidak perlu berubah.

## Fitur

- **Kustomisasi Kemeja**: pilih Tipe Fit, Lengan, Saku, dan Kerah — semua pilihan
  tersimpan di state browser lalu dikirim ke server saat tombol **Simpan Data** ditekan.
- **Data Sensor Terbaru**: menampilkan pembacaan sensor (Tinggi, Dada, Pinggang, Bahu)
  paling baru dari database, dengan tombol refresh manual.
- **Tab Fitting — Daftar Pesanan**: menampilkan semua pesanan/profil yang tersimpan,
  lengkap dengan status ("Menunggu Fitting" / "Sudah Fitting") yang bisa diubah, dan
  tombol hapus.
- **Tab Fitting — Sketsa & Virtual Fitting 2D**: ketuk salah satu pesanan di daftar
  (atau tombol "Lihat Sketsa") untuk membuka sketsa tubuh + kemeja custom dalam bentuk
  vektor (SVG) yang **digambar otomatis** berdasarkan data sensor (tinggi, dada,
  pinggang, bahu) dan pilihan kustomisasi (tipe fit, panjang lengan, saku, kerah)
  pesanan tersebut. Dilengkapi:
  - Tombol **zoom in / zoom out**
  - Tombol **download** (menyimpan sketsa sebagai file PNG)
  - Tombol **Simpan Desain** (menyimpan ulang kombinasi ini sebagai pesanan baru,
    mirip tombol Simpan Data, dengan nama yang bisa diubah)
- Notifikasi toast untuk konfirmasi aksi (simpan, update status, hapus, error).

## API Endpoints

### Sensor (untuk alat IoT)

| Method | Endpoint              | Keterangan                                   |
|--------|------------------------|-----------------------------------------------|
| POST   | `/api/sensor`          | Alat sensor mengirim data pengukuran baru     |
| GET    | `/api/sensor/latest`   | Ambil pembacaan sensor paling baru            |
| GET    | `/api/sensor/history`  | Ambil 50 riwayat pembacaan terakhir           |

Contoh body `POST /api/sensor` (JSON):

```json
{
  "device_id": "esp32-01",
  "height": 175,
  "chest": 102,
  "waist": 88,
  "shoulder": 46
}
```

Semua field ukuran opsional, tapi minimal satu harus diisi.

### Profil / Pesanan (Kustomisasi & Fitting)

| Method | Endpoint                     | Keterangan                             |
|--------|-------------------------------|------------------------------------------|
| GET    | `/api/profiles`               | Daftar semua pesanan tersimpan          |
| GET    | `/api/profiles/:id`           | Detail satu pesanan                      |
| POST   | `/api/profiles`                | Simpan pesanan baru                     |
| PATCH  | `/api/profiles/:id/status`    | Ubah status fitting                      |
| DELETE | `/api/profiles/:id`           | Hapus pesanan                            |

## Menghubungkan Alat Sensor (IoT / ESP32 / Arduino)

Karena Anda belum punya alatnya, backend sudah menyediakan endpoint siap pakai:
`POST /api/sensor`. Saat alat sensor sudah ada, contoh kode ESP32 (Arduino, via WiFi)
untuk mengirim data setiap kali selesai mengukur:

```cpp
#include <WiFi.h>
#include <HTTPClient.h>

void sendSensorData(float height, float chest, float waist, float shoulder) {
  HTTPClient http;
  http.begin("http://ALAMAT_SERVER_ANDA:3000/api/sensor");
  http.addHeader("Content-Type", "application/json");

  String payload = "{\"device_id\":\"esp32-01\",\"height\":" + String(height) +
                    ",\"chest\":" + String(chest) +
                    ",\"waist\":" + String(waist) +
                    ",\"shoulder\":" + String(shoulder) + "}";

  int httpCode = http.POST(payload);
  http.end();
}
```

Ganti `ALAMAT_SERVER_ANDA` dengan IP/hostname server setelah di-deploy. Selama
sensor dan server berada di jaringan yang sama, alat tinggal HTTP POST ke endpoint
ini setiap kali ada pengukuran baru — frontend akan otomatis menampilkannya begitu
tombol refresh ditekan (atau Anda bisa menambahkan polling otomatis nanti).

### Menghubungkan via MQTT (sudah aktif)

Server sekarang juga otomatis subscribe ke broker MQTT saat dijalankan (lihat
`server.js`). Atur alamat broker dan topic lewat environment variable:

```bash
MQTT_BROKER_URL=mqtt://alamat-broker-kamu:1883 MQTT_TOPIC=sensor/ukuran-baju npm start
```

Kalau tidak diset, default-nya `mqtt://localhost:1883` dan topic
`sensor/ukuran-baju`. Payload yang dikirim mikrokontroler harus JSON, contoh:

```json
{ "device_id": "esp32-01", "height": 167, "chest": 94 }
```

Setiap pesan yang masuk lewat topic ini akan otomatis disimpan ke database
**dan langsung diklasifikasikan ukurannya** (lihat bagian di bawah), sama
seperti kalau dikirim lewat `POST /api/sensor`.

## Klasifikasi Ukuran (S/M/L/XL)

Logika klasifikasi ada di `sizeTable.js`, terpisah dari `server.js` supaya
mudah diubah/diuji. Alurnya:

1. Data tinggi & lebar dada masuk (dari MQTT atau HTTP).
2. `konversiLingkarDada()` mengubah lebar dada hasil sensor laser menjadi
   estimasi lingkar dada (masih pakai faktor perkiraan — **wajib kamu
   kalibrasi ulang** dengan pengukuran manual ke beberapa sampel orang).
3. `classifyUkuran()` mencocokkan tinggi & lingkar dada ke `TABEL_UKURAN`.
4. Hasil (`size` dan `size_note`) disimpan ke database bersama data mentah,
   lalu ikut dikirim di response `/api/sensor/latest` dan `/api/sensor/history`
   — jadi frontend tinggal menampilkan, tanpa perlu hitung apa-apa lagi.

**PENTING**: angka-angka di `TABEL_UKURAN` (dalam `sizeTable.js`) masih
contoh/placeholder. Ganti dengan standar ukuran yang kamu pakai (SNI, standar
toko tertentu, atau hasil survei manual) sebelum dipakai untuk laporan/sidang.

## Deploy ke Server Sungguhan

Aplikasi ini adalah Node.js biasa, jadi bisa di-deploy ke platform apa pun yang
mendukung Node 22+, misalnya:

- **VPS** (DigitalOcean, dsb.): install Node 22+, jalankan `npm install && npm start`,
  lalu gunakan process manager seperti `pm2` agar tetap jalan di background.
- **Railway / Render / Fly.io**: cukup hubungkan repo, platform akan otomatis
  menjalankan `npm install` dan `npm start`.

Pastikan folder tempat `fitviz.db` disimpan bersifat *persistent* (tidak terhapus
saat redeploy), atau pindahkan ke database terkelola (managed database) jika perlu
skala lebih besar.

## Langkah Selanjutnya (opsional)

- Tambah autentikasi (login) jika lebih dari satu penjahit/toko memakai aplikasi ini.
- Tambah grafik riwayat sensor dari waktu ke waktu (data historis sudah tersedia lewat `/api/sensor/history`).
- Tambah upload foto/preview kemeja sesuai kustomisasi.
