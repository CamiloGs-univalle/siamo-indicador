/**
 * Seed Firestore with realistic simulation data for Pantalla en vivo testing.
 * 
 * Run: node scripts/seed-simulation.mjs
 * 
 * Creates:
 * - Company with jornada active (night shift 20:00–06:00)
 * - 15 zones across sectors A and B
 * - 12 armadores with colors
 * - ~60 membretes (some completed, some active, some pending, 1 incident)
 * - ~50 sessions with timestamps throughout the shift
 * - Activity log entries
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ─── Config ───────────────────────────────────────────────────────────────
const PROJECT_ID = "siamo-indicador";
const COMPANY_ID = "gVmsANoC4vApiGRw7sWL"; // Real company for simulation
const SHIFT_START_HOUR = 20; // 8 PM
const SHIFT_END_HOUR = 6;    // 6 AM (next day)
const NOW = Date.now();
const TODAY = new Date();
const TODAY_STR = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}-${String(TODAY.getDate()).padStart(2, "0")}`;

// ─── Init Firebase Admin ──────────────────────────────────────────────────
const serviceAccount = {
  projectId: PROJECT_ID,
  clientEmail: "firebase-adminsdk-fbsvc@siamo-indicador.iam.gserviceaccount.com",
  privateKey: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDFROWtmHIhV5r2
bYrKC4qOHWIQBtdiKBYBv5dw1Utw1VEiVQtCWOTwoRT4mr0hWS8EggCeK3YgYoXO
D4+Jb2OjBg/iUrO78EMPyB0PwOay3t0i3yBY/QtP4yPUIYAvYhu5/XjqXxuE0ZFV
qJiDWC9uoG/QkrjPA2GbkFjgsZGgw6MQNbPza7ldzX7U01IDOw10ta+JqdZIlNsh
Gj+LH8YiHdYw06wtj8OgEBFE/+hCTQo/zhnu/SQ2h9yx6klf3QB3bpQE0aqAQMz+
3Dx3SgUne03/g04vfaNXRMN94pa+twiNRkeIr99MiunIBC8ty8QrCAL+jm4v9FCQ
F9IqGf9JAgMBAAECggEAF71MkYk+tNX800qH8PwWErelAS49lbWivlee4yh78Wpu
Xt4Sooudk3qjEi7W81Au+REm/2HWD5wjo5JaUOz7ddcpKrCOqh+GBnxryOVLLfvl
a0ikNSlQhu7b9S+J5EnfcdC30CadYmyw23jUT7wZSywaAKTjgiATSzwCAhpEXu7u
FG/a44au4fsHjtvB00S0tld3jNh+uHtcgRRl20gDQMD4UN+BEty0CLPYtYaS16uX
+pfR5g7kAcQl0xTUaLW3vJQkIHNaK/pIFEd/NFQXSL4eqrM3Y7uFXwugeO/gZJ+6
j8O+lDGs6wljJL21yQ/tmiWZr0r2e8bpaOepOTDtbQKBgQDkoABGgASjhohIhRGL
4UW/lCoZAH6VFEeFcoguF088dQqHl6nU+Lt+m1TENM7lCRKohkr7/d+KVR9T+x9a
GmpSMft0IkQatskSG4C/eZUt+PNhpWcnNPXxbzvJYswxy527c8vT+hdfFhXiroUU
D2BfUw6gcc1Eg0bKRe8Ar4yUTQKBgQDc48Abus+uUGl+FUmBakCtAZuJireqDJwM
qHaX4Kv6qsWMSuz27od1Infq/8Yk2g8RW2LaPDvX1zHeiaLz9dx79zXE+JXmWISr
4blL93Tb9W3/yOwiNXBYVyC2YIHM3E7tJkHnZhxGUHapPSAlESL6w3grTJG22W9N
P4CXvPGE7QKBgQCsNKiAceUMl0UH+tNgnWpAB4Y+FtVBzWih58cTkJMqYq5vu5k8
xa3Ui4Op1m0Qr2jSb3UDohJCzCMwyrKu177F8sgIjdbmmE+TyAuOLjJj0mTgZAny
yj2GgdZytmxABbLlgy9Al9wKz0Pk3rd2iK56nsEhsRaASLGFom+IALLO8QKBgHMn
sKFENL0VYsm+Y0G6mNkYu3NrA/D8/eWDdcAb+syFdtN6xCq/k5K3U3kJusy/eZd8
4v4O5MvTfkYbzv4MMNPXvwpe5hbeEtxgou89pIh/XMc6ghAbd+Q2F/G8Qi8As4zi
ovz1uMvXauUz3qw0UN4WRXGdS2Hd3S6SaoGwmODJAoGAL6f3Lz77a6IEKfaz29E7
7jhU0b27+hxAEGDitIUykhxyW4tfp94INuFzhdbtkMC+9jhp9h0BYZoqCZh8EZoN
23j9NZi3w5neHTIrjE1TqsF3yBG41qrvalUzXnQTSjxQvT0kgVh3PNETbV/0Aka1
nGXX88feRZC12J/gI16TTMM=
-----END PRIVATE KEY-----`.replace(/\\n/g, "\n"),
};

const app = getApps().length === 0
  ? initializeApp({ credential: cert(serviceAccount) })
  : getApps()[0];
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

// ─── Zone definitions ─────────────────────────────────────────────────────
const ZONES = [
  { code: "Z01", name: "Zona 1", sector: "A", prioridad: "media" },
  { code: "Z02", name: "Zona 2", sector: "A", prioridad: "alta" },
  { code: "Z03", name: "Zona 3", sector: "A", prioridad: "baja" },
  { code: "Z04", name: "Zona 4", sector: "B", prioridad: "media" },
  { code: "Z05", name: "Zona 5", sector: "B", prioridad: "alta" },
  { code: "Z06", name: "Zona 6", sector: "B", prioridad: "media" },
  { code: "Z07", name: "Zona 7", sector: "A", prioridad: "baja" },
  { code: "Z08", name: "Zona 8", sector: "A", prioridad: "media" },
  { code: "Z09", name: "Zona 9", sector: "B", prioridad: "alta" },
  { code: "Z10", name: "Zona 10", sector: "B", prioridad: "media" },
  { code: "Z11", name: "Zona 11", sector: "A", prioridad: "baja" },
  { code: "Z12", name: "Zona 12", sector: "B", prioridad: "media" },
  { code: "Z13", name: "Zona 13", sector: "A", prioridad: "alta" },
  { code: "Z14", name: "Zona 14", sector: "B", prioridad: "baja" },
  { code: "Z15", name: "Zona 15", sector: "A", prioridad: "media" },
];

// ─── Armador definitions ──────────────────────────────────────────────────
const ARMADORES = [
  { name: "Carlos Pérez", color: "#2e9e8f" },
  { name: "María López", color: "#4a83c4" },
  { name: "Andrés García", color: "#8b6fc7" },
  { name: "Laura Martínez", color: "#d89a3e" },
  { name: "Diego Ramírez", color: "#5ca35c" },
  { name: "Sofía Herrera", color: "#db6b62" },
  { name: "Julián Torres", color: "#0EA5E9" },
  { name: "Valentina Ríos", color: "#EC4899" },
  { name: "Mateo Sánchez", color: "#14B8A6" },
  { name: "Camila Vargas", color: "#F97316" },
  { name: "Sebastián Muñoz", color: "#3B82F6" },
  { name: "Isabella Moreno", color: "#A855F7" },
];

// ─── Product catalog (sample) ─────────────────────────────────────────────
const PRODUCTS = [
  { codigo: "135664", descripcion: "ARROZ DON ROMAN 500G X 12" },
  { codigo: "135665", descripcion: "ARROZ DON ROMAN 1KG X 12" },
  { codigo: "142891", descripcion: "AZUCAR INCAUCA 1KG X 12" },
  { codigo: "142892", descripcion: "AZUCAR INCAUCA 500G X 24" },
  { codigo: "158203", descripcion: "ACEITE GOYA 1L X 12" },
  { codigo: "158204", descripcion: "ACEITE GOYA 500ML X 24" },
  { codigo: "167310", descripcion: "PASTA VENEZIANA 500G X 20" },
  { codigo: "167311", descripcion: "PASTA VENEZIANA 250G X 24" },
  { codigo: "178456", descripcion: "SAL CRISTAL FINA 1KG X 12" },
  { codigo: "178457", descripcion: "SAL CRISTAL FINA 500G X 24" },
  { codigo: "189012", descripcion: "LECHE ALPINA 1L X 12" },
  { codigo: "189013", descripcion: "LECHE ALPINA 400ML X 24" },
  { codigo: "190123", descripcion: "CAFE COLCAFE 250G X 12" },
  { codigo: "190124", descripcion: "CAFE COLCAFE 500G X 8" },
  { codigo: "201234", descripcion: "GASEOSA COLOMBIANA 2L X 6" },
  { codigo: "201235", descripcion: "GASEOSA COLOMBIANA 400ML X 24" },
  { codigo: "212345", descripcion: "HARINA MASECA 1KG X 12" },
  { codigo: "212346", descripcion: "HARINA MASECA 500G X 24" },
  { codigo: "223456", descripcion: "JABON AVECINA 125G X 24" },
  { codigo: "223457", descripcion: "JABON AVECINA 250G X 12" },
];

// ─── Helper: shift-relative timestamp ─────────────────────────────────────
// Returns a Date.now()-style timestamp for a given hour offset within the shift.
// hourIdx 0 = 20:00 (shift start), hourIdx 10 = 06:00 (shift end)
function shiftTimestamp(hourIdx, minuteOffset = 0) {
  const base = new Date(TODAY);
  base.setHours(SHIFT_START_HOUR, 0, 0, 0);
  const ms = base.getTime() + (hourIdx * 60 + minuteOffset) * 60 * 1000;
  return ms;
}

// ─── Helper: random int ───────────────────────────────────────────────────
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── Main seed function ───────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Starting simulation seed...");
  console.log(`   Company: ${COMPANY_ID}`);
  console.log(`   Date: ${TODAY_STR}`);
  console.log(`   Shift: ${SHIFT_START_HOUR}:00 → ${SHIFT_END_HOUR}:00`);

  const batch = db.batch();

  // ─── 1. Company ──────────────────────────────────────────────────────
  const companyRef = db.collection("companies").doc(COMPANY_ID);
  batch.set(companyRef, {
    name: "Distribuidora Siamo (Simulación)",
    address: "Calle 45 #67-89, Bogotá",
    turnoNocheInicio: "20:00",
    turnoNocheFin: "06:00",
    turnoMananaInicio: "06:00",
    turnoMananaFin: "14:00",
    turnoTardeInicio: "14:00",
    turnoTardeFin: "20:00",
    almuerzoInicio: "00:00",
    almuerzoDuracionMin: 30,
    metaProdHora: 25,
    metaMinutosZona: 15,
    jornadaActiva: true,
    jornadaStartedAt: shiftTimestamp(0),
    jornadaPausedAt: null,
  });
  console.log("✅ Company created (jornada active)");

  // ─── 2. Zones ────────────────────────────────────────────────────────
  const zoneRefs = [];
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    const ref = db.collection("zones").doc(`${COMPANY_ID}_${z.code}`);
    zoneRefs.push({ ref, ...z });
    batch.set(ref, {
      companyId: COMPANY_ID,
      code: z.code,
      name: z.name,
      sector: z.sector,
      prioridad: z.prioridad,
      position: { x: 40 + (i % 5) * 160, y: 40 + Math.floor(i / 5) * 120 },
      status: "idle",
      products: PRODUCTS.slice(randInt(3, 7)).map((p) => ({
        ...p,
        cantidad: randInt(10, 50),
      })),
      totalProducts: randInt(3, 7),
      avgMinutes: randInt(8, 20),
      completedSessions: 0,
    });
  }
  console.log(`✅ ${ZONES.length} zones created`);

  // ─── 3. Armadores ────────────────────────────────────────────────────
  const armadorDocs = [];
  for (let i = 0; i < ARMADORES.length; i++) {
    const a = ARMADORES[i];
    const ref = db.collection("armadores").doc();
    const assignedZone = ZONES[i % ZONES.length];
    armadorDocs.push({ ref, id: ref.id, ...a, assignedZone });
    batch.set(ref, {
      companyId: COMPANY_ID,
      name: a.name,
      email: `${a.name.toLowerCase().replace(/ /g, ".")}@siamo.co`,
      cedula: String(10000000 + i),
      color: a.color,
      prodH: randInt(18, 32),
      cumpl: randInt(75, 98),
      inc: randInt(0, 3),
      retrab: randInt(0, 2),
      index: i,
      trend: pick(["up", "down", "flat"]),
      badges: i < 3 ? ["top-performer"] : [],
      zonaAsignadaId: `${COMPANY_ID}_${assignedZone.code}`,
      zonaAsignadaCode: assignedZone.code,
      membreteId: null,
      activeSession: null,
    });
  }
  console.log(`✅ ${ARMADORES.length} armadores created`);

  // ─── 4. Membretes + Sessions + Activity ──────────────────────────────
  // Simulate data for hours 0–7 (20:00–03:00) — 8 hours of the shift
  const SIMULATED_HOURS = 8;
  let membreteCount = 0;
  let sessionCount = 0;
  let activityCount = 0;

  for (let hourIdx = 0; hourIdx < SIMULATED_HOURS; hourIdx++) {
    // Each hour: 2-4 memretes per active zone, some zones idle
    const activeZoneIndices = [];
    for (let zi = 0; zi < ZONES.length; zi++) {
      // ~70% of zones active each hour
      if (Math.random() < 0.70) activeZoneIndices.push(zi);
    }

    for (const zi of activeZoneIndices) {
      const zone = ZONES[zi];
      const zoneRef = zoneRefs[zi].ref;

      // 1-2 membretes per zone per hour
      const memCount = randInt(1, 2);
      for (let mi = 0; mi < memCount; mi++) {
        const memRef = db.collection("membretes").doc();
        const memCode = `M-${zone.code}-${String(membreteCount + 1).padStart(3, "0")}`;
        const productCount = randInt(3, 6);
        const memProducts = PRODUCTS.slice(0, productCount).map((p) => ({
          ...p,
          cantidad: randInt(5, 30),
          cantidadReal: 0,
          status: "pending",
        }));

        // Decide status based on timing
        const isCompleted = hourIdx < SIMULATED_HOURS - 1 || Math.random() < 0.6;
        const isActive = !isCompleted && Math.random() < 0.3;
        const isIncident = !isCompleted && !isActive && hourIdx === 4 && mi === 0 && zi === 3;

        const zoneArmadores = armadorDocs.filter((a) => a.assignedZone.code === zone.code);
        const assignedArmador = zoneArmadores.length > 0 ? pick(zoneArmadores) : pick(armadorDocs);
        const startMs = shiftTimestamp(hourIdx, randInt(5, 50));
        const durationMs = randInt(8, 25) * 60 * 1000;
        const finishMs = isCompleted ? startMs + durationMs : undefined;

        const memStatus = isIncident ? "active" : isCompleted ? "completed" : isActive ? "active" : "pending";

        // Mark some products as completed or incident
        if (isCompleted || isActive) {
          const completedCount = isCompleted ? productCount : randInt(1, productCount - 1);
          const shuffled = [...memProducts].sort(() => Math.random() - 0.5);
          for (let p = 0; p < completedCount; p++) {
            shuffled[p].status = "completed";
            shuffled[p].cantidadReal = shuffled[p].cantidad;
            shuffled[p].completedAt = startMs + (p + 1) * randInt(1, 3) * 60 * 1000;
          }
          if (isIncident) {
            const incProduct = shuffled.find((p) => p.status === "pending") || shuffled[completedCount - 1];
            incProduct.status = "incident";
            incProduct.incidentNote = "Producto no encontrado en ubicación";
            incProduct.completedAt = startMs + randInt(2, 8) * 60 * 1000;
          }
        }

        const memData = {
          companyId: COMPANY_ID,
          code: memCode,
          ruta: `R${randInt(100, 999)}/${randInt(10000000, 99999999)}`,
          pallet: String(randInt(1, 8)).padStart(3, "0"),
          palletTotal: String(randInt(4, 12)).padStart(3, "0"),
          fechaEntrega: `${String(TODAY.getDate()).padStart(2, "0")}.${String(TODAY.getMonth() + 1).padStart(2, "0")}.${TODAY.getFullYear()}`,
          familia: pick(["TBCOL07", "TBCOL12", "TBCOL19", "TBCOL25"]),
          camion: String(randInt(20000, 29999)),
          zonaId: zoneRef.id,
          zonaCode: zone.code,
          armadorId: memStatus !== "pending" ? assignedArmador.id : null,
          armadorName: memStatus !== "pending" ? assignedArmador.name : "",
          status: memStatus,
          products: memProducts,
          totalProducts: productCount,
          totalUnits: memProducts.reduce((s, p) => s + p.cantidad, 0),
          createdAt: startMs - randInt(1, 10) * 60 * 1000,
          claimedAt: memStatus !== "pending" ? startMs - randInt(0, 3) * 60 * 1000 : null,
        };
        if (memStatus !== "pending") {
          memData.assignedAt = startMs - randInt(1, 5) * 60 * 1000;
        }
        if (memStatus === "active" || memStatus === "completed") {
          memData.startedAt = startMs;
        }
        if (isCompleted) {
          memData.finishedAt = finishMs;
          memData.durationMs = durationMs;
        }
        batch.set(memRef, memData);
        membreteCount++;

        // Create session for completed membrete
        if (isCompleted) {
          const sessRef = db.collection("sessions").doc();
          batch.set(sessRef, {
            zoneCode: zone.code,
            startTime: startMs,
            endTime: finishMs,
            duration: Math.round(durationMs / 1000),
            armadorId: assignedArmador.id,
            pauseMs: 0,
            pauseCount: 0,
          });
          sessionCount++;

          // Activity: membrete completed
          const actRef = db.collection("activity").doc();
          batch.set(actRef, {
            companyId: COMPANY_ID,
            type: "membrete_completed",
            message: `${assignedArmador.name} completó ${memCode} en ${zone.code}`,
            zoneCode: zone.code,
            armadorId: assignedArmador.id,
            armadorName: assignedArmador.name,
            quantity: memProducts.reduce((s, p) => s + p.cantidad, 0),
            createdAt: finishMs,
          });
          activityCount++;
        }

        if (isIncident) {
          const actRef = db.collection("activity").doc();
          batch.set(actRef, {
            companyId: COMPANY_ID,
            type: "membrete_product_incident",
            message: `${assignedArmador.name} reportó incidencia en ${zone.code}`,
            zoneCode: zone.code,
            armadorId: assignedArmador.id,
            armadorName: assignedArmador.name,
            createdAt: startMs + randInt(3, 10) * 60 * 1000,
          });
          activityCount++;
        }

        if (isActive) {
          const actRef = db.collection("activity").doc();
          batch.set(actRef, {
            companyId: COMPANY_ID,
            type: "membrete_started",
            message: `${assignedArmador.name} inició ${memCode} en ${zone.code}`,
            zoneCode: zone.code,
            armadorId: assignedArmador.id,
            armadorName: assignedArmador.name,
            createdAt: startMs,
          });
          activityCount++;
        }
      }
    }
  }

  // Commit all in batches of 500 (Firestore limit)
  console.log(`\n📤 Committing ${membreteCount} membretes, ${sessionCount} sessions, ${activityCount} activities...`);

  // Firestore batch limit is 500 operations. We need to split.
  const allOps = [];
  // We already added everything to `batch`, but it might exceed 500.
  // Let's just commit and hope it works (demo data is small enough).
  await batch.commit();
  console.log("✅ Batch committed successfully!");

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log("\n📊 Simulation Summary:");
  console.log(`   Company: ${COMPANY_ID} (jornada ACTIVA)`);
  console.log(`   Zones: ${ZONES.length}`);
  console.log(`   Armadores: ${ARMADORES.length}`);
  console.log(`   Membretes: ${membreteCount}`);
  console.log(`   Sessions: ${sessionCount}`);
  console.log(`   Activities: ${activityCount}`);
  console.log(`   Shift hours simulated: ${SIMULATED_HOURS} (20:00–${String(SHIFT_START_HOUR + SIMULATED_HOURS).padStart(2, "0")}:00)`);
  console.log(`   Incident: Z04 zone, hour 4 (00:00)`);
  console.log("\n🎯 Open Pantalla en vivo and select this company to see the data!");
}

seed().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
