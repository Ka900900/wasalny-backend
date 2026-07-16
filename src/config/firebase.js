const fs = require('fs');
const path = require('path');

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
      const possiblePaths = [
        path.join(process.cwd(), 'config', 'firebase-service-account.json'),
        path.join(process.cwd(), 'config', 'firebase-service-account.json.json'),
      ];

      const serviceAccountPath = possiblePaths.find((candidate) => fs.existsSync(candidate));

      if (!serviceAccountPath) {
        throw new Error('Firebase service account file not found');
      }

      const serviceAccount = require(serviceAccountPath);
      adminApp.initializeApp({
        credential: adminApp.cert(serviceAccount),
      });
    }

    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialized');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
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
