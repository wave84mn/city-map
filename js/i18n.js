// Interface texts: Montenegrin/Bosnian (me), Albanian (sq), English (en).
const S = {
  me: {
    appName: 'Mapa Gusinja',
    lead: 'Drži kocku ispred telefona i na njoj se pojavi Gusinje. Nanišani zgradu i drži mirno, ili dodirni njenu tačku, i ona izraste u cijelu kocku.',
    start: 'Uključi kameru',
    starting: 'Pokrećem…',
    looking: 'Tražim kocku…',
    pointCam: 'Usmjeri kameru na kocku',
    loadingTown: 'Učitavam grad…',
    town: 'Gusinje',
    townHint: 'Nanišani zgradu i drži mirno, ili dodirni tačku',
    holdStill: 'Drži mirno…',
    noModel: 'Detaljan model stiže kasnije',
    back: 'Grad',
    turn: 'Okreni',
    face: 'Licem k meni',
    about: 'O zgradi',
    flipHint: 'Okreni kocku naopako za povratak u grad',
    storySoon: 'Kratka priča o zgradi stiže uskoro.',
    piece: 'Komad slagalice',
    otherNames: 'Drugi nazivi',
    settings: 'Podešavanja',
    help: 'Pomoć',
    language: 'Jezik',
    townSize: 'Veličina grada',
    townSizeSmall: 'u odnosu na kocku',
    holdSelect: 'Biraj držanjem',
    holdSelectSmall: 'Isključi ako se zgrade biraju same',
    base: 'Postolje',
    baseSmall: 'Pokriva kocku na slici',
    stone: 'Kamen', off: 'Isklj.',
    upright: 'Uvijek gore',
    uprightSmall: 'Grad i zgrada prelaze na stranu kocke koja je gore (senzor nagiba)',
    shadows: 'Sjene',
    camView: 'Prikaz kamere',
    camViewSmall: '„Cijela” prikazuje cijelu sliku kamere',
    auto: 'Auto', fit: 'Cijela', fill: 'Popuni',
    fov: 'Ugao kamere',
    debug: 'Detalji praćenja',
    debugSmall: 'Oznake, brzina i tačnost',
    helpSteps: [
      'Odštampaj kocku (bijelo tijelo, crni kvadrati) ili papirnu kocku iz PDF-a na 100 %.',
      'Drži kocku 20–40 cm od telefona, na dobrom svjetlu. Neka bar jedna strana bude cijela vidljiva.',
      'Okreći kocku da razgledaš grad. Nanišani zgradu krugom u sredini i drži mirno, ili dodirni njenu tačku ili ime dolje.',
      'Zgrada izraste u cijelu kocku. Okreni kocku naopako (ili dodirni „Grad”) za povratak.',
    ],
    note: 'Radi u Chrome-u na Androidu i Safariju na iPhoneu. Slika s kamere obrađuje se samo na telefonu.',
    paper: 'Papirna kocka (PDF)', print3mf: 'Kocka za štampu (3MF)', printStl: 'STL (zip)',
    credits: 'Mapa: © OpenStreetMap saradnici (ODbL). Teren: Copernicus DEM. Modeli: Gusinjska kocka.',
    errNoCam: 'Ovaj preglednik ovdje ne može otvoriti kameru. Otvori stranicu u Chrome-u (Android) ili Safariju (iPhone).',
    errBlocked: 'Pristup kameri je blokiran. Dozvoli kameru za ovu stranicu u podešavanjima preglednika i pokušaj ponovo.',
    errNone: 'Na uređaju nije pronađena kamera.',
    errOther: 'Kamera se nije pokrenula ({m}). Ako si link otvorio u drugoj aplikaciji, otvori ga u Chrome-u ili Safariju.',
    errData: 'Podaci se nisu učitali: {m}',
    errModel: 'Model se nije učitao: {m}',
  },
  sq: {
    appName: 'Harta e Gucisë',
    lead: 'Mbaje kubin para telefonit dhe mbi të shfaqet Gucia. Drejtoje rrethin te një ndërtesë dhe mbaje të qetë, ose prek pikën e saj, dhe ajo rritet sa i gjithë kubi.',
    start: 'Ndize kamerën',
    starting: 'Po niset…',
    looking: 'Po e kërkoj kubin…',
    pointCam: 'Drejtoje kamerën te kubi',
    loadingTown: 'Po ngarkohet qyteti…',
    town: 'Gucia',
    townHint: 'Drejtoje te një ndërtesë dhe mbaje të qetë, ose prek një pikë',
    holdStill: 'Mbaje të qetë…',
    noModel: 'Modeli i detajuar vjen më vonë',
    back: 'Qyteti',
    turn: 'Rrotullo',
    face: 'Përballë meje',
    about: 'Për ndërtesën',
    flipHint: 'Ktheje kubin përmbys për t’u kthyer te qyteti',
    storySoon: 'Një histori e shkurtër për ndërtesën vjen së shpejti.',
    piece: 'Pjesa e pazëllit',
    otherNames: 'Emra të tjerë',
    settings: 'Cilësimet',
    help: 'Ndihmë',
    language: 'Gjuha',
    townSize: 'Madhësia e qytetit',
    townSizeSmall: 'krahasuar me kubin',
    holdSelect: 'Zgjidh duke e mbajtur të qetë',
    holdSelectSmall: 'Fike nëse ndërtesat zgjidhen pa dashje',
    base: 'Bazamenti',
    baseSmall: 'Mbulon kubin në pamje',
    stone: 'Gur', off: 'Fikur',
    upright: 'Gjithmonë lart',
    uprightSmall: 'Qyteti dhe ndërtesa kalojnë në faqen e kubit që është lart (sensori i pjerrësisë)',
    shadows: 'Hijet',
    camView: 'Pamja e kamerës',
    camViewSmall: '„E plotë” tregon gjithë figurën e kamerës',
    auto: 'Auto', fit: 'E plotë', fill: 'Mbush',
    fov: 'Këndi i kamerës',
    debug: 'Detajet e ndjekjes',
    debugSmall: 'Shenjat, shpejtësia dhe saktësia',
    helpSteps: [
      'Printo kubin (trup i bardhë, katrorë të zinj) ose kubin prej letre nga PDF-ja në 100 %.',
      'Mbaje kubin 20–40 cm larg telefonit, në dritë të mirë. Të paktën një faqe duhet të duket e plotë.',
      'Rrotulloje kubin për ta parë qytetin. Drejtoje rrethin në mes te një ndërtesë dhe mbaje të qetë, ose prek pikën ose emrin poshtë.',
      'Ndërtesa rritet sa i gjithë kubi. Ktheje kubin përmbys (ose prek „Qyteti”) për t’u kthyer.',
    ],
    note: 'Punon në Chrome në Android dhe në Safari në iPhone. Figura e kamerës përpunohet vetëm në telefon.',
    paper: 'Kubi prej letre (PDF)', print3mf: 'Kubi për printim (3MF)', printStl: 'STL (zip)',
    credits: 'Harta: © kontribuuesit e OpenStreetMap (ODbL). Terreni: Copernicus DEM. Modelet: Gusinjska kocka.',
    errNoCam: 'Ky shfletues nuk mund ta hapë kamerën këtu. Hape faqen në Chrome (Android) ose Safari (iPhone).',
    errBlocked: 'Qasja te kamera është bllokuar. Lejoje kamerën për këtë faqe te cilësimet e shfletuesit dhe provo sërish.',
    errNone: 'Në pajisje nuk u gjet asnjë kamerë.',
    errOther: 'Kamera nuk u nis ({m}). Nëse e hape lidhjen në një aplikacion tjetër, hape në Chrome ose Safari.',
    errData: 'Të dhënat nuk u ngarkuan: {m}',
    errModel: 'Modeli nuk u ngarkua: {m}',
  },
  en: {
    appName: 'Gusinje City Map',
    lead: 'Hold the cube in front of your phone and Gusinje appears on it. Aim the ring at a building and hold still, or tap its dot, and it grows to fill the whole cube.',
    start: 'Start camera',
    starting: 'Starting…',
    looking: 'Looking for the cube…',
    pointCam: 'Point the camera at the cube',
    loadingTown: 'Loading the town…',
    town: 'Gusinje',
    townHint: 'Aim at a building and hold still, or tap a dot',
    holdStill: 'Hold still…',
    noModel: 'Detailed model coming later',
    back: 'Town',
    turn: 'Turn',
    face: 'Face me',
    about: 'About',
    flipHint: 'Turn the cube upside down to go back to town',
    storySoon: 'A short story about this building is coming soon.',
    piece: 'Jigsaw piece',
    otherNames: 'Other names',
    settings: 'Settings',
    help: 'Help',
    language: 'Language',
    townSize: 'Town size',
    townSizeSmall: 'compared with the cube',
    holdSelect: 'Choose by holding still',
    holdSelectSmall: 'Turn off if buildings get chosen by accident',
    base: 'Base',
    baseSmall: 'Covers the cube in the picture',
    stone: 'Stone', off: 'Off',
    upright: 'Keep upright',
    uprightSmall: 'The town and building move to whichever face is up (tilt sensor)',
    shadows: 'Shadows',
    camView: 'Camera view',
    camViewSmall: '“Whole” shows the full camera image',
    auto: 'Auto', fit: 'Whole', fill: 'Fill',
    fov: 'Camera angle',
    debug: 'Tracking details',
    debugSmall: 'Marker outlines, speed and accuracy',
    helpSteps: [
      'Print the cube (white body, black squares), or the paper cube from the PDF at 100 %.',
      'Hold the cube 20–40 cm from the phone in good light. Keep at least one face fully visible.',
      'Turn the cube to look around the town. Aim the ring in the middle at a building and hold still, or tap its dot or its name below.',
      'The building grows to fill the cube. Turn the cube upside down (or tap “Town”) to go back.',
    ],
    note: 'Works in Chrome on Android and Safari on iPhone. The camera image is processed only on your phone.',
    paper: 'Paper cube (PDF)', print3mf: 'Cube print file (3MF)', printStl: 'STLs (zip)',
    credits: 'Map: © OpenStreetMap contributors (ODbL). Terrain: Copernicus DEM. Models: Gusinjska kocka.',
    errNoCam: 'This browser cannot open the camera here. Open the page in Chrome (Android) or Safari (iPhone).',
    errBlocked: 'Camera access was blocked. Allow the camera for this site in the browser settings and try again.',
    errNone: 'No camera was found on this device.',
    errOther: 'The camera could not start ({m}). If you opened the link inside another app, open it in Chrome or Safari.',
    errData: 'Could not load the app data: {m}',
    errModel: 'Could not load the model: {m}',
  },
};

