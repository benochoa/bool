import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyDiNf9Is6XFVjzkGyMBO1wWjwSz8p8R7xU",
  authDomain: "bool-345a4.firebaseapp.com",
  projectId: "bool-345a4",
  storageBucket: "bool-345a4.firebasestorage.app",
  messagingSenderId: "892629766179",
  appId: "1:892629766179:web:adbbc7a9ff7c89b2c1a196",
  measurementId: "G-X2EW750Q66"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
