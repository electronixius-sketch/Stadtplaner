// Deutsche Namen für Gebäude, Bürger und Zwitscher-Nachrichten.
import { pick } from './util.js';

const SURNAMES = ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann',
  'Koch', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hartmann',
  'Lange', 'Werner', 'Schmitz', 'Krause', 'Meier', 'Lehmann', 'Köhler', 'Herrmann', 'König', 'Walter', 'Huber',
  'Kaiser', 'Fuchs', 'Peters', 'Lang', 'Scholz', 'Möller', 'Weiß', 'Jung', 'Hahn', 'Vogel', 'Friedrich', 'Keller',
  'Günther', 'Frank', 'Berger', 'Winkler', 'Roth', 'Beck', 'Lorenz', 'Baumann', 'Albrecht', 'Schuster', 'Simon',
  'Ludwig', 'Böhm', 'Winter', 'Kraus', 'Krämer', 'Vogt', 'Stein', 'Jäger', 'Otto', 'Sommer', 'Groß', 'Seidel',
  'Brandt', 'Haas', 'Dietrich', 'Ziegler', 'Kuhn', 'Pohl', 'Engel', 'Horn', 'Busch', 'Bergmann', 'Thomas', 'Voigt',
  'Sauer', 'Arnold', 'Wolff', 'Pfeiffer', 'Yilmaz', 'Kaya', 'Nowak', 'Kowalski', 'Rossi', 'Nguyen', 'Popescu'];
const FIRST = ['Lena', 'Mia', 'Emma', 'Hannah', 'Sophie', 'Lea', 'Anna', 'Marie', 'Laura', 'Julia', 'Clara', 'Ella',
  'Paul', 'Leon', 'Lukas', 'Finn', 'Jonas', 'Ben', 'Elias', 'Noah', 'Felix', 'Max', 'Tom', 'Jan', 'Moritz', 'David',
  'Ayşe', 'Mehmet', 'Fatma', 'Aleksander', 'Zofia', 'Giulia', 'Karl', 'Greta', 'Ida', 'Oskar', 'Frieda', 'Emil'];

const SHOPS = ['Bäckerei {n}', 'Café Sonnenschein', 'Metzgerei {n}', 'Blumen {n}', '{n}s Kiosk', 'Buchhandlung {n}',
  'Eiscafé Venezia', 'Apotheke am Markt', 'Friseur {n}', 'Frischmarkt', 'Pizzeria Bella', 'Döner Palast',
  'Optik {n}', 'Schuhhaus {n}', 'Weinhandlung {n}', 'Fahrradladen {n}', 'Bio-Laden Grünkern', 'Spielwaren {n}'];
const MALLS = ['Kaufhaus {n}', 'Einkaufszentrum Mitte', 'Galeria {n}', 'Stadtcenter', 'Elektromarkt Blitz',
  'Möbelhaus {n}', 'Shopping-Arkaden', 'Kino Lichtspiel', 'Hotel {n}', 'Markthalle'];
const INDUSTRY = ['{n} Metallbau GmbH', 'Holzwerk {n}', 'Logistik {n}', 'Brauerei {n}', '{n} Maschinenbau',
  'Spedition {n}', 'Textilwerk Nord', 'Chemie {n} AG', 'Ziegelei {n}', 'Druckerei {n}', 'Recycling {n}',
  'Lebensmittelwerk {n}', 'Autoteile {n}', 'Papierfabrik {n}'];
const OFFICES = ['{n} & Partner', 'Datenwerk AG', 'Nordlicht Versicherung', '{n} Consulting', 'Stadtsparkasse',
  'Bürohaus {n}', 'Technologiepark', '{n} Software GmbH', 'Agentur Blickfang', 'Kanzlei {n}', 'Medienhaus {n}',
  'Immobilien {n}', 'Forschungszentrum'];

export function citizenName(rng) {
  return pick(rng, FIRST) + ' ' + pick(rng, SURNAMES);
}

export function handle(rng) {
  return '@' + pick(rng, FIRST) + '_' + pick(rng, SURNAMES).replace(/[^A-Za-zÄÖÜäöüß]/g, '');
}

export function buildingName(b, rng) {
  const n = pick(rng, SURNAMES);
  const fill = (s) => s.replace('{n}', n);
  switch (b.zone) {
    case 1: return rng() < 0.5 ? `Haus ${n}` : `Familie ${n}`;
    case 2: return pick(rng, ['Wohnanlage', 'Wohnhaus', 'Residenz', 'Wohnpark', 'Mehrfamilienhaus']) + ' ' + n;
    case 3: return fill(pick(rng, SHOPS));
    case 4: return fill(pick(rng, MALLS));
    case 5: return fill(pick(rng, INDUSTRY));
    case 6: return fill(pick(rng, OFFICES));
    default: return n;
  }
}

