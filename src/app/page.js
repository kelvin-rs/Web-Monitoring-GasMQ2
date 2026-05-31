/**
 * SISTEM ANTARMUKA PEMANTAUAN IOT (Web Dashboard)
 * * Framework: Next.js (React) - Client Component
 * * Deskripsi: Modul front-end ini bertugas sebagai Subscriber (menerima data sensor)
 * sekaligus Publisher (mengirim ambang batas) menggunakan protokol MQTT via WebSockets (WSS).
 * Sistem ini dilengkapi dengan manajemen state real-time, visualisasi grafik dinamis,
 * notifikasi Telegram (REST API), dan fitur ekspor log data ke CSV.
 */

"use client"; // Direktif Next.js: Memaksa komponen ini di-render di sisi klien (Browser) karena menggunakan Hooks dan WebSockets

// ==========================================
// 1. IMPOR PUSTAKA (DEPENDENCIES)
// ==========================================
import { useEffect, useState, useRef } from "react"; // React Hooks untuk manajemen siklus hidup dan memori komponen
import mqtt from "mqtt"; // Pustaka klien MQTT untuk menjembatani komunikasi browser dengan broker IoT
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
} from "recharts"; // Pustaka visualisasi data berbasis SVG untuk merender grafik real-time
import {
  AlertTriangle,
  CheckCircle2,
  Wifi,
  Wind,
  Activity,
  Download,
  Settings2,
  Table2,
  Volume2,
  VolumeX,
} from "lucide-react"; // Pustaka ikon vektor untuk antarmuka pengguna
import { motion } from "framer-motion"; // Pustaka animasi fisika (spring/tween) untuk interaksi UI/UX

