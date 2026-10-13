// Zentrale Spielkonstanten und Gebäudedefinitionen.

export const MAP_SIZE = 128;        // Kartengröße in Feldern
export const CHUNK_SIZE = 16;       // Feldgröße eines Render-Chunks
export const ZONE_DEPTH = 3;        // Wie tief Zonen neben Straßen ausgewiesen werden können
export const EXT_PAD = 40;          // Dekoratives Umland um die Karte
export const WATER_LEVEL = -0.12;
export const START_MONEY = 70000;
export const START_YEAR = 2026;
export const HIGHWAY_LEN = 14;

// Echtzeit-Sekunden pro Spieltag für Geschwindigkeit 0..3
export const DAY_SECONDS = [Infinity, 1.6, 0.8, 0.3];
// Wie schnell der Tag/Nacht-Zyklus läuft (Spielstunden pro Echtzeit-Sekunde)
export const CLOCK_SPEED = [0, 0.1, 0.18, 0.34];
// Fahrzeuggeschwindigkeit je Spieltempo
export const TRAFFIC_SPEED = [0, 1, 1.6, 2.4];

// Richtungen: 0 = Nord (-y), 1 = Ost (+x), 2 = Süd (+y), 3 = West (-x)
export const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

export const T_LAND = 0;
export const T_WATER = 1;
export const T_ROCK = 2;

export const ROAD_TYPES = {
  1: { id: 1, key: 'street', name: 'Straße', icon: '🛣️', cost: 12, upkeep: 1.2, speed: 1.0, kmh: 50, capacity: 6, zoneable: true, unlock: 0,
       desc: 'Zweispurige Stadtstraße. Zonen können angrenzen.' },
  2: { id: 2, key: 'avenue', name: 'Allee', icon: '🌳', cost: 30, upkeep: 2.6, speed: 1.35, kmh: 60, capacity: 14, zoneable: true, unlock: 2,
       desc: 'Vierspurig mit Grünstreifen – mehr Kapazität.' },
  3: { id: 3, key: 'highway', name: 'Autobahn', icon: '🛤️', cost: 70, upkeep: 5, speed: 2.1, kmh: 100, capacity: 26, zoneable: false, unlock: 4,
       desc: 'Schnell und leistungsstark. Keine Zonen und keine Zufahrten.' },
};
export const BRIDGE_MULT = 4;

export const ZONES = {
  1: { id: 1, key: 'R', dense: false, name: 'Wohngebiet', short: 'Wohnen', icon: '🏡', color: 0x5fd35a, maxLevel: 3, unlock: 0,
       desc: 'Einfamilienhäuser und Reihenhäuser.' },
  2: { id: 2, key: 'R', dense: true, name: 'Wohngebiet (hohe Dichte)', short: 'Wohnen+', icon: '🏢', color: 0x1f9e3a, maxLevel: 5, unlock: 3,
       desc: 'Mehrfamilienhäuser und Wohntürme.' },
  3: { id: 3, key: 'C', dense: false, name: 'Gewerbegebiet', short: 'Gewerbe', icon: '🏪', color: 0x4dabf7, maxLevel: 3, unlock: 0,
       desc: 'Läden, Cafés und kleine Geschäfte.' },
  4: { id: 4, key: 'C', dense: true, name: 'Gewerbe (hohe Dichte)', short: 'Gewerbe+', icon: '🏬', color: 0x1864d6, maxLevel: 5, unlock: 3,
       desc: 'Kaufhäuser und Einkaufszentren.' },
  5: { id: 5, key: 'I', dense: false, name: 'Industriegebiet', short: 'Industrie', icon: '🏭', color: 0xf2c230, maxLevel: 3, unlock: 0,
       desc: 'Fabriken und Lagerhallen. Verursacht Verschmutzung.' },
  6: { id: 6, key: 'O', dense: true, name: 'Bürogebiet', short: 'Büros', icon: '🏙️', color: 0xb46ee0, maxLevel: 5, unlock: 3,
       desc: 'Bürotürme. Brauchen gebildete Arbeitskräfte.' },
};

// Kapazität (Einwohner bzw. Arbeitsplätze) pro Feld und Stufe
export const CAPACITY = {
  1: [4, 6, 8],
  2: [12, 18, 25, 33, 42],
  3: [2, 3, 4],
  4: [5, 7, 9, 12, 15],
  5: [5, 6, 7],
  6: [8, 11, 14, 18, 22],
};

// Grundstücksgrößen: [Breite (Straßenfront), Tiefe, Gewichtung]
export const LOTS = {
  1: [[1, 1, 6], [1, 2, 3], [2, 2, 1], [1, 3, 1]],
  2: [[2, 2, 3], [2, 3, 2], [3, 3, 2], [1, 2, 1]],
  3: [[1, 1, 4], [1, 2, 3], [2, 2, 2], [1, 3, 1], [2, 3, 1]],
  4: [[2, 2, 3], [3, 3, 2], [2, 3, 2]],
  5: [[2, 2, 3], [2, 3, 2], [3, 3, 2], [1, 2, 1], [1, 3, 1]],
  6: [[2, 2, 3], [3, 3, 2], [2, 3, 1]],
};

