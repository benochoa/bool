const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const serviceAccount = require('C:/Users/jackv/OneDrive/Desktop/key.json');

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();

// Each person gets 3 questions drawn from the individual bank
const peopleQA = {
  'Person-1': [
    { question: "What's your go-to way to spend a free afternoon?", answer: "Hitting the gym in the morning, then finding somewhere new to eat." },
    { question: "How would your closest friends describe you?", answer: "Driven but still knows how to have a good time." },
    { question: "What are you passionate about right now?", answer: "Getting stronger and figuring out what I actually want to do long-term." },
  ],
  'Person-2': [
    { question: "What kind of people do you vibe with most?", answer: "People who actually show up. Nothing worse than flakers." },
    { question: "What's something you're always down to do?", answer: "Grab food, play pickup, or just drive around and see what happens." },
    { question: "What kind of group are you looking to be a part of?", answer: "Something tight-knit where everyone actually knows each other." },
  ],
  'Person-3': [
    { question: "What are you usually up to on a Friday night?", answer: "Probably out somewhere or at a homie's place watching something." },
    { question: "What does a perfect day look like for you?", answer: "Up early, productive morning, then completely free the rest of the day." },
    { question: "What's one thing people are always surprised to learn about you?", answer: "I'm a really good cook. Nobody expects it but it always comes up." },
  ],
  'Person-4': [
    { question: "What's your go-to way to spend a free afternoon?", answer: "Playing ball or just being outside. Can't sit still for too long." },
    { question: "What are you usually up to on a Friday night?", answer: "Usually out. I don't really do staying home on Fridays." },
    { question: "What do you bring to a group dynamic?", answer: "Good energy and someone who can hold a conversation with anyone." },
  ],
  'Person-5': [
    { question: "What kind of people do you vibe with most?", answer: "Genuine people who aren't always performing for someone." },
    { question: "How would your closest friends describe you?", answer: "Funny, reliable, the one who makes everyone feel comfortable." },
    { question: "What does a perfect day look like for you?", answer: "Slow morning, workout, then spending time with people I actually care about." },
  ],
  'Person-6': [
    { question: "What's something you're always down to do?", answer: "Watch film, go to the gym, or link with whoever's free." },
    { question: "What are you passionate about right now?", answer: "Getting better at everything I'm already doing." },
    { question: "What's one thing people are always surprised to learn about you?", answer: "I speak three languages. Comes up when people least expect it." },
  ],
  'Person-7': [
    { question: "What's your go-to way to spend a free afternoon?", answer: "Probably outside doing something — basketball, exploring, whatever." },
    { question: "What kind of group are you looking to be a part of?", answer: "Somewhere I can actually contribute and have a good time doing it." },
    { question: "What do you bring to a group dynamic?", answer: "Positivity and someone who's always down to try something new." },
  ],
  'Person-8': [
    { question: "What are you usually up to on a Friday night?", answer: "Good food somewhere, then see where the night goes." },
    { question: "What's something you're always down to do?", answer: "Hoop, play cards, go for a drive — I'm easy." },
    { question: "What are you passionate about right now?", answer: "Music and figuring out what I want to build for myself." },
  ],
  'Person-9': [
    { question: "What kind of people do you vibe with most?", answer: "People who move with intention. If you know what you want, we'll click." },
    { question: "What does a perfect day look like for you?", answer: "Up early, get a workout in, then be outside the whole afternoon." },
    { question: "What do you bring to a group dynamic?", answer: "I'm the one who makes sure everyone's actually having a good time." },
  ],
};

// Each group gets 3 questions drawn from the group bank
const groupsQA = {
  'Group-1': [
    { question: "What does a typical hangout look like for your group?", answer: "Usually sports or just linking up at someone's place." },
    { question: "What kind of people fit in well with your group?", answer: "Chill, active, someone who fits in naturally without trying too hard." },
    { question: "Is your group more chill or more active?", answer: "Somewhere in between — we know when to lock in and when to relax." },
  ],
  'Group-2': [
    { question: "What's something your group is really good at together?", answer: "Reading the room and adjusting the vibe to whoever's around." },
    { question: "What's the most memorable thing your group has done together?", answer: "A camping trip last summer — still talk about it." },
    { question: "How often does your group hang out?", answer: "Pretty often, at least a couple times a week between everyone." },
  ],
  'Group-3': [
    { question: "How did you all meet?", answer: "We all ended up living together and it just happened naturally." },
    { question: "What do you guys usually do on weekends?", answer: "Sports during the day, something low-key at night usually." },
    { question: "What makes your group different from other groups?", answer: "We actually live together so the bond is different — it's not just a friend group." },
  ],
};

async function main() {
  console.log('Updating Q&A for all people and groups...');

  for (const [id, qa] of Object.entries(peopleQA)) {
    await db.collection('people').doc(id).update({ qa });
    console.log(`Updated ${id}`);
  }

  for (const [id, qa] of Object.entries(groupsQA)) {
    await db.collection('groups').doc(id).update({ qa });
    console.log(`Updated ${id}`);
  }

  console.log('Done!');
}

main().catch(console.error);