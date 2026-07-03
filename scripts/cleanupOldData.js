const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const serviceAccount = require('../key.json');

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: 'bool-345a4.firebasestorage.app',
});

const db = getFirestore();
const bucket = getStorage().bucket();

async function deleteOldFirestorePeople() {
  const oldIds = ['Voelk', 'Ocho', 'Boolter', 'Tolsma', 'Emilio', 'Brando'];
  for (const id of oldIds) {
    await db.collection('people').doc(id).delete();
    console.log(`Deleted Firestore person: ${id}`);
  }
}

async function deleteOldStorageFolder(prefix) {
  const [files] = await bucket.getFiles({ prefix });
  for (const file of files) {
    await file.delete();
    console.log(`Deleted Storage file: ${file.name}`);
  }
}

async function main() {
  console.log('Cleaning up old data...');
  await deleteOldFirestorePeople();
  await deleteOldStorageFolder('groups/');
  await deleteOldStorageFolder('people/');
  console.log('Done!');
}

main().catch(console.error);
