// FlashCard günlük hatırlatma gönderici
// GitHub Actions her saat başı çalıştırır. Her cihazın kendi saat diliminde
// seçtiği saat geldiyse ve tekrar edilecek kelime varsa bildirim gönderir.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT gizli anahtarı bulunamadı (GitHub → Settings → Secrets).');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(raw)) });
const db = getFirestore();
const fcm = getMessaging();

const FORCE = process.env.FORCE === 'true';
const APP_URL = 'https://mehlika-16.github.io/flashcard/';
const now = new Date();

const localDate = (tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const localHour = (tz) =>
  Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(now));

const dueCountCache = new Map();
async function dueCount(uid) {
  if (dueCountCache.has(uid)) return dueCountCache.get(uid);
  const snap = await db.collection('users').doc(uid).collection('cards').get();
  const t = Date.now();
  const n = snap.docs.filter((d) => {
    const c = d.data();
    return !c.mastered && (!c.nextReview || c.nextReview <= t);
  }).length;
  dueCountCache.set(uid, n);
  return n;
}

const devices = await db.collectionGroup('devices').get();
console.log(`${devices.size} cihaz bulundu${FORCE ? ' (test modu)' : ''}.`);

for (const docSnap of devices.docs) {
  const dev = docSnap.data();
  const uid = docSnap.ref.parent.parent.id;
  const tz = dev.tz || 'America/Vancouver';
  const hour = typeof dev.hour === 'number' ? dev.hour : 13;
  const today = localDate(tz);

  if (!FORCE) {
    if (localHour(tz) !== hour) continue;
    if (dev.lastSentDate === today) continue;
  }

  const due = await dueCount(uid);
  if (due === 0 && !FORCE) {
    await docSnap.ref.update({ lastSentDate: today });
    console.log(`- ${docSnap.id.slice(0, 6)}: tekrar yok, bildirim gönderilmedi.`);
    continue;
  }

  const title = due > 0 ? `📚 ${due} kelimenin tekrar vakti geldi` : '🔔 FlashCard test bildirimi';
  const body = due > 0
    ? 'Birkaç dakika ayır, hafızanı tazele! 💪'
    : 'Bildirimler çalışıyor. Bugün tekrar edilecek kelime yok 🎉';

  try {
    await fcm.send({
      token: dev.token,
      data: { title, body, url: APP_URL },
      webpush: { headers: { Urgency: 'high', TTL: '21600' } }
    });
    if (!FORCE) await docSnap.ref.update({ lastSentDate: today, lastSentAt: Date.now() });
    console.log(`✓ ${docSnap.id.slice(0, 6)}: gönderildi (${due} kelime, ${tz} ${hour}:00).`);
  } catch (e) {
    console.error(`✗ ${docSnap.id.slice(0, 6)}: ${e.code || e.message}`);
    if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(e.code)) {
      await docSnap.ref.delete();
      console.error('  geçersiz cihaz kaydı silindi.');
    }
  }
}
