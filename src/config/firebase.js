let adminApp;
let adminAuth;
let firebaseFirestore;
let firebaseMessaging;
let firebaseInitialized = false;

try {
  const firebaseAppModule = require('firebase-admin/app');
  const firebaseAuthModule = require('firebase-admin/auth');
  const firebaseFirestoreModule = require('firebase-admin/firestore');
  const firebaseMessagingModule = require('firebase-admin/messaging');
  adminApp = firebaseAppModule;
  adminAuth = firebaseAuthModule;
  firebaseFirestore = firebaseFirestoreModule;
  firebaseMessaging = firebaseMessagingModule;
} catch (error) {
  console.error('❌ Failed to load firebase-admin:', error);
}

/**
 * Initialize Firebase Admin SDK
 */
function initFirebase() {
  if (firebaseInitialized) return;

  if (!adminApp || !adminAuth) {
    throw new Error('firebase-admin package is not installed');
  }

  try {
    if (adminApp.getApps().length === 0) {
      const serviceAccount = {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY
          ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          : undefined,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        client_id: process.env.FIREBASE_CLIENT_ID,
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
        universe_domain: 'googleapis.com',
      };

      adminApp.initializeApp({
        credential: adminApp.cert(serviceAccount),
      });
    }

    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialized successfully');
  } catch (error) {
    firebaseInitialized = false;
    console.error('❌ Firebase initialization failed:', error);
    throw error;
  }
}

/**
 * Verify Firebase ID Token
 */
async function verifyFirebaseToken(idToken) {
  try {
    if (!firebaseInitialized) {
      initFirebase();
    }

    const decodedToken = await adminAuth.getAuth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('❌ Firebase token verification error:', error);
    throw error;
  }
}

/**
 * Get Firebase Auth instance
 */
function getAuth() {
  if (!firebaseInitialized) {
    initFirebase();
  }

  return adminAuth.getAuth();
}

/**
 * Get Firestore instance
 */
function getFirestore() {
  if (!firebaseInitialized) {
    initFirebase();
  }
  if (!firebaseFirestore) {
    throw new Error('firebase-admin/firestore is not installed');
  }
  return firebaseFirestore.getFirestore();
}

/**
 * Get Firebase Cloud Messaging (FCM) instance
 */
function getMessaging() {
  if (!firebaseInitialized) {
    initFirebase();
  }
  if (!firebaseMessaging) {
    throw new Error('firebase-admin/messaging is not installed');
  }
  return firebaseMessaging.getMessaging();
}

module.exports = {
  initFirebase,
  verifyFirebaseToken,
  getAuth,
  getFirestore,
  getMessaging,
};
