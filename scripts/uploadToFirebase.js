const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const fs = require('fs');
const path = require('path');

const serviceAccount = require('../key.json');

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: 'bool-345a4.firebasestorage.app',
});

const db = getFirestore();
const bucket = getStorage().bucket();

// Maps old local paths to new Person-X IDs
const personMapping = {
  'Data/People/Voelk':   'Person-1',
  'Data/People/Ocho':    'Person-2',
  'Data/People/Boolter': 'Person-3',
  'Data/People/Tolsma':  'Person-4',
  'Data/People/Emilio':  'Person-5',
  'Data/People/Brando':  'Person-6',
};

async function uploadGroups() {
  const groups = ['Group-1', 'Group-2'];

  for (const groupId of groups) {
    const basePath = path.join(__dirname, '..', 'Data', 'Groups', groupId);

    const name = JSON.parse(fs.readFileSync(path.join(basePath, 'Text', 'name.json'), 'utf8'));
    const qa = JSON.parse(fs.readFileSync(path.join(basePath, 'Text', 'qa.json'), 'utf8'));
    const rawMembers = JSON.parse(fs.readFileSync(path.join(basePath, 'Text', 'members.json'), 'utf8'));

    // Map old member paths to Person-X IDs
    const members = rawMembers.map(m => personMapping[m]);

    // Upload all images in the Images folder
    const imagesDir = path.join(basePath, 'Images');
    const imageFiles = fs.readdirSync(imagesDir);
    for (const imageFile of imageFiles) {
      const imagePath = path.join(imagesDir, imageFile);
      const storagePath = `Groups/${groupId}/${imageFile}`;
      const contentType = imageFile.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      await bucket.upload(imagePath, { destination: storagePath, metadata: { contentType } });
      await bucket.file(storagePath).makePublic();
    }

    const storageFolder = `Groups/${groupId}`;

    await db.collection('groups').doc(groupId).set({ name, qa, members, storageFolder });
    console.log(`Uploaded group: ${groupId}`);
  }
}

async function uploadPeople() {
  const people = [
    { localName: 'Voelk',   id: 'Person-1' },
    { localName: 'Ocho',    id: 'Person-2' },
    { localName: 'Boolter', id: 'Person-3' },
    { localName: 'Tolsma',  id: 'Person-4' },
    { localName: 'Emilio',  id: 'Person-5' },
    { localName: 'Brando',  id: 'Person-6' },
  ];

  for (const { localName, id } of people) {
    const basePath = path.join(__dirname, '..', 'Data', 'People', localName);

    const name = JSON.parse(fs.readFileSync(path.join(basePath, 'Text', 'name.json'), 'utf8'));
    const qa = JSON.parse(fs.readFileSync(path.join(basePath, 'Text', 'qa.json'), 'utf8'));

    // Upload all images in the Images folder
    const imagesDir = path.join(basePath, 'Images');
    const imageFiles = fs.readdirSync(imagesDir);
    for (const imageFile of imageFiles) {
      const imagePath = path.join(imagesDir, imageFile);
      const storagePath = `People/${id}/${imageFile}`;
      const contentType = imageFile.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
      await bucket.upload(imagePath, { destination: storagePath, metadata: { contentType } });
      await bucket.file(storagePath).makePublic();
    }

    const storageFolder = `People/${id}`;

    await db.collection('people').doc(id).set({ name, qa, storageFolder });
    console.log(`Uploaded person: ${id} (${localName})`);
  }
}

async function main() {
  console.log('Starting upload...');
  await uploadGroups();
  await uploadPeople();
  console.log('Done!');
}

main().catch(console.error);
