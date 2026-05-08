import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';

// Initialize Firebase once
console.log('Initializing Firebase for Project:', firebaseConfig.projectId);
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Get Firebase services with long polling enabled for stability in sandboxed environments
export const auth = getAuth(app);

let dbInstance: any;
try {
  dbInstance = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true,
  }, (firebaseConfig as any).firestoreDatabaseId);
} catch (error: any) {
  if (error.message && (error.message.includes('already been called') || error.code === 'failed-precondition')) {
    console.warn('Firestore already initialized. Attempting to get existing instance for:', (firebaseConfig as any).firestoreDatabaseId);
    try {
      dbInstance = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
    } catch (getErr) {
      console.warn('getFirestore with ID failed, falling back to default instance');
      dbInstance = getFirestore(app);
    }
  } else {
    console.error('Firestore initialization failed:', error);
    throw error;
  }
}

export const db = dbInstance;

// Connection test with retry logic
async function testConnection(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Testing Firestore connection (attempt ${i + 1})...`);
      await getDocFromServer(doc(db, '_connection_test_', 'ping'));
      console.log('✅ Firestore connection successful');
      return;
    } catch (error: any) {
      console.error(`❌ Connection attempt ${i + 1} failed:`, error.message);
      if (i < retries - 1) {
        const delay = 2000 * (i + 1);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else if (error.message.includes('Could not reach Cloud Firestore backend')) {
        console.warn('CRITICAL: Backend unreachable. This may be a persistent network issue in your environment.');
      }
    }
  }
}

testConnection();

export default app;
