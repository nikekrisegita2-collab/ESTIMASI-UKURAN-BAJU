// ---------------------------------------------------------------------------
// Tabel patokan ukuran S/M/L/XL berdasarkan tinggi badan & lingkar dada (cm).
// GANTI angka-angka di bawah sesuai standar yang kamu pakai (SNI, standar
// toko, atau hasil survei manual kamu sendiri) — ini hanya contoh awal.
//
// Aturan pencocokan: dada diprioritaskan (karena baju biasanya dipilih dari
// lingkar dada), tinggi badan dipakai sebagai info tambahan/validasi, bukan
// penentu utama. Kalau kamu ingin sebaliknya, tinggal ubah urutan pengecekan
// di classifyUkuran().
// ---------------------------------------------------------------------------

const TABEL_UKURAN = [
  { size: 'S', dada: [80, 88], tinggi: [150, 162] },
  { size: 'M', dada: [88, 96], tinggi: [158, 168] },
  { size: 'L', dada: [96, 104], tinggi: [165, 175] },
  { size: 'XL', dada: [104, 112], tinggi: [172, 182] },
];

/**
 * Mengubah lebar dada hasil sensor laser (jarak lurus, satu sisi + mirroring)
 * menjadi estimasi lingkar dada. Formula pendekatan: keliling elips dengan
 * asumsi rasio depan:belakang tubuh manusia rata-rata.
 * SESUAIKAN faktor `0.5` di bawah setelah kamu validasi dengan pengukuran
 * manual (meteran) ke beberapa sampel orang.
 */
function konversiLingkarDada(lebarDadaCm) {
  const FAKTOR_KELILING = Math.PI * 0.5; // ganti setelah kalibrasi manual
  return Math.round(lebarDadaCm * FAKTOR_KELILING * 100) / 100;
}

/**
 * Cocokkan tinggi badan (cm) & lingkar dada (cm) ke tabel ukuran.
 * Mengembalikan { size, catatan }.
 */
function classifyUkuran(tinggiBadan, lingkarDada) {
  if (tinggiBadan == null || lingkarDada == null) {
    return { size: null, catatan: 'Data tinggi/dada belum lengkap' };
  }

  // Cari kecocokan penuh (dada DAN tinggi masuk rentang)
  const cocokPenuh = TABEL_UKURAN.find(
    (t) =>
      lingkarDada >= t.dada[0] && lingkarDada <= t.dada[1] &&
      tinggiBadan >= t.tinggi[0] && tinggiBadan <= t.tinggi[1]
  );
  if (cocokPenuh) return { size: cocokPenuh.size, catatan: 'Sesuai rentang normal' };

  // Kalau tidak cocok penuh, cocokkan berdasarkan dada saja (lebih prioritas)
  const cocokDada = TABEL_UKURAN.find(
    (t) => lingkarDada >= t.dada[0] && lingkarDada <= t.dada[1]
  );
  if (cocokDada) {
    return { size: cocokDada.size, catatan: 'Cocok dari lingkar dada, tinggi di luar rentang umum' };
  }

  // Di luar semua rentang: ambil yang terdekat supaya tidak kosong
  let terdekat = TABEL_UKURAN[0];
  let selisihMin = Infinity;
  for (const t of TABEL_UKURAN) {
    const tengahDada = (t.dada[0] + t.dada[1]) / 2;
    const selisih = Math.abs(lingkarDada - tengahDada);
    if (selisih < selisihMin) {
      selisihMin = selisih;
      terdekat = t;
    }
  }
  return { size: terdekat.size, catatan: 'Di luar rentang tabel, dibulatkan ke ukuran terdekat' };
}

module.exports = { classifyUkuran, konversiLingkarDada, TABEL_UKURAN };
