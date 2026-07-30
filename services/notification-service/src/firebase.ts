// STUB: Firebase notification stub for development
// In production, uncomment the Firebase integration below

import admin from "firebase-admin";

let firebaseInitialized = false;

export function initFirebase() {
  if (firebaseInitialized) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    console.log("[FIREBASE STUB] No credentials configured - using console logging");
    return;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    firebaseInitialized = true;
    console.log("[FIREBASE] Initialized successfully");
  } catch (error: any) {
    console.log("[FIREBASE STUB] Initialization failed - using console logging:", error.message);
  }
}

export interface PushNotification {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPushNotification(
  notification: PushNotification
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!firebaseInitialized) {
    console.log("[PUSH STUB] To:", notification.token);
    console.log("[PUSH STUB] Title:", notification.title);
    console.log("[PUSH STUB] Body:", notification.body);
    return { success: true, messageId: "stub-" + Date.now() };
  }

  try {
    const message = {
      token: notification.token,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: notification.data || {},
    };

    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error: any) {
    console.error("[FIREBASE] Error sending push:", error);
    return { success: false, error: error.message };
  }
}

export async function sendToTopic(
  topic: string,
  notification: Omit<PushNotification, "token">
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!firebaseInitialized) {
    console.log("[PUSH STUB] To topic:", topic);
    console.log("[PUSH STUB] Title:", notification.title);
    console.log("[PUSH STUB] Body:", notification.body);
    return { success: true, messageId: "stub-" + Date.now() };
  }

  try {
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
      },
      topic: topic,
      data: notification.data || {},
    };

    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error: any) {
    console.error("[FIREBASE] Error sending to topic:", error);
    return { success: false, error: error.message };
  }
}

export function isFirebaseInitialized(): boolean {
  return firebaseInitialized;
}
