"use client";

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
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Wifi,
  Wind,
  Activity,
  Download,
  Settings2,
  Table2,
  Flame,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";

export default function Dashboard() {
  const [dataSensor, setDataSensor] = useState({
    kadar_gas: 0,
    status: "Menunggu...",
  });
  const [isConnected, setIsConnected] = useState(false);
  const [grafikData, setGrafikData] = useState([]);

  // Ambang batas awal disetel untuk nilai analog (0-4095)
  const [batasBahaya, setBatasBahaya] = useState(2000);

  const mqttClientRef = useRef(null);
  const waktuTelegramTerakhir = useRef(0);
  const batasBahayaRef = useRef(2000);

  const kirimTelegram = async (kadarGas, batas) => {
    const sekarang = Date.now();
    // Mencegah spam Telegram (Jeda 10 detik)
    if (sekarang - waktuTelegramTerakhir.current < 10000) return;
    waktuTelegramTerakhir.current = sekarang;

    const token = "8887405090:AAGoVfRrWr7UDG33NQElmDy7wQF9qXJPBwo";
    const chatId = "6192187715";

    // Teks pesan sudah disesuaikan untuk nilai Analog (bukan PPM)
    const pesan = `⚠️ PERINGATAN DARURAT!\nKebocoran gas LPG terdeteksi.\nNilai sensor saat ini: ${kadarGas} (Melewati batas toleransi analog ${batas})`;

    fetch(
      `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(pesan)}`,
    ).catch((err) => console.error("Gagal mengirim Telegram:", err));
  };

  useEffect(() => {
    // Terhubung ke EMQX Public Broker menggunakan protokol keamanan WSS
    const client = mqtt.connect("wss://broker.emqx.io:8084/mqtt", {
      clientId: "Nextjs_Dashboard_" + Math.random().toString(16).slice(2, 8),
    });

    mqttClientRef.current = client;

    client.on("connect", () => {
      setIsConnected(true);
      client.subscribe("mikrokontroller/kelvin/sensor-gas/data");
    });

    client.on("message", (topic, message) => {
      if (topic === "mikrokontroller/kelvin/sensor-gas/data") {
        const payload = JSON.parse(message.toString());
        setDataSensor(payload);

        const waktuSekarang = new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        setGrafikData((prev) => {
          const newData = [
            ...prev,
            { waktu: waktuSekarang, gas: payload.kadar_gas },
          ];
          if (newData.length > 20) newData.shift(); // Batasi grafik maksimal 20 data terakhir
          return newData;
        });

        // Logika Pemicu Bahaya
        if (payload.kadar_gas >= batasBahayaRef.current) {
          kirimTelegram(payload.kadar_gas, batasBahayaRef.current);
        }
      }
    });

    return () => {
      if (client) client.end();
    };
  }, []);

  const ubahBatas = (e) => {
    const nilaiBaru = parseInt(e.target.value);
    setBatasBahaya(nilaiBaru);
    batasBahayaRef.current = nilaiBaru;

    // Sinkronisasi batas baru ke ESP32 secara realtime
    if (mqttClientRef.current && isConnected) {
      mqttClientRef.current.publish(
        "mikrokontroller/kelvin/sensor-gas/batas",
        nilaiBaru.toString(),
      );
    }
  };

  const downloadCSV = () => {
    if (grafikData.length === 0) return alert("Belum ada data untuk diunduh");

    // Header CSV disesuaikan dengan nilai Analog
    const header = "Waktu,Nilai Analog Sensor\n";
    const csvContent = grafikData
      .map((row) => `${row.waktu},${row.gas}`)
      .join("\n");

    const blob = new Blob([header + csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `log_analog_gas_${new Date().getTime()}.csv`;
    link.click();
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: "easeOut" },
    },
  };

  return (
    <div className="transition-colors duration-500">
      <main className="min-h-screen bg-slate-50 p-4 md:p-8 font-sans overflow-x-hidden text-slate-800">
        <motion.div
          className="max-w-7xl mx-auto space-y-8"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
        >
          {/* HEADER PUSAT KENDALI */}
          <motion.header
            variants={itemVariants}
            className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200"
          >
            <div>
              <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
                Sistem Monitoring{" "}
                <Flame className="text-blue-500 animate-pulse" size={28} />
              </h1>
              <p className="text-slate-500 mt-1 font-medium">
                Pemantauan Gas LPG Area Dapur Utama
              </p>
            </div>

            <div className="mt-4 md:mt-0 flex items-center gap-4">
              {/* Indikator Status Koneksi */}
              <div
                className={`flex items-center gap-3 px-5 py-3 rounded-full font-bold transition-all duration-500 shadow-inner tracking-wide ${isConnected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}
              >
                <span className="relative flex h-3.5 w-3.5">
                  {isConnected && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-3.5 w-3.5 ${isConnected ? "bg-green-500" : "bg-red-500"}`}
                  ></span>
                </span>
                {isConnected ? "Sistem Online" : "Sistem Offline"}
              </div>
            </div>
          </motion.header>

          {/* GRID 4 KARTU METRIK */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* KARTU 1: NILAI ANALOG */}
            <motion.div
              variants={itemVariants}
              className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 flex flex-col justify-between hover-rgb-glow relative overflow-hidden group cursor-pointer"
            >
              <div className="absolute -right-6 -top-6 text-blue-500/5 transition-transform duration-700 group-hover:rotate-180 group-hover:scale-150">
                <Wind size={150} />
              </div>
              <div className="relative z-10 flex justify-between items-start">
                <div>
                  <p className="text-slate-500 font-bold uppercase tracking-wider text-xs group-hover:text-blue-500 transition-colors">
                    Tegangan Sensor (Analog)
                  </p>
                  <h2 className="text-5xl lg:text-6xl font-black text-blue-600 mt-2">
                    {dataSensor.kadar_gas}
                  </h2>
                </div>
                <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl shadow-inner group-hover:bg-blue-500 group-hover:text-white transition-colors">
                  <Wind size={28} />
                </div>
              </div>
              <div className="relative z-10 mt-6 w-full bg-slate-100 h-2.5 rounded-full overflow-hidden shadow-inner">
                {/* Progress bar disesuaikan dengan skala maksimal ADC ESP32 (4095) */}
                <motion.div
                  className={`h-full ${dataSensor.kadar_gas >= batasBahaya ? "bg-red-500" : "bg-gradient-to-r from-blue-400 to-blue-600"}`}
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.min((dataSensor.kadar_gas / 4095) * 100, 100)}%`,
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </motion.div>

            {/* KARTU 2: STATUS KEAMANAN */}
            <motion.div
              variants={itemVariants}
              className={`p-6 rounded-[2rem] shadow-sm border flex flex-col justify-center items-center text-center transition-all duration-500 overflow-hidden hover-rgb-glow cursor-pointer relative ${dataSensor.status === "BAHAYA" ? "bg-red-50 border-red-200" : "bg-white border-slate-200"}`}
            >
              {dataSensor.status === "BAHAYA" && (
                <div className="absolute inset-0 bg-red-500/20 animate-pulse blur-2xl"></div>
              )}
              <div className="relative z-10">
                {dataSensor.status === "BAHAYA" ? (
                  <AlertTriangle
                    size={64}
                    className="text-red-500 mb-3 animate-bounce drop-shadow-[0_0_15px_rgba(239,68,68,0.5)] mx-auto"
                  />
                ) : (
                  <CheckCircle2
                    size={64}
                    className="text-green-500 mb-3 drop-shadow-[0_0_15px_rgba(34,197,94,0.4)] mx-auto"
                  />
                )}
                <h3
                  className={`text-2xl font-black tracking-widest ${dataSensor.status === "BAHAYA" ? "text-red-700" : "text-green-700"}`}
                >
                  {dataSensor.status}
                </h3>
              </div>
            </motion.div>

            {/* KARTU 3: SLIDER KONTROL AMBANG BATAS */}
            <motion.div
              variants={itemVariants}
              className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 flex flex-col justify-center hover-rgb-glow cursor-pointer group"
            >
              <div className="flex items-center gap-2 mb-5">
                <Settings2
                  size={20}
                  className="text-blue-500 group-hover:rotate-180 transition-transform duration-700"
                />
                <p className="font-bold uppercase tracking-wider text-xs">
                  Ambang Batas Alarm (ADC)
                </p>
              </div>
              <input
                type="range"
                min="500"
                max="4095"
                step="50"
                value={batasBahaya}
                onChange={ubahBatas}
                className="w-full accent-blue-600 cursor-grab active:cursor-grabbing h-2.5 bg-slate-200 rounded-lg appearance-none shadow-inner transition-all group-hover:accent-purple-500"
              />
              <div className="flex justify-between mt-4 text-sm font-bold">
                <span className="text-slate-400">500</span>
                <motion.span
                  key={batasBahaya}
                  initial={{ scale: 1.5, color: "#a855f7" }}
                  animate={{ scale: 1, color: "#2563eb" }}
                  className="px-3 py-1 bg-slate-100 text-blue-600 rounded-xl shadow-sm"
                >
                  {batasBahaya}
                </motion.span>
                <span className="text-slate-400">4095</span>
              </div>
            </motion.div>

            {/* KARTU 4: INFORMASI PERANGKAT */}
            <motion.div
              variants={itemVariants}
              className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-200 flex flex-col justify-center space-y-5 hover-rgb-glow cursor-pointer group relative overflow-hidden"
            >
              <div className="absolute -bottom-6 -right-6 text-slate-100 group-hover:rotate-12 transition-transform duration-500">
                <Zap size={120} />
              </div>
              <div className="relative z-10 flex items-center gap-4">
                <div className="p-3.5 bg-slate-100 rounded-2xl group-hover:bg-purple-100 group-hover:text-purple-600 transition-colors">
                  <Activity size={22} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    ID Perangkat
                  </p>
                  <p className="font-black text-sm tracking-wide mt-0.5">
                    ESP32-NODE-01
                  </p>
                </div>
              </div>
              <div className="relative z-10 flex items-center gap-4">
                <div className="p-3.5 bg-slate-100 rounded-2xl group-hover:bg-green-100 group-hover:text-green-600 transition-colors">
                  <Wifi size={22} />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Jalur Transmisi
                  </p>
                  <p className="font-black text-sm tracking-wide mt-0.5">
                    MQTT (EMQX Server)
                  </p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* AREA BAWAH: GRAFIK & TABEL */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* PANEL GRAFIK REAL-TIME */}
            <motion.div
              variants={itemVariants}
              className="lg:col-span-2 bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-200 h-[450px] flex flex-col hover-rgb-glow"
            >
              <h3 className="text-xl font-bold mb-6 flex items-center gap-3">
                <Activity className="text-blue-500" /> Live Data Stream
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
                    />
                    <YAxis
                      stroke="#64748b"
                      fontSize={12}
                      domain={[0, 4095]}
                      tickCount={6}
                    >
                      <Label
                        value="Nilai Analog (0-4095)"
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
                        borderRadius: "16px",
                        border: "none",
                        backgroundColor: "#ffffff",
                        color: "#0f172a",
                        boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.2)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey={() => batasBahaya}
                      stroke="#ef4444"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      activeDot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="gas"
                      stroke="url(#colorUv)"
                      strokeWidth={4}
                      dot={{
                        r: 5,
                        strokeWidth: 3,
                        fill: "#ffffff",
                        stroke: "#3b82f6",
                      }}
                      activeDot={{
                        r: 8,
                        strokeWidth: 0,
                        fill: "#00e5ff",
                        className: "animate-ping",
                      }}
                      animationDuration={400}
                    />
                    <defs>
                      <linearGradient id="colorUv" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={1} />
                        <stop
                          offset="95%"
                          stopColor="#a855f7"
                          stopOpacity={1}
                        />
                      </linearGradient>
                    </defs>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* PANEL TABEL RIWAYAT LOG */}
            <motion.div
              variants={itemVariants}
              className="bg-white p-6 md:p-8 rounded-[2rem] shadow-sm border border-slate-200 h-[450px] flex flex-col hover-rgb-glow"
            >
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-slate-100 rounded-lg">
                    <Table2 size={20} className="text-slate-600" />
                  </div>
                  <h3 className="text-xl font-bold">Log Data</h3>
                </div>
                <motion.button
                  whileHover={{ scale: 1.05, backgroundColor: "#15803d" }}
                  whileTap={{ scale: 0.95 }}
                  onClick={downloadCSV}
                  className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold shadow-[0_4px_14px_0_rgba(22,163,74,0.39)] transition-colors"
                >
                  <Download size={18} /> Ekspor
                </motion.button>
              </div>
              <div className="overflow-y-auto flex-1 pr-3 rounded-2xl border border-slate-100 bg-slate-50 shadow-inner custom-scrollbar">
                <table className="w-full text-sm text-left">
                  <thead className="sticky top-0 bg-white/90 backdrop-blur-sm z-10">
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="py-4 px-5 font-bold uppercase tracking-wider text-xs">
                        Waktu
                      </th>
                      <th className="py-4 px-5 font-bold uppercase tracking-wider text-xs text-right">
                        Analog
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...grafikData].reverse().map((data, index) => (
                      <motion.tr
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, type: "spring" }}
                        key={index}
                        className="border-b border-slate-100 hover:bg-white transition-colors last:border-0 group"
                      >
                        <td className="py-3 px-5 text-slate-600 font-medium group-hover:text-blue-500 transition-colors">
                          {data.waktu}
                        </td>
                        <td className="py-3 px-5 text-right font-black">
                          <span
                            className={`px-3 py-1.5 rounded-lg shadow-sm ${data.gas >= batasBahaya ? "bg-red-500 text-white" : "bg-white text-slate-700 border border-slate-200"}`}
                          >
                            {data.gas}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
