/**
 * Firebase Configuration
 * Replace these values with your actual Firebase project config
 *
 * To get these values:
 * 1. Go to Firebase Console (https://console.firebase.google.com)
 * 2. Select your project
 * 3. Click gear icon > Project Settings
 * 4. Scroll to "Your apps" and select Web app (</>)
 * 5. Copy the firebaseConfig object values
 */

const firebaseConfig = {
  apiKey: "AIzaSyBZR-cG1eX8aZBQVbSUcwqPuaO2NhGCxxo",
  authDomain: "restaurant-oracle.firebaseapp.com",
  projectId: "restaurant-oracle",
  storageBucket: "restaurant-oracle.firebasestorage.app",
  messagingSenderId: "638911364090",
  appId: "1:638911364090:web:6caa615cc0073090664243",
  measurementId: "G-BZ09HYHC88"
};

// Cloud Function URL - Will be available after deploying functions
const CLOUD_FUNCTION_URL = "https://us-central1-restaurant-oracle.cloudfunctions.net/api";

// Export for use in main app
window.FIREBASE_CONFIG = firebaseConfig;
window.CLOUD_FUNCTION_URL = CLOUD_FUNCTION_URL;
