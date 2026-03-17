const admin = require('firebase-admin');

// Initialise lazily — called the first time messaging() is needed,
// guaranteeing dotenv has already loaded process.env values.
let initialised = false;

function ensureInitialised() {
  if (!initialised) {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId:   process.env.FIREBASE_PROJECT_ID,
          privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        }),
      });
    }
    initialised = true;
  }
}

// Proxy object — same API as before (admin.messaging(), etc.)
// but init is deferred until first use.
module.exports = new Proxy(admin, {
  get(target, prop) {
    ensureInitialised();
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});