const CHIRPS = {
  welcome: ['Endlich eine eigene Wohnung in {city}! 🏡', 'Erster Tag in {city}. Die Luft ist so frisch! 🌿',
    'Umzugskartons ausgepackt. Hallo {city}! 📦'],
  power: ['Schon wieder Stromausfall! Mein Kühlschrank taut ab. ⚡😠', 'Wer hat das Licht ausgemacht? Wir brauchen mehr Strom! 🔌',
    'Kein Strom, kein WLAN, keine Laune. ⚡'],
  water: ['Aus dem Wasserhahn kommt nur noch Luft! 💧', 'Wir brauchen dringend mehr Wasserpumpen! 🚰'],
  sewage: ['Es riecht… ungut. Die Abwasserkapazität reicht nicht! 🤢', 'Die Toilette spült nicht mehr. Bitte mehr Abwasseranlagen! 🚽'],
  conn: ['Unsere Straßen sind nicht an die Autobahn angeschlossen. Wie sollen hier Leute hinziehen? 🛣️'],
  unemployment: ['Ich finde in {city} einfach keinen Job. 😞', 'Bewerbung Nummer 37… Wir brauchen mehr Arbeitsplätze! 📄'],
  taxes: ['Die Steuern sind viel zu hoch! 💸', 'Bei diesen Steuern ziehe ich bald weg. 😤'],
  garbage: ['Der Müll stapelt sich vor der Tür! Wir brauchen eine Deponie. 🗑️'],
  fire: ['Feuer! Es brennt in {where}! 🔥🚒', 'Rauchwolke über {city}. Hoffentlich kommt die Feuerwehr! 🔥'],
  fireOut: ['Die Feuerwehr war blitzschnell da. Danke! 🚒👏'],
  burned: ['{where} ist abgebrannt. Wir brauchen eine Feuerwache in der Nähe! 😢🔥'],
  needC: ['Wo soll ich hier eigentlich einkaufen? Mehr Geschäfte bitte! 🛍️'],
  needI: ['Die Läden haben keine Ware – wir brauchen Industrie! 🏭'],
  needR: ['Die Firmen suchen händeringend Personal. Wir brauchen mehr Wohnraum! 🏘️'],
  happy: ['Ich liebe {city}! ❤️', 'Spaziergang im Park – herrlich hier! 🌳', 'Bester Bürgermeister aller Zeiten! 👍',
    'Neues Café um die Ecke entdeckt. ☕', 'Was für ein Sonnenuntergang über {city}! 🌇'],
  traffic: ['Stau, Stau, Stau. Ich komme schon wieder zu spät! 🚗🚗🚗', 'Mehr Straßen oder Alleen, bitte! 🚦'],
  pollution: ['Die Luft riecht nach Fabrik. Hust! 🏭😷'],
  crime: ['Mir wurde das Fahrrad geklaut. Wo ist die Polizei? 🚲👮'],
  sick: ['Das Wartezimmer ist überfüllt. Wir brauchen mehr Ärzte! 🩺'],
  school: ['Meine Kinder brauchen eine Schule! 🏫'],
  abandoned: ['Das Haus nebenan steht jetzt leer. Traurig. 🏚️'],
  milestone: ['{city} ist jetzt offiziell {what}! 🎉', 'Wir sind {what}! Party im Rathaus! 🥳'],
  broke: ['Die Stadtkasse ist leer! Steuern rauf oder Ausgaben runter. 💰'],
  levelup: ['Unser Viertel blüht richtig auf! ✨'],
};

export function chirpText(type, rng, ctx = {}) {
  const list = CHIRPS[type];
  if (!list) return '';
  return pick(rng, list).replace('{city}', ctx.city || 'der Stadt').replace('{where}', ctx.where || 'der Stadt')
    .replace('{what}', ctx.what || '');
}

export const CITY_NAMES = ['Neustadt', 'Sonnenberg', 'Lindenfeld', 'Rheinhafen', 'Eichenau', 'Seeburg', 'Waldheim',
  'Grünwiese', 'Hohenfurt', 'Mühlbach', 'Falkenstein', 'Rosental', 'Birkenhain', 'Brückenstadt', 'Kranichfeld'];