export const LANGS = ['me', 'sq', 'en'];
let lang = pickLang();

function pickLang() {
  try { const s = localStorage.getItem('citymap.lang'); if (LANGS.includes(s)) return s; } catch { /* private mode */ }
  const want = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(want)) return want;
  const ls = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']).map(x => x.toLowerCase());
  if (ls.some(x => x.startsWith('sq'))) return 'sq';
  if (ls.every(x => x.startsWith('en'))) return 'en';
  return 'me';
}
export function getLang() { return lang; }
export function setLang(l) {
  if (!LANGS.includes(l)) return;
  lang = l;
  try { localStorage.setItem('citymap.lang', l); } catch { /* private mode */ }
  document.documentElement.lang = l === 'me' ? 'sr-Latn-ME' : l;
  applyStatic();
}
export function t(key, vars) {
  let s = (S[lang] && S[lang][key]) ?? S.en[key] ?? key;
  if (vars && typeof s === 'string') for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
  return s;
}
// elements marked data-i18n="key" get their text from the current language
export function applyStatic() {
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  const ol = document.getElementById('helpSteps');
  if (ol) { ol.innerHTML = ''; for (const s of t('helpSteps')) { const li = document.createElement('li'); li.textContent = s; ol.append(li); } }
  for (const b of document.querySelectorAll('.langseg button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  document.title = t('appName');
}
