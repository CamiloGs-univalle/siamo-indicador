/**
 * Deja en Firestore lo necesario para que estas personas puedan entrar:
 *   - super_admin: auxiliar.ti@proservis.com.co (ya cubierto por
 *     SUPER_ADMIN_EMAILS, pero este script lo asegura igual, por si acaso).
 *   - admin: camilo13369@gmail.com, para la empresa "prueba".
 *
 * No crea usuarios de Firebase Auth (eso lo hace Google al iniciar sesión).
 * Solo prepara la INVITACIÓN / el perfil para que, cuando esa persona entre
 * con su cuenta de Google, /api/claim-invite le asigne el rol correcto.
 *
 * Uso (en tu terminal, con internet):
 *   node scripts/seed-people.mjs
 */
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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

const SUPER_ADMIN_EMAIL = "auxiliar.ti@proservis.com.co";
const NEW_ADMIN_EMAIL = "camilo13369@gmail.com";
const COMPANY_NAME = "prueba";

async function ensureSuperAdminProfile() {
  const snap = await db
    .collection("users")
    .where("email", "==", SUPER_ADMIN_EMAIL)
    .limit(1)
    .get();

  if (!snap.empty) {
    console.log(`[OK] Ya existe perfil para ${SUPER_ADMIN_EMAIL} (uid=${snap.docs[0].id}, role=${snap.docs[0].data().role})`);
    return;
  }

  console.log(
    `[INFO] Aún no hay perfil para ${SUPER_ADMIN_EMAIL}. No pasa nada: al iniciar sesión con Google, ` +
    `/api/claim-invite lo crea automáticamente como super_admin porque está en SUPER_ADMIN_EMAILS.`
  );
}

async function ensureAdminInvite() {
  const companySnap = await db
    .collection("companies")
    .where("name", "==", COMPANY_NAME)
    .limit(1)
    .get();

  if (companySnap.empty) {
    console.log(`[ERROR] No encontré una empresa llamada "${COMPANY_NAME}". Revisa el nombre exacto y vuelve a correr el script.`);
    return;
  }

  const companyDoc = companySnap.docs[0];
  const companyId = companyDoc.id;

  const existingUser = await db
    .collection("users")
    .where("email", "==", NEW_ADMIN_EMAIL)
    .limit(1)
    .get();

  if (!existingUser.empty) {
    console.log(`[OK] ${NEW_ADMIN_EMAIL} ya tiene perfil de usuario (role=${existingUser.docs[0].data().role}). No se crea invitación.`);
    return;
  }

  const existingInvite = await db
    .collection("invitations")
    .where("email", "==", NEW_ADMIN_EMAIL)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (!existingInvite.empty) {
    console.log(`[OK] Ya había una invitación pendiente para ${NEW_ADMIN_EMAIL} (empresa ${companyId}). No se duplica.`);
    return;
  }

  const inviteRef = await db.collection("invitations").add({
    email: NEW_ADMIN_EMAIL,
    role: "admin",
    companyId,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`[CREADO] Invitación ${inviteRef.id} para ${NEW_ADMIN_EMAIL} → admin de "${COMPANY_NAME}" (companyId=${companyId})`);
}

await ensureSuperAdminProfile();
await ensureAdminInvite();
console.log("Listo.");
