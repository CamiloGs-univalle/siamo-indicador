/**
 * Seed Firestore with REALISTIC stress-test simulation data.
 *
 * Run: node scripts/seed-simulation.mjs
 *
 * What it does:
 *  1. Deletes ALL existing membretes, sessions, and activity for the company
 *  2. Uses the REAL 44 zones and 20 armadores from Firestore
 *  3. Simulates picking activity from 20:00 → 23:26 (3h 26min)
 *  4. Hour-by-hour realistic load curve (ramp → peak → sustain → wind-down)
 *  5. Each zone gets membretes proportional to its priority
 *  6. Creates sessions for completed membretes
 *  7. Activity log entries for every event
 *  8. Handles Firestore 500-op batch limit via chunking
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// ─── Config ───────────────────────────────────────────────────────────────
const PROJECT_ID = "siamo-indicador";
const COMPANY_ID = "gVmsANoC4vApiGRw7sWL";
const SHIFT_START_HOUR = 20; // 8 PM
const SHIFT_END_MINUTE = 206; // 3h 26min after 20:00 = 23:26
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

// ─── Helpers ──────────────────────────────────────────────────────────────
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** Timestamp for a given minute offset from shift start (20:00) */
function shiftMs(minuteOffset) {
  const base = new Date(TODAY);
  base.setHours(SHIFT_START_HOUR, 0, 0, 0);
  return base.getTime() + minuteOffset * 60 * 1000;
}

/** Format ms as HH:MM for display */
function fmtTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Product catalog ──────────────────────────────────────────────────────
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
  { codigo: "234567", descripcion: "DETERGENTE AXION 500G X 12" },
  { codigo: "234568", descripcion: "DETERGENTE AXION 250G X 24" },
  { codigo: "245678", descripcion: "CLOROX 1L X 12" },
  { codigo: "245679", descripcion: "CLOROX 500ML X 24" },
  { codigo: "256789", descripcion: "SHAMPOO HEAD&SHOULDERS 400ML X 12" },
  { codigo: "267890", descripcion: "PAPEL HIGIENICO KATY 4 UDS X 30" },
  { codigo: "278901", descripcion: "ESCOBA TORONJIL X 12" },
  { codigo: "289012", descripcion: "TRAPEADOR MANOS LIBRES X 24" },
  { codigo: "290123", descripcion: "ESPECIAL BLUE 200G X 12" },
  { codigo: "301234", descripcion: "ARROZ DIARY 1KG X 12" },
  { codigo: "312345", descripcion: "QUESO MOZZARELLA 500G X 8" },
  { codigo: "323456", descripcion: "MARGARINA MANTY 500G X 12" },
  { codigo: "334567", descripcion: "GALLETAS ROCOCO 150G X 24" },
  { codigo: "345678", descripcion: "CHOCOLATE JET 35G X 48" },
  { codigo: "356789", descripcion: "HALLS 30G X 36" },
  { codigo: "367890", descripcion: "CHUPETA BONBON 12G X 100" },
  { codigo: "378901", descripcion: "GOMITAS TROLLI 120G X 24" },
  { codigo: "389012", descripcion: "CARAMELO VASOQUITA 10G X 100" },
  { codigo: "390123", descripcion: "MUTANT 250ML X 24" },
  { codigo: "401234", descripcion: "AGUA CRISTAL 600ML X 12" },
];

// ─── Unassigned armadores → assign them to zones ──────────────────────────
const EXTRA_ASSIGNMENTS = {
  "armador": "Z01",
  "armador 2": "Z02",
  "armador3": "Z03",
  "armador4": "Z04",
  "armador5": "Z05",
  "armador6": "Z06",
  "armador7": "Z07",
  "Santiago": "RACK-01",
};

// ─── Hour-by-hour load configuration ──────────────────────────────────────
// Each hour segment: [startMinute, endMinute, zoneActivityRate, membretesPerActiveZone, incidentChance]
// zoneActivityRate = % of zones that are active that hour
// membretesPerActiveZone = how many membretes each active zone gets
const HOUR_SEGMENTS = [
  { startMin: 0,   endMin: 60,  label: "20:00–21:00", rate: 0.75, memsPerZone: [2, 4], incidentChance: 0.02 },
  { startMin: 60,  endMin: 120, label: "21:00–22:00", rate: 0.90, memsPerZone: [3, 5], incidentChance: 0.04 },
  { startMin: 120, endMin: 180, label: "22:00–23:00", rate: 0.85, memsPerZone: [3, 5], incidentChance: 0.03 },
  { startMin: 180, endMin: 206, label: "23:00–23:26", rate: 0.65, memsPerZone: [1, 3], incidentChance: 0.02 },
];