export default function Dashboard() {
  // ==========================================
  // 2. MANAJEMEN STATE (UI TRIGGERS)
  // ==========================================
  // useState digunakan untuk variabel yang, jika nilainya berubah, akan memaksa React untuk merender ulang (update) layar
  const [dataSensor, setDataSensor] = useState({
    kadar_gas: 0,
    status: "Menunggu...",
  });
  const [isConnected, setIsConnected] = useState(false); // Indikator status koneksi WebSocket
  const [grafikData, setGrafikData] = useState([]); // Array struktur data [{waktu, gas}] untuk diumpankan ke Recharts dan Tabel
  const [batasBahaya, setBatasBahaya] = useState(2000); // Nilai slider untuk tampilan UI

  // ==========================================
  // 3. MANAJEMEN REF (BACKGROUND DATA)
  // ==========================================
  // useRef digunakan untuk menyimpan referensi atau nilai yang bisa diubah (mutable) secara sinkron
  // TANPA memicu render ulang layar, sangat krusial untuk mencegah memory leak pada event listener MQTT.
  const mqttClientRef = useRef(null); // Menyimpan instance koneksi MQTT agar bisa diakses fungsi lain di luar useEffect
  const waktuTelegramTerakhir = useRef(0); // Pencatat waktu (timestamp) untuk algoritma debounce/anti-spam Telegram
  const batasBahayaRef = useRef(2000); // Menyalin nilai batas agar selalu valid saat dibaca oleh callback MQTT di latar belakang
  const audioRef = useRef(null); // Referensi langsung (DOM node) ke elemen <audio> HTML5 untuk kontrol play/pause

  // ==========================================
  // 4. FUNGSI EKSTERNAL (REST API TELEGRAM)
  // ==========================================
  // Fungsi asinkron untuk melakukan HTTP POST request ke server Telegram
  const kirimTelegram = async (kadarGas, batas) => {
    const sekarang = Date.now(); // Mengambil waktu UNIX saat ini dalam milidetik

    // Mekanisme Rate-Limiting (Anti-Spam):
    // Menghentikan eksekusi fungsi jika jarak dari pesan terakhir belum mencapai 10.000 ms (10 detik)
    if (sekarang - waktuTelegramTerakhir.current < 10000) return;
    waktuTelegramTerakhir.current = sekarang;

    const token = "8887405090:AAGoVfRrWr7UDG33NQElmDy7wQF9qXJPBwo";
    const chatId = "6192187715";
    const pesan = `⚠️ PERINGATAN DARURAT!\nKebocoran gas LPG terdeteksi.\nNilai sensor saat ini: ${kadarGas} (Melewati batas toleransi analog ${batas})`;

    // Eksekusi pemanggilan API menggunakan Fetch API bawaan browser
    fetch(
      `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(pesan)}`,
    ).catch((err) => console.error("Gagal mengirim Telegram:", err)); // Error handling
  };

  // ==========================================
  // 5. LIFECYCLE HOOK: KONEKSI & LISTENER MQTT
  // ==========================================
  useEffect(() => {
    // Inisialisasi koneksi MQTT menggunakan protokol WSS (WebSocket Secure) melalui port 8084
    // agar lolos dari aturan Strict Mixed Content Policy pada browser modern
    const client = mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
      clientId: "Nextjs_Dashboard_" + Math.random().toString(16).slice(2, 8), // Mencegah bentrok sesi (Session Collision)
    });

    mqttClientRef.current = client;

    // Event Listener: Dijalankan otomatis saat jabat tangan (handshake) WSS berhasil
    client.on("connect", () => {
      setIsConnected(true);
      client.subscribe("mikrokontroller/kelvin/sensor-gas/data"); // Berlangganan topik masuk dari ESP32
    });

    // Event Listener: Dijalankan otomatis setiap kali paket payload masuk dari broker
    client.on("message", (topic, message) => {
      if (topic === "mikrokontroller/kelvin/sensor-gas/data") {
        // Parsing (Penerjemahan) tipe data Buffer/String dari C++ menjadi Objek JSON JavaScript
        const payload = JSON.parse(message.toString());
        setDataSensor(payload);

        // Ekstraksi waktu lokal (Client-side timestamping)
        const waktuSekarang = new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        // Algoritma Sliding Window: Memperbarui array grafik
        setGrafikData((prev) => {
          const newData = [
            ...prev,
            { waktu: waktuSekarang, gas: payload.kadar_gas },
          ];
          // Memori efisiensi: Menghapus elemen array pertama (Shift) jika array melebihi 20 data
          if (newData.length > 20) newData.shift();
          return newData;
        });

        // Evaluasi Logika Keselamatan di sisi Client
        // (Menggunakan .current dari useRef agar nilai batas selalu mutakhir tanpa *stale closure*)
        if (payload.kadar_gas >= batasBahayaRef.current) {
          kirimTelegram(payload.kadar_gas, batasBahayaRef.current);

          // Manajemen Aktuator Audio (Hardware Web API)
          if (audioRef.current) {
            audioRef.current
              .play()
              .catch((err) =>
                console.warn(
                  "Autoplay diblokir browser. Pengguna harus klik area web minimal 1x agar suara keluar.",
                  err,
                ),
              );
          }
        } else {
          // Reset status audio saat kondisi kembali normal
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
        }
      }
    });

    // Cleanup Function (Unmounting): Dieksekusi otomatis oleh React saat komponen/halaman dihancurkan (ditutup)
    // Berfungsi memutus soket secara elegan untuk menghindari memory leak di sisi klien maupun server
    return () => {
      if (client) client.end();
    };
  }, []); // Dependency array kosong memastikan blok ini hanya dieksekusi 1 kali saat Mounting (halaman dimuat)

  // ==========================================
  // 6. FUNGSI INTERAKSI: SLIDER (PUBLISHER MQTT)
  // ==========================================
  const ubahBatas = (e) => {
    const nilaiBaru = parseInt(e.target.value);

    setBatasBahaya(nilaiBaru); // Sinkronisasi state untuk re-render UI slider
    batasBahayaRef.current = nilaiBaru; // Sinkronisasi variabel background untuk logika perbandingan

    // Melakukan push data (Publish) ke server untuk memperbarui memori mikrokontroler secara over-the-air
    if (mqttClientRef.current && isConnected) {
      mqttClientRef.current.publish(
        "mikrokontroller/kelvin/sensor-gas/batas",
        nilaiBaru.toString(),
      );
    }
  };

  // ==========================================
  // 7. FUNGSI EKSTRAKSI DATA: EKSPOR CSV
  // ==========================================
  const downloadCSV = () => {
    if (grafikData.length === 0) return alert("Belum ada data untuk diunduh");

    const header = "Waktu,Nilai Analog Sensor\n";

    // Serialisasi array objek JSON menjadi format teks terpisah koma (Comma Separated Values)
    const csvContent = grafikData
      .map((row) => `${row.waktu},${row.gas}`)
      .join("\n");

    // Pembuatan Blob (Binary Large Object) untuk menyimpan data teks ke dalam memori virtual browser
    const blob = new Blob([header + csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    // Membuat elemen HTML <a> transien (sementara) untuk memicu unduhan sistem operasi
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);

    link.setAttribute("href", url);
    link.setAttribute("download", `log_gas_${new Date().getTime()}.csv`);
    link.style.visibility = "hidden";

    // Injeksi elemen ke DOM, eksekusi klik, lalu destruksi elemen
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Objek konfigurasi variasi fisika animasi untuk komponen Framer Motion
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  // ==========================================
  // 8. RENDER ANTARMUKA PENGGUNA (JSX / VIRTUAL DOM)
  // ==========================================
  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans overflow-x-hidden">
      {/* Node Audio Tersembunyi untuk alarm bahaya */}
      <audio
        ref={audioRef}
        src="https://assets.mixkit.co/active_storage/sfx/995/995-preview.mp3"
        loop
        preload="auto"
      />

      <motion.div
        className="max-w-7xl mx-auto space-y-6"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.1 } } }} // Efek animasi kaskade berurutan
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

          {/* Indikator Status Kelistrikan/Jaringan WSS */}
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

        {/* BAGIAN 2: GRID KARTU METRIK UTAMA */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Kartu 1: Akuisisi Data ADC Sensor */}
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
                    Gas
                  </span>
                </h2>
              </div>
              <div className="p-3 bg-blue-50 text-blue-500 rounded-xl">
                <Wind size={28} />
              </div>
            </div>

            {/* Progress Bar Termal/Gas */}
            <div className="mt-6 w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <motion.div
                className={`h-full ${dataSensor.kadar_gas >= batasBahaya ? "bg-red-500" : "bg-blue-500"}`}
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.min((dataSensor.kadar_gas / 4095) * 100, 100)}%`,
                }} // Kalkulasi proporsi bar berdasarkan resolusi maksimum ADC ESP32 (12-bit / 4095)
                transition={{ duration: 0.3 }}
              />
            </div>
          </motion.div>

          {/* Kartu 2: Status Evaluasi Kondisi Sistem */}
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
              className={`text-xl font-bold flex items-center justify-center gap-2 ${dataSensor.status === "BAHAYA" ? "text-red-700" : "text-green-700"}`}
            >
              STATUS: {dataSensor.status}
              {dataSensor.status === "BAHAYA" && (
                <Volume2 size={24} className="text-red-600 animate-pulse" />
              )}
            </h3>
            <p
              className={`mt-1 text-xs ${dataSensor.status === "BAHAYA" ? "text-red-600/80" : "text-green-600/80"}`}
            >
              {dataSensor.status === "BAHAYA"
                ? "Evakuasi area segera!"
                : "Udara batas normal"}
            </p>
          </motion.div>

          {/* Kartu 3: Input Kontrol Logika Ambang Batas (User Interface to Machine) */}
          <motion.div
            variants={itemVariants}
            className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center"
          >
            <div className="flex items-center gap-2 mb-4">
              <Settings2 size={20} className="text-slate-600" />
              <p className="text-slate-700 font-bold">Ambang Batas Alarm</p>
            </div>
            {/* Praktik Keamanan (Safety Constraint): 
                Nilai minimal dikunci di 1500 agar operator tidak bisa mematikan 
                alarm secara tidak sengaja pada kondisi darurat */}
            <input
              type="range"
              min="1500"
              max="4095"
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
              <span className="text-slate-400">4095</span>
            </div>
          </motion.div>

          {/* Kartu 4: Metadata Perangkat Hardware */}
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
                  MQTT (EMQX)
                </p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* BAGIAN 3: AREA VISUALISASI LOG DATA KOMPREHENSIF */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Panel Kiri: Komponen Grafik Cartesian Recharts */}
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
                      value="Kadar Gas (Analog)"
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

                  {/* Garis Referensi Statis: Memvisualisasikan threshold bahaya */}
                  <Line
                    type="monotone"
                    dataKey={() => batasBahaya}
                    stroke="#ef4444"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                    activeDot={false}
                  />

                  {/* Garis Dinamis: Pergerakan log data sensor */}
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
                    animationDuration={400} // Efek transisi antar data titik
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Panel Kanan: Render Data Tabular (DOM Table) */}
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
                onClick={downloadCSV} // Memicu fungsi download file lokal
                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
              >
                <Download size={16} /> Ekspor
              </button>
            </div>

            <div className="overflow-y-auto flex-1 pr-2 rounded-lg border border-slate-100">
              <table className="w-full text-sm text-left">
                <thead className="sticky top-0 bg-slate-50 shadow-sm">
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-3 px-4 font-semibold">Waktu</th>
                    <th className="py-3 px-4 font-semibold">Gas (Analog)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Mapping Array: Menyusun baris tabel dengan fungsi array reverse agar LIFO (Last In First Out) */}
                  {[...grafikData].reverse().map((data, index) => (
                    <tr
                      key={index} // Key unik yang diwajibkan React untuk algoritma rekonsiliasi DOM
                      className="border-b border-slate-50 hover:bg-slate-50 transition-colors last:border-0"
                    >
                      <td className="py-3 px-4 text-slate-600">{data.waktu}</td>
                      <td className="py-3 px-4 font-medium text-slate-800">
                        {/* Rendering status bahaya secara dinamis menggunakan kondisional Ternary */}
                        <span
                          className={`px-2 py-1 rounded-md ${data.gas >= batasBahaya ? "bg-red-100 text-red-600" : "bg-slate-100"}`}
                        >
                          {data.gas}
                        </span>
                      </td>
                    </tr>
                  ))}

                  {/* Penanganan State Kosong (Empty State Handling) saat koneksi terputus/awal dimuat */}
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
