/**
 * Borra los 3 docs "fantasma" en la colección `users`: fueron creados por
 * el login/botón viejo con un ID que NO es el uid real de Google, así que
 * esas cuentas nunca podrán entrar. Antes de borrar, verifica que cada doc
 * NO tenga campo `uid` (por seguridad, para no borrar algo real por error).
 *
 * Uso (desde la raíz del proyecto, en TU terminal con internet):
 *   node scripts/delete-ghost-admins.mjs
 *
 * Este script requiere red hacia Firestore, así que NO corre dentro del
 * entorno de Claude (sandbox sin salida a internet) — se deja aquí para
 * que tú lo ejecutes. Puedes borrar este archivo después de usarlo.
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "fs";

const envContent = readFileSync(".env.local", "utf-8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) {
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    process.env[m[1]] = val;
  }
}

const serviceAccount = {
  projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
};

const app = getApps().length === 0 ? initializeApp({ credential: cert(serviceAccount) }) : getApps()[0];
const db = getFirestore(app);

const ids = ["gsc777980", "prueba 2", "X1kHpdiBEJvn9oF8nnTR"];

for (const id of ids) {
  const ref = db.collection("users").doc(id);
  const snap = await ref.get();

  if (!snap.exists) {
    console.log(`[SKIP] ${id}: no existe (puede que ya lo hayas borrado)`);
    continue;
  }

  const data = snap.data();
  if (data.uid) {
    console.log(`[SKIP] ${id}: TIENE campo uid ("${data.uid}") — no parece fantasma, no se borra.`);
    continue;
  }

  await ref.delete();
  console.log(`[BORRADO] ${id} (email: ${data.email ?? "?"}, role: ${data.role ?? "?"})`);
}

console.log("Listo.");