// Verbrauch pro Einwohner/Arbeitsplatz (Strom in MW, Wasser in m³/Tag x1000)
export const UTIL_USE = {
  R: { power: 0.012, water: 0.012 },
  C: { power: 0.025, water: 0.01 },
  I: { power: 0.04, water: 0.016 },
  O: { power: 0.02, water: 0.008 },
};

// Steuereinnahmen pro Einwohner/Arbeitsplatz und Tag bei 100 % Steuersatz
export const TAX_YIELD = { R: 1.0, C: 1.5, I: 1.3, O: 1.8 };

export const SERVICES = {
  wind: { cat: 'power', name: 'Windrad', icon: '🌬️', w: 1, h: 1, cost: 900, upkeep: 60, power: 6, noise: 8, unlock: 0,
    desc: 'Saubere Energie: 6 MW.' },
  coal: { cat: 'power', name: 'Kohlekraftwerk', icon: '🏭', w: 3, h: 3, cost: 7000, upkeep: 500, power: 70, jobs: 30,
    pollution: { s: 80, r: 11 }, noise: 30, unlock: 1, desc: 'Viel Strom (70 MW), aber starke Verschmutzung.' },
  solar: { cat: 'power', name: 'Solarpark', icon: '☀️', w: 3, h: 3, cost: 12000, upkeep: 380, power: 40, jobs: 10, unlock: 4,
    desc: 'Sauberer Strom: 40 MW.' },
  pump: { cat: 'water', name: 'Wasserpumpe', icon: '🚰', w: 1, h: 1, cost: 700, upkeep: 45, water: 12, needsWater: true,
    powerUse: 0.3, unlock: 0, desc: 'Fördert 12 Einheiten Frischwasser. Muss am Ufer stehen.' },
  tower: { cat: 'water', name: 'Wasserturm', icon: '🗼', w: 1, h: 1, cost: 1100, upkeep: 75, water: 6, powerUse: 0.3, unlock: 2,
    desc: 'Fördert Grundwasser (6 Einheiten) – überall baubar.' },
  outlet: { cat: 'water', name: 'Abwasserauslass', icon: '🚽', w: 1, h: 1, cost: 600, upkeep: 35, sewage: 12, needsWater: true,
    unlock: 0, desc: 'Leitet 12 Einheiten Abwasser ab. Muss am Ufer stehen.' },
  treatment: { cat: 'water', name: 'Kläranlage', icon: '♻️', w: 2, h: 2, cost: 6000, upkeep: 320, sewage: 50, needsWater: true,
    powerUse: 2, jobs: 12, unlock: 3, desc: 'Reinigt 50 Einheiten Abwasser.' },
  busdepot: { cat: 'transport', name: 'Busdepot', icon: '🚌', w: 2, h: 2, cost: 4000, upkeep: 280, powerUse: 1, jobs: 14, unlock: 1,
    desc: 'Betreibt den Busverkehr. Ohne Depot fahren keine Busse.' },
  busstop: { cat: 'transport', name: 'Bushaltestelle', icon: '🚏', w: 1, h: 1, cost: 250, upkeep: 15, cover: { type: 'transit', r: 7 },
    unlock: 1, desc: 'Bürger im Umkreis fahren Bus statt Auto – weniger Stau, mehr Bodenwert.' },
  landfill: { cat: 'garbage', name: 'Mülldeponie', icon: '🗑️', w: 3, h: 3, cost: 3500, upkeep: 260, cover: { type: 'garbage', r: 26 },
    pollution: { s: 35, r: 6 }, powerUse: 0.5, jobs: 10, unlock: 1, desc: 'Müllabfuhr im großen Umkreis.' },
  incinerator: { cat: 'garbage', name: 'Müllverbrennung', icon: '🔥', w: 2, h: 2, cost: 9000, upkeep: 420,
    cover: { type: 'garbage', r: 36 }, power: 10, pollution: { s: 50, r: 8 }, jobs: 16, unlock: 3,
    desc: 'Entsorgt Müll und erzeugt 10 MW Strom.' },
  police: { cat: 'police', name: 'Polizeiwache', icon: '🚓', w: 2, h: 2, cost: 3500, upkeep: 320, cover: { type: 'police', r: 14 },
    powerUse: 1, jobs: 12, unlock: 1, desc: 'Senkt die Kriminalität in der Umgebung.' },
  policehq: { cat: 'police', name: 'Polizeipräsidium', icon: '👮', w: 3, h: 3, cost: 11000, upkeep: 800,
    cover: { type: 'police', r: 26 }, powerUse: 3, jobs: 40, unlock: 4, desc: 'Großer Wirkungsbereich.' },
  fire: { cat: 'fire', name: 'Feuerwache', icon: '🚒', w: 2, h: 2, cost: 3500, upkeep: 320, cover: { type: 'fire', r: 14 },
    powerUse: 1, jobs: 12, unlock: 1, desc: 'Verhindert und löscht Brände.' },
  clinic: { cat: 'health', name: 'Arztpraxis', icon: '🩺', w: 2, h: 2, cost: 4000, upkeep: 360, cover: { type: 'health', r: 14 },
    powerUse: 1, jobs: 14, unlock: 1, desc: 'Gesundheitsversorgung für die Nachbarschaft.' },
  hospital: { cat: 'health', name: 'Krankenhaus', icon: '🏥', w: 3, h: 3, cost: 12000, upkeep: 900, cover: { type: 'health', r: 28 },
    powerUse: 4, jobs: 60, unlock: 4, desc: 'Große Klinik mit Hubschrauberlandeplatz.' },
  school: { cat: 'edu', name: 'Grundschule', icon: '🏫', w: 2, h: 2, cost: 4500, upkeep: 380, cover: { type: 'edu1', r: 14 },
    powerUse: 1, jobs: 16, unlock: 1, desc: 'Grundbildung für Kinder.' },
  highschool: { cat: 'edu', name: 'Gymnasium', icon: '🎓', w: 3, h: 3, cost: 9000, upkeep: 650, cover: { type: 'edu2', r: 22 },
    powerUse: 2, jobs: 30, unlock: 3, desc: 'Höhere Bildung – wichtig für Büros.' },
  university: { cat: 'edu', name: 'Universität', icon: '🏛️', w: 4, h: 4, cost: 22000, upkeep: 1500, cover: { type: 'edu3', r: 40 },
    powerUse: 5, jobs: 80, unlock: 5, desc: 'Akademische Bildung für die ganze Stadt.' },
  park: { cat: 'parks', name: 'Kleiner Park', icon: '🌳', w: 1, h: 1, cost: 350, upkeep: 15, cover: { type: 'parks', r: 5, s: 0.6 },
    unlock: 0, desc: 'Grünfläche – steigert Bodenwert und Zufriedenheit.' },
  playground: { cat: 'parks', name: 'Spielplatz', icon: '🛝', w: 1, h: 1, cost: 450, upkeep: 20, cover: { type: 'parks', r: 5, s: 0.7 },
    unlock: 1, desc: 'Familien lieben ihn.' },
  plaza: { cat: 'parks', name: 'Stadtplatz', icon: '⛲', w: 2, h: 2, cost: 1800, upkeep: 60, cover: { type: 'parks', r: 8, s: 0.8 },
    unlock: 2, desc: 'Gepflasterter Platz mit Brunnen.' },
  citypark: { cat: 'parks', name: 'Stadtpark', icon: '🏞️', w: 3, h: 3, cost: 4000, upkeep: 140, cover: { type: 'parks', r: 12, s: 1 },
    unlock: 2, desc: 'Großer Park mit Teich.' },
  cityhall: { cat: 'parks', name: 'Rathaus', icon: '🏛️', w: 2, h: 2, cost: 8000, upkeep: 300, cover: { type: 'parks', r: 6, s: 0.5 },
    powerUse: 1, jobs: 20, unique: true, unlock: 2, desc: 'Steigert die Zufriedenheit in der ganzen Stadt.' },
  stadium: { cat: 'parks', name: 'Stadion', icon: '🏟️', w: 4, h: 4, cost: 28000, upkeep: 1200, cover: { type: 'parks', r: 40, s: 0.7 },
    noise: 40, powerUse: 5, jobs: 40, unique: true, unlock: 5, desc: 'Sportereignisse für die ganze Region.' },
  tvtower: { cat: 'parks', name: 'Fernsehturm', icon: '📡', w: 2, h: 2, cost: 45000, upkeep: 600, cover: { type: 'landmark', r: 45 },
    powerUse: 3, jobs: 20, unique: true, unlock: 6, desc: 'Wahrzeichen – steigert den Bodenwert stark.' },
};

export const TREE_COST = 10;

export const MILESTONES = [
  { pop: 0, name: 'Ackerland', reward: 0 },
  { pop: 200, name: 'Weiler', reward: 5000 },
  { pop: 800, name: 'Dorf', reward: 10000 },
  { pop: 2000, name: 'Kleinstadt', reward: 20000 },
  { pop: 5000, name: 'Stadt', reward: 30000 },
  { pop: 12000, name: 'Großstadt', reward: 45000 },
  { pop: 25000, name: 'Metropole', reward: 70000 },
  { pop: 50000, name: 'Megastadt', reward: 100000 },
];

export const COVERAGE_TYPES = ['police', 'fire', 'health', 'edu1', 'edu2', 'edu3', 'garbage', 'parks', 'landmark', 'transit'];

export const EXPENSE_CATS = {
  roads: 'Straßen', power: 'Strom', water: 'Wasser & Abwasser', garbage: 'Müllentsorgung', police: 'Polizei',
  fire: 'Feuerwehr', health: 'Gesundheit', edu: 'Bildung', parks: 'Parks & Kultur', transport: 'Nahverkehr',
};
