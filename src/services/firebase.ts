import admin from "firebase-admin";
import { getEnv } from "../lib/env-helper.ts";

let firebaseApp: admin.app.App | null = null;

/** Get or initialize the Firebase Admin SDK */
export function getFirebaseAdmin(): admin.app.App {
  if (firebaseApp) return firebaseApp;

  const projectId = getEnv("FIREBASE_PROJECT_ID");
  const clientEmail = getEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = getEnv("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    // Fallback: use application default credentials
    firebaseApp = admin.initializeApp();
  }

  return firebaseApp;
}
