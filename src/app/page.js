"use client";

// 1. IMPOR LIBRARY YANG DIBUTUHKAN
import { useEffect, useState, useRef } from "react";
import mqtt from "mqtt";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
} from "recharts"; // Untuk grafik data
import {
  AlertTriangle,
  CheckCircle2,
  Wifi,
  Wind,
  Activity,
  Download,
  Settings2,
  Table2,
} from "lucide-react"; // Ikon antarmuka
import { motion } from "framer-motion"; // Untuk animasi elemen UI

export default function Dashboard() {
  // ==========================================
  // 2. DEKLARASI STATE (PENYIMPAN DATA UI)
  // ==========================================
  const [dataSensor, setDataSensor] = useState({
    kadar_gas: 0,
    status: "Menunggu...",
  });
  const [isConnected, setIsConnected] = useState(false);
  const [grafikData, setGrafikData] = useState([]); // Menyimpan array riwayat data untuk grafik & tabel
  const [batasBahaya, setBatasBahaya] = useState(2000); // State untuk mengatur tampilan UI Slider

  // ==========================================
  // 3. DEKLARASI REF (PENYIMPAN DATA LATAR BELAKANG)
  // ==========================================
  // useRef digunakan untuk menyimpan data yang tidak memicu render ulang (re-render) pada UI saat nilainya berubah
  const mqttClientRef = useRef(null);
  const waktuTelegramTerakhir = useRef(0); // Timer untuk mencegah bot Telegram melakukan spam
  const batasBahayaRef = useRef(2000); // Menyimpan nilai batas terkini agar bisa dibaca oleh fungsi MQTT di latar belakang

  // ==========================================
  // 4. FUNGSI PENGIRIMAN TELEGRAM
  // ==========================================
  const kirimTelegram = async (kadarGas, batas) => {
    const sekarang = Date.now();

    // Sistem Anti-Spam: Pesan hanya akan dikirim jika sudah lewat 10 detik dari pesan sebelumnya
    if (sekarang - waktuTelegramTerakhir.current < 10000) return;
    waktuTelegramTerakhir.current = sekarang;

    const token = "8887405090:AAGoVfRrWr7UDG33NQElmDy7wQF9qXJPBwo";
    const chatId = "6192187715";
    const pesan = `⚠️ PERINGATAN DARURAT!\nKebocoran gas LPG terdeteksi.\nKadar saat ini: ${kadarGas} PPM (Melewati batas toleransi ${batas} PPM)`;

    // Menembak API Telegram menggunakan HTTP Request biasa
    fetch(
      `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(pesan)}`,
    ).catch((err) => console.error("Gagal mengirim Telegram:", err));
  };

  // ==========================================
  // 5. LIFECYCLE COMPONENT (KONEKSI MQTT)
  // ==========================================
  useEffect(() => {
    // Membuka koneksi WebSockets ke server public HiveMQ saat halaman web pertama kali dibuka
    const client = mqtt.connect("ws://broker.hivemq.com:8000/mqtt", {
      clientId: "Nextjs_Dashboard_" + Math.random().toString(16).slice(2, 8),
    });

    mqttClientRef.current = client;

    // Jika koneksi berhasil...
    client.on("connect", () => {
      setIsConnected(true);
      // Mulai mendengarkan (subscribe) topik pengiriman data dari ESP32 (Wokwi)
      client.subscribe("mikrokontroller/kelvin/sensor-gas/data");
    });

    // Jika ada pesan baru masuk dari ESP32...
    client.on("message", (topic, message) => {
      if (topic === "mikrokontroller/kelvin/sensor-gas/data") {
        // Ekstrak data teks (String) menjadi objek JavaScript (JSON)
        const payload = JSON.parse(message.toString());
        setDataSensor(payload); // Perbarui tampilan kartu UI utama

        // Dapatkan format jam saat ini
        const waktuSekarang = new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        // Masukkan data baru ke dalam array grafik
        setGrafikData((prev) => {
          const newData = [
            ...prev,
            { waktu: waktuSekarang, gas: payload.kadar_gas },
          ];
          // Buang data paling lama jika jumlah data sudah lebih dari 20 (agar grafik tidak tumpang tindih)
          if (newData.length > 20) newData.shift();
          return newData;
        });

        // Evaluasi Keamanan: Bandingkan data sensor dengan nilai ambang batas terbaru
        if (payload.kadar_gas >= batasBahayaRef.current) {
          kirimTelegram(payload.kadar_gas, batasBahayaRef.current);
        }
      }
    });

    // Cleanup Function: Putuskan koneksi MQTT secara aman jika pengguna menutup tab browser
    return () => {
      if (client) client.end();
    };
  }, []); // Array kosong [] memastikan fungsi ini hanya berjalan satu kali saat halaman dimuat

  // ==========================================
  // 6. FUNGSI KONTROL SLIDER (KIRIM PERINTAH KE WOKWI)
  // ==========================================
  const ubahBatas = (e) => {
    const nilaiBaru = parseInt(e.target.value); // Ambil angka dari pergerakan slider

    setBatasBahaya(nilaiBaru); // Update UI slider
    batasBahayaRef.current = nilaiBaru; // Update variabel background untuk logika Telegram

    // Kirim pesan (Publish) ke Wokwi agar alat mengubah nilai batasnya secara sinkron
    if (mqttClientRef.current && isConnected) {
      mqttClientRef.current.publish(
        "mikrokontroller/kelvin/sensor-gas/batas",
        nilaiBaru.toString(),
      );
    }
  };

  // ==========================================
  // 7. FUNGSI EXPORT DATA (DOWNLOAD CSV)
  // ==========================================
  const downloadCSV = () => {
    if (grafikData.length === 0) return alert("Belum ada data untuk diunduh");

    // Membuat struktur kolom Excel
    const header = "Waktu,Kadar Gas (PPM)\n";
    // Menggabungkan seluruh isi array data menjadi baris teks yang dipisahkan koma
    const csvContent = grafikData
      .map((row) => `${row.waktu},${row.gas}`)
      .join("\n");

    // Mengonversi teks menjadi file fisik yang bisa diunduh oleh browser (Blob object)
    const blob = new Blob([header + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", `log_gas_${new Date().getTime()}.csv`);
    link.style.visibility = "hidden";

    // Memicu unduhan secara otomatis tanpa mengarahkan ke halaman baru
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Konfigurasi animasi transisi munculnya elemen antarmuka (Framer Motion)
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  // ==========================================
  // 8. STRUKTUR TAMPILAN ANTARMUKA (UI / HTML)
  // ==========================================
  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans overflow-x-hidden">
      <motion.div
        className="max-w-7xl mx-auto space-y-6"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.1 } } }} // Menampilkan elemen berurutan (Cascade Effect)
      >
        {/* BAGIAN 1: HEADER HALAMAN */}
        <motion.header
          variants={itemVariants}
          className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200"
        >
          <div>
            <h1 className="text-3xl font-bold text-slate-800 tracking-tight">
              Sistem Monitoring Terpusat
            </h1>
            <p className="text-slate-500 mt-1">
              Pemantauan Gas LPG Area Dapur Utama
            </p>
          </div>

          {/* Indikator Status Koneksi (Merah = Offline, Hijau = Online) */}
          <div
            className={`mt-4 md:mt-0 flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-colors duration-500 ${isConnected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
          >
            <span className="relative flex h-3 w-3">
              {isConnected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-3 w-3 ${isConnected ? "bg-green-500" : "bg-red-500"}`}
              ></span>
            </span>
            {isConnected ? "Sistem Online" : "Sistem Offline"}
          </div>
        </motion.header>

        {/* BAGIAN 2: GRID KARTU METRIK UTAMA (4 KOLOM) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Kartu 1: Menampilkan angka kuantitatif nilai gas (PPM) saat ini */}
          <motion.div
            variants={itemVariants}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between hover:shadow-md transition-shadow"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-slate-500 font-medium">Konsentrasi Gas</p>
                <h2 className="text-4xl lg:text-5xl font-black text-blue-600 mt-2">
                  {dataSensor.kadar_gas}{" "}
                  <span className="text-lg lg:text-xl text-slate-400 font-medium">
                    PPM
                  </span>
                </h2>
              </div>
              <div className="p-3 bg-blue-50 text-blue-500 rounded-xl">
                <Wind size={28} />
              </div>
            </div>

            {/* Bar indikator kemiringan bahaya (Progress Bar) */}
            <div className="mt-6 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <motion.div
                className={`h-full ${dataSensor.kadar_gas >= batasBahaya ? "bg-red-500" : "bg-blue-500"}`}
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.min((dataSensor.kadar_gas / 4095) * 100, 100)}%`,
                }} // Konversi nilai maksimum ESP32 (4095) menjadi 100% panjang bar
                transition={{ duration: 0.3 }}
              />
            </div>
          </motion.div>

          {/* Kartu 2: Menampilkan status AMAN/BAHAYA dengan ikon animasi dinamis */}
          <motion.div
            variants={itemVariants}
            className={`p-6 rounded-2xl shadow-sm border flex flex-col justify-center items-center text-center transition-colors duration-500 ${dataSensor.status === "BAHAYA" ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}
          >
            {dataSensor.status === "BAHAYA" ? (
              <AlertTriangle
                size={48}
                className="text-red-500 mb-2 animate-bounce"
              />
            ) : (
              <CheckCircle2 size={48} className="text-green-500 mb-2" />
            )}
            <h3
              className={`text-xl font-bold ${dataSensor.status === "BAHAYA" ? "text-red-700" : "text-green-700"}`}
            >
              STATUS: {dataSensor.status}
            </h3>
            <p
              className={`mt-1 text-xs ${dataSensor.status === "BAHAYA" ? "text-red-600/80" : "text-green-600/80"}`}
            >
              {dataSensor.status === "BAHAYA"
                ? "Evakuasi area segera!"
                : "Udara batas normal"}
            </p>
          </motion.div>

          {/* Kartu 3: Slider interaktif untuk mengubah ambang batas keamanan */}
          <motion.div
            variants={itemVariants}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center"
          >
            <div className="flex items-center gap-2 mb-4">
              <Settings2 size={20} className="text-slate-600" />
              <p className="text-slate-700 font-bold">Ambang Batas Alarm</p>
            </div>
            {/* Input Slider dibatasi minimal 1500 agar pengguna tidak asal mematikan alarm keamanan (Safety Practice) */}
            <input
              type="range"
              min="1500"
              max="4000"
              step="100"
              value={batasBahaya}
              onChange={ubahBatas}
              className="w-full accent-blue-600 cursor-pointer h-2 bg-slate-200 rounded-lg appearance-none"
            />
            <div className="flex justify-between mt-3 text-sm font-semibold">
              <span className="text-slate-400">1500</span>
              <span className="text-blue-600 px-2 py-1 bg-blue-50 rounded-lg">
                {batasBahaya}
              </span>
              <span className="text-slate-400">4000</span>
            </div>
          </motion.div>

          {/* Kartu 4: Identitas alat fisik (Mockup Hardware) yang sedang dipantau */}
          <motion.div
            variants={itemVariants}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center space-y-4 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-4">
              <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
                <Activity size={20} />
              </div>
              <div>
                <p className="text-xs text-slate-500">ID Perangkat</p>
                <p className="font-semibold text-slate-800 text-sm">
                  ESP32-NODE-01
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="p-3 bg-slate-100 text-slate-600 rounded-xl">
                <Wifi size={20} />
              </div>
              <div>
                <p className="text-xs text-slate-500">Jalur Transmisi</p>
                <p className="font-semibold text-slate-800 text-sm">
                  MQTT (HiveMQ)
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* BAGIAN 3: AREA VISUALISASI DATA BAWAH */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Panel Kiri (Memakan 2/3 layar): Grafik Riwayat Nilai Fluktuasi (Recharts) */}
          <motion.div
            variants={itemVariants}
            className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-[420px] flex flex-col"
          >
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              Fluktuasi Gas Real-time
            </h3>
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={grafikData}
                  margin={{ top: 10, right: 20, bottom: 20, left: 10 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="waktu"
                    stroke="#64748b"
                    fontSize={12}
                    tickMargin={15}
                  >
                    <Label
                      value="Waktu Penerimaan"
                      offset={-15}
                      position="insideBottom"
                      style={{ fill: "#475569", fontSize: 13, fontWeight: 500 }}
                    />
                  </XAxis>
                  <YAxis
                    stroke="#64748b"
                    fontSize={12}
                    domain={[0, 4095]}
                    tickCount={6}
                  >
                    <Label
                      value="Kadar Gas (PPM)"
                      angle={-90}
                      position="insideLeft"
                      offset={-5}
                      style={{
                        textAnchor: "middle",
                        fill: "#475569",
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    />
                  </YAxis>
                  <Tooltip
                    contentStyle={{
                      borderRadius: "12px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                  />

                  {/* Menampilkan Garis Merah statis sebagai indikator visual dari ambang batas */}
                  <Line
                    type="monotone"
                    dataKey={() => batasBahaya}
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={false}
                  />

                  {/* Menampilkan Garis Biru pergerakan sensor dengan efek titik menyala */}
                  <Line
                    type="monotone"
                    dataKey="gas"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{
                      r: 6,
                      strokeWidth: 0,
                      className: "animate-ping",
                    }}
                    animationDuration={400}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Panel Kanan (Memakan 1/3 layar): Tabel Data Log & Tombol Ekspor CSV */}
          <motion.div
            variants={itemVariants}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 h-[420px] flex flex-col"
          >
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Table2 size={20} className="text-slate-600" />
                <h3 className="text-lg font-bold text-slate-800">
                  Riwayat Data
                </h3>
              </div>
              <button
                onClick={downloadCSV}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                <Download size={16} /> Ekspor
              </button>
            </div>

            {/* Container tabel dengan fitur scroll internal untuk mencegah halaman meluber ke bawah */}
            <div className="overflow-y-auto flex-1 pr-2 rounded-lg border border-slate-100">
              <table className="w-full text-sm text-left">
                <thead className="sticky top-0 bg-slate-50 shadow-sm">
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-3 px-4 font-semibold">Waktu</th>
                    <th className="py-3 px-4 font-semibold">Gas (PPM)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Menampilkan array data grafik dalam urutan terbalik agar data terbaru berada di posisi paling atas (Reverse Order) */}
                  {[...grafikData].reverse().map((data, index) => (
                    <tr
                      key={index}
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors last:border-0"
                    >
                      <td className="py-3 px-4 text-slate-600">{data.waktu}</td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        <span
                          className={`px-2 py-1 rounded-md ${data.gas >= batasBahaya ? "bg-red-100 text-red-600" : "bg-slate-100"}`}
                        >
                          {data.gas}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {/* Teks placeholder (pengganti) jika server belum menerima data dari Wokwi sama sekali */}
                  {grafikData.length === 0 && (
                    <tr>
                      <td
                        colSpan="2"
                        className="py-8 text-center text-slate-400 italic"
                      >
                        Menunggu data masuk...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </main>
  );
}
