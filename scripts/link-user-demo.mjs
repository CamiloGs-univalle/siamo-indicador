import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = getApps().length === 0
  ? initializeApp({ credential: cert({
      projectId: "siamo-indicador",
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
    }) })
  : getApps()[0];
const db = getFirestore(app);

async function run() {
  const snap = await db.collection("users").get();
  console.log("Users found:", snap.size);
  for (const doc of snap.docs) {
    const d = doc.data();
    console.log(doc.id, "->", d.email, "companyId:", d.companyId, "role:", d.role);
  }
  
  const REAL_COMPANY = "gVmsANoC4vApiGRw7sWL";
  
  for (const doc of snap.docs) {
    const d = doc.data();
    // Skip super_admin (no companyId) and armadores (they belong to the real company)
    if (d.role === "super_admin") continue;
    await doc.ref.update({ companyId: REAL_COMPANY });
    console.log("Restored", doc.id, "->", REAL_COMPANY);
  }
  console.log("Done!");
}
run();