// ─── Batch helper (max 500 ops per batch) ─────────────────────────────────
const BATCH_LIMIT = 450; // leave margin
let pendingOps = 0;
let batch = db.batch();
let batchCount = 0;

function batchSet(ref, data) {
  batch.set(ref, data);
  pendingOps++;
  if (pendingOps >= BATCH_LIMIT) {
    return flushBatch();
  }
  return Promise.resolve();
}

function batchDelete(ref) {
  batch.delete(ref);
  pendingOps++;
  if (pendingOps >= BATCH_LIMIT) {
    return flushBatch();
  }
  return Promise.resolve();
}

async function flushBatch() {
  if (pendingOps === 0) return;
  console.log(`   📤 Flushing batch #${++batchCount} (${pendingOps} ops)...`);
  await batch.commit();
  pendingOps = 0;
  batch = db.batch();
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function seed() {
  console.log("🔥 Stress-test simulation seed");
  console.log(`   Company: ${COMPANY_ID}`);
  console.log(`   Date: ${TODAY_STR}`);
  console.log(`   Window: 20:00 → 23:26 (3h 26min)`);
  console.log();

  // ─── 1. Fetch real zones and armadores ──────────────────────────────────
  console.log("📡 Fetching real data from Firestore...");
  const zonesSnap = await db.collection("zones").where("companyId", "==", COMPANY_ID).get();
  const armadoresSnap = await db.collection("armadores").where("companyId", "==", COMPANY_ID).get();

  const zones = [];
  for (const doc of zonesSnap.docs) {
    const d = doc.data();
    zones.push({ ref: doc.ref, id: doc.id, code: d.code, name: d.name, sector: d.sector || "A", prioridad: d.prioridad || "media" });
  }

  const armadores = [];
  for (const doc of armadoresSnap.docs) {
    const d = doc.data();
    let zonaCode = d.zonaAsignadaCode || null;
    // Assign unassigned armadores
    if (!zonaCode && EXTRA_ASSIGNMENTS[d.name]) {
      zonaCode = EXTRA_ASSIGNMENTS[d.name];
    }
    armadores.push({ ref: doc.ref, id: doc.id, name: d.name, color: d.color, zonaCode });
  }

  console.log(`   Zones: ${zones.length}`);
  console.log(`   Armadores: ${armadores.length}`);
  console.log();

  // ─── 2. Delete existing data ────────────────────────────────────────────
  console.log("🗑️  Deleting existing membretes, sessions, activity...");
  const existingMems = await db.collection("membretes").where("companyId", "==", COMPANY_ID).get();
  for (const doc of existingMems.docs) {
    await batchDelete(doc.ref);
  }
  await flushBatch();

  const existingSess = await db.collection("sessions").get();
  for (const doc of existingSess.docs) {
    await batchDelete(doc.ref);
  }
  await flushBatch();

  const existingAct = await db.collection("activity").where("companyId", "==", COMPANY_ID).get();
  for (const doc of existingAct.docs) {
    await batchDelete(doc.ref);
  }
  await flushBatch();

  console.log(`   Deleted ${existingMems.size} membretes, ${existingSess.size} sessions, ${existingAct.size} activities`);
  console.log();

  // ─── 3. Update company with jornada ─────────────────────────────────────
  console.log("⚙️  Setting jornada...");
  await db.collection("companies").doc(COMPANY_ID).update({
    jornadaActiva: true,
    jornadaStartedAt: shiftMs(0),
    jornadaPausedAt: null,
    jornadaShiftInicio: "20:00",
    jornadaShiftFin: "06:00",
  });
  console.log("   ✅ Jornada active, shift: 20:00–06:00");
  console.log();

  // ─── 4. Build zone lookup ───────────────────────────────────────────────
  const zoneByCode = {};
  for (const z of zones) {
    zoneByCode[z.code] = z;
  }

  // Build armador lookup by zone
  const armadoresByZone = {};
  for (const a of armadores) {
    if (a.zonaCode) {
      if (!armadoresByZone[a.zonaCode]) armadoresByZone[a.zonaCode] = [];
      armadoresByZone[a.zonaCode].push(a);
    }
  }

  // ─── 5. Simulate hour by hour ───────────────────────────────────────────
  let membreteCount = 0;
  let sessionCount = 0;
  let activityCount = 0;
  let incidentCount = 0;

  for (const seg of HOUR_SEGMENTS) {
    console.log(`⏰ ${seg.label} — ${Math.round(seg.rate * 100)}% zones active`);

    // Pick which zones are active this hour
    const shuffledZones = shuffle(zones);
    const activeZoneCount = Math.ceil(zones.length * seg.rate);
    const activeZones = shuffledZones.slice(0, activeZoneCount);

    for (const zone of activeZones) {
      const memCount = randInt(seg.memsPerZone[0], seg.memsPerZone[1]);

      for (let mi = 0; mi < memCount; mi++) {
        // Random minute within this hour segment
        const startMin = seg.startMin + randInt(2, seg.endMin - seg.startMin - 5);
        const startMs = shiftMs(startMin);

        // Assign armador: prefer zone's armador, fallback to any
        const zoneArms = armadoresByZone[zone.code] || [];
        const assignedArmador = zoneArms.length > 0 ? pick(zoneArms) : pick(armadores);

        // Pick random products (3-8)
        const productCount = randInt(3, 8);
        const shuffledProducts = shuffle(PRODUCTS).slice(0, productCount);
        const memProducts = shuffledProducts.map((p) => ({
          ...p,
          cantidad: randInt(5, 50),
          cantidadReal: 0,
          status: "pending",
        }));

        // Determine if incident
        const isIncident = Math.random() < seg.incidentChance;

        // Duration: 8-25 minutes (realistic picking time)
        const durationMin = randInt(8, 25);
        const durationMs = durationMin * 60 * 1000;
        const finishMs = startMs + durationMs;

        // Status: most are completed, some active (near the end), few pending
        let memStatus;
        let isCompleted;
        let isActive;

        if (isIncident) {
          memStatus = "active";
          isCompleted = false;
          isActive = true;
        } else if (seg.endMin >= 180 && mi === 0) {
          // Last segment: some still active
          memStatus = "active";
          isCompleted = false;
          isActive = true;
        } else if (seg.endMin >= 180 && mi === 1 && Math.random() < 0.3) {
          memStatus = "pending";
          isCompleted = false;
          isActive = false;
        } else {
          memStatus = "completed";
          isCompleted = true;
          isActive = false;
        }

        // Mark products
        if (isCompleted) {
          for (let p = 0; p < productCount; p++) {
            memProducts[p].status = "completed";
            memProducts[p].cantidadReal = memProducts[p].cantidad;
            memProducts[p].completedAt = startMs + (p + 1) * randInt(1, 4) * 60 * 1000;
          }
        } else if (isActive) {
          const doneCount = isIncident ? randInt(1, productCount - 1) : randInt(1, productCount);
          const shuffled = shuffle(memProducts);
          for (let p = 0; p < doneCount && p < productCount; p++) {
            shuffled[p].status = "completed";
            shuffled[p].cantidadReal = shuffled[p].cantidad;
            shuffled[p].completedAt = startMs + (p + 1) * randInt(1, 3) * 60 * 1000;
          }
          if (isIncident) {
            const pending = shuffled.find((p) => p.status === "pending");
            if (pending) {
              pending.status = "incident";
              pending.incidentNote = pick([
                "Producto no encontrado en ubicación",
                "Cantidad no coincide con sistema",
                "Producto dañado en estiba",
                "Código de barras no escanea",
                "Espacio lleno, reubicar producto",
              ]);
              pending.completedAt = startMs + randInt(3, 10) * 60 * 1000;
            }
          }
        }

        // Build membrete code
        const memCode = `M-${String(membreteCount + 1).padStart(3, "0")}`;

        const memData = {
          companyId: COMPANY_ID,
          code: memCode,
          ruta: `R${randInt(100, 999)}/${randInt(10000000, 99999999)}`,
          pallet: String(randInt(1, 12)).padStart(3, "0"),
          palletTotal: String(randInt(4, 16)).padStart(3, "0"),
          fechaEntrega: `${String(TODAY.getDate()).padStart(2, "0")}.${String(TODAY.getMonth() + 1).padStart(2, "0")}.${TODAY.getFullYear()}`,
          familia: pick(["TBCOL07", "TBCOL12", "TBCOL19", "TBCOL25", "TBCOL30", "TBCOL35"]),
          camion: String(randInt(20000, 29999)),
          zonaId: zone.id,
          zonaCode: zone.code,
          armadorId: memStatus !== "pending" ? assignedArmador.id : null,
          armadorName: memStatus !== "pending" ? assignedArmador.name : "",
          status: memStatus,
          products: memProducts,
          totalProducts: productCount,
          totalUnits: memProducts.reduce((s, p) => s + p.cantidad, 0),
          createdAt: startMs - randInt(1, 8) * 60 * 1000,
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

        await batchSet(db.collection("membretes").doc(), memData);
        membreteCount++;

        // Session for completed membretes
        if (isCompleted) {
          const pauseCount = Math.random() < 0.3 ? randInt(1, 2) : 0;
          const pauseMs = pauseCount * randInt(1, 3) * 60 * 1000;

          await batchSet(db.collection("sessions").doc(), {
            zoneCode: zone.code,
            startTime: startMs,
            endTime: finishMs,
            duration: Math.round((durationMs - pauseMs) / 1000),
            armadorId: assignedArmador.id,
            pauseMs,
            pauseCount,
          });
          sessionCount++;

          // Activity: completed
          await batchSet(db.collection("activity").doc(), {
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

        // Activity: started (for active and completed)
        if (memStatus !== "pending") {
          await batchSet(db.collection("activity").doc(), {
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

        // Activity: incident
        if (isIncident) {
          incidentCount++;
          await batchSet(db.collection("activity").doc(), {
            companyId: COMPANY_ID,
            type: "membrete_product_incident",
            message: `${assignedArmador.name} reportó incidencia en ${zone.code} — ${memProducts.find((p) => p.status === "incident")?.incidentNote || "Incidente"}`,
            zoneCode: zone.code,
            armadorId: assignedArmador.id,
            armadorName: assignedArmador.name,
            createdAt: startMs + randInt(3, 10) * 60 * 1000,
          });
          activityCount++;
        }
      }
    }

    console.log(`   ✅ ${activeZones.length} zones active, ${membreteCount} membretes total so far`);
  }

  // ─── 6. Flush remaining ─────────────────────────────────────────────────
  await flushBatch();

  // ─── 7. Update zone completedSessions counts ────────────────────────────
  console.log("\n📊 Updating zone session counts...");
  const finalMems = await db.collection("membretes").where("companyId", "==", COMPANY_ID).where("status", "==", "completed").get();
  const completedByZone = {};
  for (const doc of finalMems.docs) {
    const z = doc.data().zonaCode;
    completedByZone[z] = (completedByZone[z] || 0) + 1;
  }
  for (const zone of zones) {
    const count = completedByZone[zone.code] || 0;
    if (count > 0) {
      await db.collection("zones").doc(zone.id).update({ completedSessions: count });
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "═".repeat(60));
  console.log("📊 SIMULATION SUMMARY");
  console.log("═".repeat(60));
  console.log(`   Company:  ${COMPANY_ID}`);
  console.log(`   Date:     ${TODAY_STR}`);
  console.log(`   Window:   20:00 → 23:26 (3h 26min)`);
  console.log(`   Zones:    ${zones.length} (all real zones)`);
  console.log(`   Armadores: ${armadores.length} (all real armadores)`);
  console.log("─".repeat(60));
  console.log(`   Membretes:  ${membreteCount}`);
  console.log(`   Sessions:   ${sessionCount}`);
  console.log(`   Activities: ${activityCount}`);
  console.log(`   Incidents:  ${incidentCount}`);
  console.log("─".repeat(60));
  console.log("   Hour-by-hour load:");
  for (const seg of HOUR_SEGMENTS) {
    const bar = "█".repeat(Math.round(seg.rate * 20));
    console.log(`     ${seg.label}  ${bar} ${Math.round(seg.rate * 100)}%`);
  }
  console.log("─".repeat(60));
  console.log("   Top zones by membretes:");
  const zoneCounts = {};
  for (const doc of finalMems.docs) {
    const z = doc.data().zonaCode;
    zoneCounts[z] = (zoneCounts[z] || 0) + 1;
  }
  const sorted = Object.entries(zoneCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [code, count] of sorted) {
    console.log(`     ${code.padEnd(25)} ${count} membretes`);
  }
  console.log("═".repeat(60));
  console.log("\n🎯 Open Pantalla en vivo → select this company → watch the data live!");
}

seed().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
