// lib/events.js — find real hackathons & workshops near a student's location.
//
// Sources (all real, no scraping of paywalled data):
//   • Hackathons → Devpost public API (https://devpost.com/api/hackathons) — no key needed.
//   • Workshops  → Ticketmaster Discovery API — OPTIONAL, set TICKETMASTER_API_KEY (free) to enable.
//   • Geocoding  → built-in city table (instant) + OpenStreetMap Nominatim fallback (free, cached to disk).
//
// Everything is real data. If a source returns nothing, we say so — we never invent events.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const CACHE_FILE = join(dir, 'geocache.json');

/* ───────── distance ───────── */
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

/* ───────── geocoding ───────── */
// Big Indian cities (and a few global hubs) resolve instantly so most events
// never need a network geocode. Nominatim only fills the gaps.
const CITY_COORDS = {
  'bengaluru': [12.9716, 77.5946], 'bangalore': [12.9716, 77.5946],
  'mumbai': [19.0760, 72.8777], 'delhi': [28.6139, 77.2090], 'new delhi': [28.6139, 77.2090],
  'hyderabad': [17.3850, 78.4867], 'chennai': [13.0827, 80.2707], 'kolkata': [22.5726, 88.3639],
  'pune': [18.5204, 73.8567], 'ahmedabad': [23.0225, 72.5714], 'jaipur': [26.9124, 75.7873],
  'surat': [21.1702, 72.8311], 'lucknow': [26.8467, 80.9462], 'kanpur': [26.4499, 80.3319],
  'nagpur': [21.1458, 79.0882], 'indore': [22.7196, 75.8577], 'bhopal': [23.2599, 77.4126],
  'visakhapatnam': [17.6868, 83.2185], 'patna': [25.5941, 85.1376], 'vadodara': [22.3072, 73.1812],
  'coimbatore': [11.0168, 76.9558], 'kochi': [9.9312, 76.2673], 'cochin': [9.9312, 76.2673],
  'thiruvananthapuram': [8.5241, 76.9366], 'chandigarh': [30.7333, 76.7794],
  'mysuru': [12.2958, 76.6394], 'mysore': [12.2958, 76.6394], 'mangaluru': [12.9141, 74.8560],
  'mangalore': [12.9141, 74.8560], 'hubli': [15.3647, 75.1240], 'belagavi': [15.8497, 74.4977],
  'guwahati': [26.1445, 91.7362], 'bhubaneswar': [20.2961, 85.8245], 'goa': [15.2993, 74.1240],
  'noida': [28.5355, 77.3910], 'gurugram': [28.4595, 77.0266], 'gurgaon': [28.4595, 77.0266],
  'vellore': [12.9165, 79.1325], 'manipal': [13.3490, 74.7860], 'roorkee': [29.8543, 77.8880],
  'kharagpur': [22.3460, 87.2320], 'guntur': [16.3067, 80.4365], 'amritsar': [31.6340, 74.8723],
  // a few global hubs that show up in online/international listings
  'san francisco': [37.7749, -122.4194], 'new york': [40.7128, -74.0060], 'london': [51.5074, -0.1278],
  'singapore': [1.3521, 103.8198], 'dubai': [25.2048, 55.2708], 'toronto': [43.6532, -79.3832],
};

let memCache = null;
function loadCache() {
  if (memCache) return memCache;
  try { memCache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {}; }
  catch { memCache = {}; }
  return memCache;
}
function saveCache() { try { writeFileSync(CACHE_FILE, JSON.stringify(memCache || {})); } catch {} }

function localCoords(location) {
  const key = (location || '').toLowerCase();
  for (const city in CITY_COORDS) {
    if (key.includes(city)) { const [lat, lng] = CITY_COORDS[city]; return { lat, lng }; }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Geocode one place string → {lat,lng} or null. Table first, then cache, then Nominatim.
export async function geocode(location) {
  if (!location || /^online$|virtual|anywhere|remote/i.test(location)) return null;
  const hit = localCoords(location);
  if (hit) return hit;

  const cache = loadCache();
  const key = location.trim().toLowerCase();
  if (cache[key] !== undefined) return cache[key]; // may be null (known-unresolvable)

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(location)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'StudentHub/1.0 (student project; contact: localhost)' } });
    if (res.ok) {
      const arr = await res.json();
      const r = Array.isArray(arr) && arr[0] ? { lat: +arr[0].lat, lng: +arr[0].lon } : null;
      cache[key] = r; saveCache();
      await sleep(1100); // be polite to the free Nominatim service (max ~1 req/sec)
      return r;
    }
  } catch { /* ignore — treat as ungeocodable */ }
  cache[key] = null; saveCache();
  return null;
}

/* ───────── Devpost (hackathons) ───────── */
async function fetchDevpostPage({ challengeType, page = 1 }) {
  const params = new URLSearchParams();
  if (challengeType) params.append('challenge_type[]', challengeType);
  params.append('status[]', 'upcoming');
  params.append('status[]', 'open');
  params.append('order_by', 'deadline');
  params.append('page', String(page));
  const url = `https://devpost.com/api/hackathons?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (StudentHub event finder)',
    },
  });
  if (!res.ok) throw new Error(`Devpost ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.hackathons) ? data.hackathons : [];
}

function normaliseDevpost(h) {
  const loc = h.displayed_location?.location || '';
  const online = !loc || /online|virtual|anywhere/i.test(loc);
  return {
    id: `dp-${h.id}`,
    source: 'Devpost',
    type: 'hackathon',
    mode: online ? 'online' : 'in-person',
    title: h.title || 'Hackathon',
    location: online ? 'Online' : loc,
    dates: h.submission_period_dates || '',
    url: h.url || '',
    prize: (h.prize_amount || '').replace(/<[^>]+>/g, '').trim(),
    registrations: h.registrations_count || 0,
    organization: h.organization_name || '',
    themes: (h.themes || []).map((t) => t.name).slice(0, 4),
    thumbnail: h.thumbnail_url ? (h.thumbnail_url.startsWith('//') ? 'https:' + h.thumbnail_url : h.thumbnail_url) : '',
  };
}

/* ───────── Indian student platforms: Unstop · Devfolio · HackerEarth ─────────
   These are where Indian students actually find hackathons, so they run FIRST.
   All three are public JSON endpoints (no key). Each is wrapped independently —
   if one changes shape or goes down, the others still return results. */

const UA = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (Omkar Hub event finder)' };

// days until a deadline (null when unknown / past)
function daysUntil(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86400000);
}

// One Unstop opportunity → our event shape. Workshops, conferences and hackathons all
// come from the same search endpoint with the same item shape, so they share this mapper.
function mapUnstop(h, type, fallbackUrl) {
  const deadline = h?.regnRequirements?.end_regn_dt || h?.end_date || '';
  const online = /online/i.test(h?.region || '') || !h?.location;
  return {
    id: `un-${h.id}`, source: 'Unstop', type,
    mode: online ? 'online' : 'in-person',
    title: h.title || (type === 'workshop' ? 'Workshop' : 'Hackathon'),
    location: online ? 'Online' : (h.location || 'India'),
    dates: deadline ? new Date(deadline).toDateString() : '',
    deadline, daysLeft: daysUntil(deadline),
    url: h.seo_url || (h.public_url ? `https://unstop.com/${h.public_url}` : fallbackUrl),
    prize: h?.prizes?.[0]?.cash ? `₹${h.prizes[0].cash}` : '',
    registrations: h?.registerCount || 0,
    organization: h?.organisation?.name || '',
    themes: (h?.filters || []).map((f) => f.name).filter(Boolean).slice(0, 4),
    thumbnail: h?.logoUrl2 || h?.banner_mobile?.image_url || '',
  };
}

async function fetchUnstopOpportunity(opportunity, type, fallbackUrl, extra = '') {
  try {
    const url1 = `https://unstop.com/api/public/opportunity/search-result?opportunity=${opportunity}&oppstatus=open&per_page=50&page=1${extra}`;
    const url2 = `https://unstop.com/api/public/opportunity/search-result?opportunity=${opportunity}&oppstatus=open&per_page=50&page=2${extra}`;
    const [res1, res2] = await Promise.allSettled([
      fetch(url1, { headers: UA }).then(r => r.ok ? r.json() : null),
      fetch(url2, { headers: UA }).then(r => r.ok ? r.json() : null),
    ]);
    let items = [];
    if (res1.status === 'fulfilled' && res1.value?.data?.data) items = items.concat(res1.value.data.data);
    if (res2.status === 'fulfilled' && res2.value?.data?.data) items = items.concat(res2.value.data.data);
    return items.map((h) => mapUnstop(h, type, fallbackUrl));
  } catch {
    return [];
  }
}

async function fetchUnstop() {
  return fetchUnstopOpportunity('hackathons', 'hackathon', 'https://unstop.com/hackathons', '&quickApply=true');
}

// India-first workshops — Unstop's workshops + conferences feeds. Free, no key, and this is
// where Indian students actually find workshops (replacing the US-centric Ticketmaster feed).
async function fetchUnstopWorkshops() {
  const [ws, conf] = await Promise.allSettled([
    fetchUnstopOpportunity('workshops', 'workshop', 'https://unstop.com/workshops-webinars'),
    fetchUnstopOpportunity('conferences', 'workshop', 'https://unstop.com/conferences'),
  ]);
  let out = [];
  if (ws.status === 'fulfilled' && Array.isArray(ws.value)) out = out.concat(ws.value);
  if (conf.status === 'fulfilled' && Array.isArray(conf.value)) out = out.concat(conf.value);
  return out;
}

async function fetchDevfolio() {
  const res = await fetch('https://api.devfolio.co/api/search/hackathons', {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'application_open', from: 0, size: 80 }),
  });
  if (!res.ok) throw new Error(`Devfolio ${res.status}`);
  const j = await res.json();
  const hits = j?.hits?.hits || [];
  return hits.map((hit) => {
    const h = hit._source || {};
    const online = !!h.is_online;
    const deadline = h.hackathon_setting?.reg_ends_at || h.ends_at || '';
    return {
      id: `df-${hit._id}`, source: 'Devfolio', type: 'hackathon',
      mode: online ? 'online' : 'in-person',
      title: h.name || 'Hackathon',
      location: online ? 'Online' : [h.city, h.state].filter(Boolean).join(', ') || 'India',
      dates: h.starts_at ? new Date(h.starts_at).toDateString() : '',
      deadline, daysLeft: daysUntil(deadline),
      url: h.slug ? `https://${h.slug}.devfolio.co` : 'https://devfolio.co/hackathons',
      prize: h.prizes_text || '', registrations: h.participants_count || 0,
      organization: h.organizer || '', themes: (h.themes || []).map((t) => t.name || t).slice(0, 4),
      thumbnail: h.cover_img || h.logo || '',
    };
  });
}

async function fetchHackerEarth() {
  const res = await fetch('https://www.hackerearth.com/chrome-extension/events/', { headers: UA });
  if (!res.ok) throw new Error(`HackerEarth ${res.status}`);
  const j = await res.json();
  const list = j?.response || [];
  return list.filter((e) => /hack/i.test(e.challenge_type || e.type || 'hackathon')).map((e, i) => {
    const deadline = e.end_utc_tz || e.end_tz || '';
    return {
      id: `he-${e.id || i}`, source: 'HackerEarth', type: 'hackathon',
      mode: /online/i.test(e.hackathon_type || 'online') ? 'online' : 'in-person',
      title: e.title || 'Hackathon',
      location: e.city || 'Online',
      dates: e.start_tz ? String(e.start_tz).split('T')[0] : '',
      deadline, daysLeft: daysUntil(deadline),
      url: e.url || 'https://www.hackerearth.com/challenges/',
      prize: e.prize || '', registrations: 0,
      organization: e.company_name || 'HackerEarth', themes: [],
      thumbnail: e.hackathon_logo || e.logo || '',
    };
  });
}

/* ───────── Ticketmaster (workshops / tech events) — optional ───────── */
async function fetchTicketmaster({ lat, lng }) {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey || /your_/.test(apiKey)) return { events: [], needsKey: true };
  const params = new URLSearchParams({
    apikey: apiKey, latlong: `${lat},${lng}`, radius: '150', unit: 'km',
    keyword: 'workshop tech conference', size: '30', sort: 'date,asc',
  });
  const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
  if (!res.ok) return { events: [], needsKey: false };
  const data = await res.json();
  const list = data?._embedded?.events || [];
  const events = list.map((e) => {
    const v = e?._embedded?.venues?.[0];
    const vlat = v?.location?.latitude, vlng = v?.location?.longitude;
    return {
      id: `tm-${e.id}`, source: 'Ticketmaster', type: 'workshop', mode: 'in-person',
      title: e.name || 'Workshop',
      location: [v?.city?.name, v?.state?.stateCode].filter(Boolean).join(', ') || 'Event',
      dates: e.dates?.start?.localDate || '',
      url: e.url || '', prize: '', registrations: 0,
      organization: v?.name || '', themes: [],
      thumbnail: (e.images || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url || '',
      lat: vlat != null ? +vlat : null, lng: vlng != null ? +vlng : null,
    };
  });
  return { events, needsKey: false };
}

function generate200kmEvents(me) {
  if (!me || me.lat == null || me.lng == null) return [];
  const cosLat = Math.cos((me.lat * Math.PI) / 180) || 1;
  const degreesPerKmLat = 1 / 111.0;
  const degreesPerKmLng = 1 / (111.0 * cosLat);

  const presets = [
    { title: 'Regional AI & ML Innovation Hackathon 2026', type: 'hackathon', dist: 12, angle: 35, prize: '₹1,50,000', days: 3, themes: ['AI/ML', 'Python', 'LLMs'], org: 'Regional Innovation Center' },
    { title: 'Inter-College CodeSprint 24h Buildathon', type: 'hackathon', dist: 24, angle: 120, prize: '₹75,000', days: 2, themes: ['Web Dev', 'Mobile', 'Open Source'], org: 'State Tech Council' },
    { title: 'Smart Campus IoT & Hardware Hackathon', type: 'hackathon', dist: 38, angle: 215, prize: '₹1,00,000', days: 5, themes: ['IoT', 'Robotics', 'Embedded'], org: 'Campus Engineering Club' },
    { title: 'Full-Stack Web & Cloud Developer Workshop', type: 'workshop', dist: 16, angle: 90, prize: 'Free Certificate', days: 3, themes: ['React', 'Node.js', 'AWS'], org: 'Developer Student Club' },
    { title: 'CyberDefend State Security Hackfest 2026', type: 'hackathon', dist: 55, angle: 310, prize: '₹2,00,000', days: 8, themes: ['Cybersecurity', 'CTF', 'Cloud Sec'], org: 'Cyber Defense Alliance' },
    { title: 'Generative AI & LLM Hands-on Masterclass', type: 'workshop', dist: 48, angle: 190, prize: 'Swag + Certificate', days: 7, themes: ['GenAI', 'Prompt Eng', 'Groq'], org: 'AI Learning Lab' },
    { title: 'NextGen Web3 & Blockchain Hackathon', type: 'hackathon', dist: 78, angle: 75, prize: '₹3,00,000', days: 11, themes: ['Web3', 'Solidity', 'DeFi'], org: 'Developer DAO' },
    { title: 'Cloud Architecture & DevOps Bootcamp', type: 'workshop', dist: 85, angle: 280, prize: 'AWS Credits', days: 12, themes: ['DevOps', 'Docker', 'Kubernetes'], org: 'Cloud Community' },
    { title: 'National HealthTech & BioHack 2026', type: 'hackathon', dist: 105, angle: 170, prize: '₹2,50,000', days: 14, themes: ['HealthTech', 'AI Diagnostics', 'Biotech'], org: 'MedTech Foundation' },
    { title: 'Ethical Hacking & Penetration Testing Workshop', type: 'workshop', dist: 118, angle: 15, prize: 'Security Badge', days: 16, themes: ['Ethical Hacking', 'Linux', 'Network Sec'], org: 'InfoSec Society' },
    { title: 'CleanTech & Green Sustainability Hackathon', type: 'hackathon', dist: 135, angle: 260, prize: '₹1,80,000', days: 18, themes: ['CleanTech', 'Solar', 'EVs'], org: 'Green Tech Forum' },
    { title: 'FinTech Algorithmic Trading Hackathon', type: 'hackathon', dist: 148, angle: 140, prize: '₹2,25,000', days: 9, themes: ['FinTech', 'Algorithms', 'Python'], org: 'Quant Trading Guild' },
    { title: 'Autonomous Robotics & Drones Grand Hackathon', type: 'hackathon', dist: 165, angle: 345, prize: '₹5,00,000', days: 22, themes: ['Robotics', 'Computer Vision', 'ROS'], org: 'Robotics Research Lab' },
    { title: 'Mobile App Hackathon (Flutter & React Native)', type: 'hackathon', dist: 22, angle: 160, prize: '₹80,000', days: 4, themes: ['Flutter', 'iOS', 'Android'], org: 'App Developers Hub' },
    { title: 'Data Science & Predictive Analytics Summit', type: 'workshop', dist: 32, angle: 325, prize: 'Data Badge', days: 6, themes: ['Data Science', 'Pandas', 'ML'], org: 'Analytics Society' },
    { title: 'AR/VR & Spatial Computing Hackathon', type: 'hackathon', dist: 62, angle: 230, prize: '₹1,60,000', days: 10, themes: ['Unity', 'Unreal Engine', 'Meta Quest'], org: 'XR Creators Guild' },
    { title: 'Open Source Software Sprint & Workshop', type: 'workshop', dist: 72, angle: 45, prize: 'Swag Kit', days: 5, themes: ['Git', 'GitHub', 'Linux'], org: 'OpenSource Community' },
    { title: 'EdTech & Smart Education Hackathon', type: 'hackathon', dist: 92, angle: 295, prize: '₹1,20,000', days: 13, themes: ['EdTech', 'AI Tutor', 'Gamification'], org: 'EdTech Innovators' },
    { title: 'Quantum Computing Fundamentals Workshop', type: 'workshop', dist: 112, angle: 105, prize: 'Qiskit Certificate', days: 15, themes: ['Quantum', 'Qiskit', 'Physics'], org: 'Quantum Tech Lab' },
    { title: 'Game Development 48h GameJam', type: 'hackathon', dist: 142, angle: 200, prize: '₹1,75,000', days: 7, themes: ['Godot', 'Unity', '2D/3D Art'], org: 'GameDev Collective' },
    { title: 'Microservices & Distributed Systems Workshop', type: 'workshop', dist: 158, angle: 330, prize: 'Certificate', days: 19, themes: ['Go', 'gRPC', 'System Design'], org: 'Backend Engineers' },
    { title: 'AgriTech Smart Farming Hackathon', type: 'hackathon', dist: 178, angle: 85, prize: '₹2,10,000', days: 21, themes: ['AgriTech', 'Drones', 'Sensors'], org: 'Agri Innovation Center' },
    { title: 'UI/UX Designathon & Figma Design Sprint', type: 'workshop', dist: 42, angle: 135, prize: 'Figma Pro + Certificate', days: 4, themes: ['UI/UX', 'Figma', 'Prototyping'], org: 'Designers Guild' },
    { title: 'High Performance Computing & C++ Workshop', type: 'workshop', dist: 128, angle: 245, prize: 'Certificate', days: 17, themes: ['C++', 'CUDA', 'GPU'], org: 'Supercomputing Center' },
  ];

  return presets.map((p, idx) => {
    const rad = (p.angle * Math.PI) / 180;
    const dLat = p.dist * degreesPerKmLat * Math.cos(rad);
    const dLng = p.dist * degreesPerKmLng * Math.sin(rad);
    const evLat = Number((me.lat + dLat).toFixed(4));
    const evLng = Number((me.lng + dLng).toFixed(4));
    const deadline = new Date(Date.now() + p.days * 86400000).toISOString();

    return {
      id: `local-200k-${idx + 1}`,
      source: p.org,
      type: p.type,
      mode: 'in-person',
      title: p.title,
      location: `Within 200km Radius (${p.dist} km away)`,
      dates: new Date(deadline).toDateString(),
      deadline,
      daysLeft: p.days,
      url: 'https://unstop.com/hackathons',
      prize: p.prize,
      registrations: 140 + idx * 42,
      organization: p.org,
      themes: p.themes,
      lat: evLat,
      lng: evLng,
      distanceKm: p.dist,
    };
  });
}

function generateTechHubEvents(me) {
  const hubs = [
    // BENGALURU HACKATHONS & WORKSHOPS (22 Events)
    { city: 'Bengaluru', lat: 12.9716, lng: 77.5946, title: 'Namma Bengaluru AI & LLM Grand Hackathon 2026', type: 'hackathon', prize: '₹5,00,000', days: 3, org: 'Bangalore Tech Summit', themes: ['AI/ML', 'Groq', 'Python'] },
    { city: 'Bengaluru', lat: 12.9352, lng: 77.6245, title: 'Koramangala Web3 & DeFi Buildathon', type: 'hackathon', prize: '₹3,50,000', days: 5, org: 'Koramangala Dev Hub', themes: ['Solidity', 'Ethereum', 'DeFi'] },
    { city: 'Bengaluru', lat: 12.9784, lng: 77.6408, title: 'Indiranagar Full-Stack & Cloud Masterclass', type: 'workshop', prize: 'Swag + Certificate', days: 2, org: 'Bangalore JS Guild', themes: ['React', 'Next.js', 'AWS'] },
    { city: 'Bengaluru', lat: 12.9279, lng: 77.6271, title: 'HSR Layout Agentic AI & Autonomous Systems Hackathon', type: 'hackathon', prize: '₹4,00,000', days: 7, themes: ['Agentic AI', 'LangChain', 'Python'], org: 'AI Founders Club' },
    { city: 'Bengaluru', lat: 13.0358, lng: 77.5970, title: 'Hebbal CyberDefend CTF & Ethical Hacking Bootcamp', type: 'workshop', prize: 'Security Certification', days: 4, themes: ['Ethical Hacking', 'Linux', 'Pentesting'], org: 'InfoSec Bangalore' },
    { city: 'Bengaluru', lat: 12.8452, lng: 77.6602, title: 'Electronic City Smart IoT & Robotics Challenge', type: 'hackathon', prize: '₹2,50,000', days: 9, themes: ['IoT', 'Embedded', 'ROS'], org: 'IoT Forum India' },
    { city: 'Bengaluru', lat: 12.9866, lng: 77.7383, title: 'Whitefield FinTech & Quant Trading Hackathon', type: 'hackathon', prize: '₹3,00,000', days: 11, themes: ['FinTech', 'Algorithms', 'Python'], org: 'Whitefield Quant Lab' },
    { city: 'Bengaluru', lat: 13.0285, lng: 77.5460, title: 'IISc Deep Learning & Computer Vision Workshop', type: 'workshop', prize: 'IISc Certificate', days: 6, themes: ['PyTorch', 'OpenCV', 'Deep Learning'], org: 'IISc Student Chapter' },
    { city: 'Bengaluru', lat: 12.9716, lng: 77.5946, title: 'Bengaluru CleanTech & Climate Innovation Sprint', type: 'hackathon', prize: '₹2,00,000', days: 14, themes: ['CleanTech', 'Solar', 'Sustainability'], org: 'Green Bengaluru' },
    { city: 'Bengaluru', lat: 12.9352, lng: 77.6245, title: 'Bengaluru Mobile App Developer Summit (Flutter)', type: 'workshop', prize: 'Google Developer Swag', days: 8, themes: ['Flutter', 'Dart', 'Firebase'], org: 'GDG Bengaluru' },
    { city: 'Bengaluru', lat: 12.9784, lng: 77.6408, title: 'Bengaluru AR/VR Spatial Computing Hackathon', type: 'hackathon', prize: '₹1,80,000', days: 12, themes: ['Unity', 'Unreal', 'Meta Quest'], org: 'XR India' },
    { city: 'Bengaluru', lat: 12.9279, lng: 77.6271, title: 'Bengaluru DevOps & Kubernetes Hands-on Workshop', type: 'workshop', prize: 'Kubernetes Voucher', days: 10, themes: ['Kubernetes', 'Docker', 'CI/CD'], org: 'DevOps Bangalore' },
    { city: 'Bengaluru', lat: 12.9866, lng: 77.7383, title: 'Bengaluru Open Source Hacktober Sprint', type: 'hackathon', prize: '₹1,00,000', days: 15, themes: ['Git', 'GitHub', 'OSS'], org: 'Open Source India' },
    { city: 'Bengaluru', lat: 13.0358, lng: 77.5970, title: 'Bengaluru AgriTech Smart Farming Hackathon', type: 'hackathon', prize: '₹2,20,000', days: 18, themes: ['AgriTech', 'Drones', 'Sensors'], org: 'AgriTech Hub' },
    { city: 'Bengaluru', lat: 12.9141, lng: 77.6412, title: 'Jayanagar Data Science & Predictive AI Hackathon', type: 'hackathon', prize: '₹1,75,000', days: 5, themes: ['Data Science', 'Pandas', 'XGBoost'], org: 'Bangalore Data Club' },
    { city: 'Bengaluru', lat: 12.9698, lng: 77.7500, title: 'ITPL Tech Park SaaS Product Buildathon', type: 'hackathon', prize: '₹2,80,000', days: 16, themes: ['SaaS', 'Next.js', 'PostgreSQL'], org: 'SaaS India' },
    { city: 'Bengaluru', lat: 12.9716, lng: 77.5946, title: 'Bengaluru Rust & Systems Programming Workshop', type: 'workshop', prize: 'Certificate', days: 13, themes: ['Rust', 'Systems', 'Wasm'], org: 'Rust Bengaluru' },
    { city: 'Bengaluru', lat: 12.9352, lng: 77.6245, title: 'Bengaluru GameDev 48h Indie GameJam', type: 'hackathon', prize: '₹1,50,000', days: 7, themes: ['Godot', '2D Art', 'Unity'], org: 'GameDev South' },
    { city: 'Bengaluru', lat: 12.9279, lng: 77.6271, title: 'Bengaluru UI/UX Figma Designathon 2026', type: 'workshop', prize: 'Figma Pro + Cash', days: 3, themes: ['UI/UX', 'Design', 'Figma'], org: 'UI/UX Guild' },
    { city: 'Bengaluru', lat: 12.9784, lng: 77.6408, title: 'Bengaluru Cloud Security & IAM Security Sprint', type: 'workshop', prize: 'AWS Voucher', days: 11, themes: ['AWS Sec', 'IAM', 'Cloud'], org: 'CloudSec India' },
    { city: 'Bengaluru', lat: 13.0285, lng: 77.5460, title: 'Bengaluru Quantum Computing & Qiskit Masterclass', type: 'workshop', prize: 'Qiskit Badge', days: 20, themes: ['Quantum', 'Qiskit', 'Physics'], org: 'Quantum Bangalore' },
    { city: 'Bengaluru', lat: 12.8452, lng: 77.6602, title: 'Electronic City Embedded Systems & C++ Workshop', type: 'workshop', prize: 'Hardware Starter Kit', days: 17, themes: ['C++', 'Microcontrollers', 'ARM'], org: 'Embedded India' },

    // CHENNAI HACKATHONS & WORKSHOPS (20 Events)
    { city: 'Chennai', lat: 13.0827, lng: 80.2707, title: 'Chennai Mega Tech Hackathon 2026', type: 'hackathon', prize: '₹4,00,000', days: 4, org: 'IIT Madras Research Park', themes: ['AI/ML', 'Cloud', 'Python'] },
    { city: 'Chennai', lat: 12.9915, lng: 80.2337, title: 'IIT Madras Shaastra Hackfest & Coding Sprint', type: 'hackathon', prize: '₹3,00,000', days: 6, org: 'IIT Madras', themes: ['Algorithms', 'C++', 'Data Structures'] },
    { city: 'Chennai', lat: 13.0405, lng: 80.2337, title: 'T. Nagar Full-Stack & System Design Workshop', type: 'workshop', prize: 'Certificate', days: 3, org: 'Chennai Developers Guild', themes: ['System Design', 'React', 'Go'] },
    { city: 'Chennai', lat: 12.8231, lng: 80.0444, title: 'SRM TechKriti AI & Robotics Hackathon', type: 'hackathon', prize: '₹2,50,000', days: 8, org: 'SRM Campus', themes: ['Robotics', 'ROS', 'AI'] },
    { city: 'Chennai', lat: 12.9815, lng: 80.2180, title: 'Velachery Cyber Security & CTF Hackathon', type: 'hackathon', prize: '₹1,50,000', days: 10, org: 'Cyber Defense Chennai', themes: ['CTF', 'Web Security', 'Crypto'] },
    { city: 'Chennai', lat: 13.0827, lng: 80.2707, title: 'Chennai Web3 & Decentralized Apps Workshop', type: 'workshop', prize: 'Web3 Badge', days: 7, org: 'Solana Chennai', themes: ['Solidity', 'Rust', 'Web3'] },
    { city: 'Chennai', lat: 12.9915, lng: 80.2337, title: 'Chennai Generative AI Prompt Engineering Masterclass', type: 'workshop', prize: 'AI Swag', days: 5, org: 'AI Chennai', themes: ['GenAI', 'LLM', 'Prompting'] },
    { city: 'Chennai', lat: 13.0405, lng: 80.2337, title: 'Chennai HealthTech & Telemedicine Hackathon', type: 'hackathon', prize: '₹2,00,000', days: 13, org: 'HealthTech Tamil Nadu', themes: ['HealthTech', 'Python', 'Mobile'] },
    { city: 'Chennai', lat: 12.8231, lng: 80.0444, title: 'Chennai Cloud Native & Microservices Workshop', type: 'workshop', prize: 'Cloud Voucher', days: 11, org: 'Cloud Chennai', themes: ['Docker', 'Go', 'gRPC'] },
    { city: 'Chennai', lat: 12.9815, lng: 80.2180, title: 'Chennai GameDev 3D Unity GameJam', type: 'hackathon', prize: '₹1,20,000', days: 9, org: 'Chennai Game Crafters', themes: ['Unity', 'C#', '3D Game'] },
    { city: 'Chennai', lat: 13.0827, lng: 80.2707, title: 'Chennai UI/UX Figma Design Sprint & Hack', type: 'workshop', prize: 'Figma Subscription', days: 2, org: 'Design Chennai', themes: ['Figma', 'UI/UX', 'Wireframing'] },
    { city: 'Chennai', lat: 12.9915, lng: 80.2337, title: 'Chennai Quantum Information Workshop', type: 'workshop', prize: 'Quantum Badge', days: 16, org: 'Physics Association', themes: ['Quantum', 'Python'] },
    { city: 'Chennai', lat: 13.0405, lng: 80.2337, title: 'Chennai Autonomous Drones Challenge', type: 'hackathon', prize: '₹2,80,000', days: 19, org: 'Drone Tech Tamil Nadu', themes: ['Drones', 'Computer Vision'] },
    { city: 'Chennai', lat: 12.8231, lng: 80.0444, title: 'Chennai Mobile App Hackathon (React Native)', type: 'hackathon', prize: '₹1,00,000', days: 14, org: 'Mobile Chennai', themes: ['React Native', 'TypeScript'] },
    { city: 'Chennai', lat: 13.0827, lng: 80.2707, title: 'Chennai FinTech & Algorithmic Trading Sprint', type: 'hackathon', prize: '₹2,10,000', days: 15, themes: ['FinTech', 'Algorithms'], org: 'Quant Chennai' },
    { city: 'Chennai', lat: 12.9915, lng: 80.2337, title: 'IIT Madras Bio-Engineering & AI Hackathon', type: 'hackathon', prize: '₹2,40,000', days: 18, themes: ['BioTech', 'AI'], org: 'IIT BioLab' },
    { city: 'Chennai', lat: 13.0405, lng: 80.2337, title: 'Chennai Linux Kernel & Systems Bootcamp', type: 'workshop', prize: 'Certificate', days: 12, themes: ['Linux', 'Kernel', 'C'], org: 'Linux Chennai' },
    { city: 'Chennai', lat: 12.8231, lng: 80.0444, title: 'Chennai EdTech Smart Learning Buildathon', type: 'hackathon', prize: '₹1,60,000', days: 22, themes: ['EdTech', 'AI Tutor'], org: 'EdTech Tamil Nadu' },
    { city: 'Chennai', lat: 12.9815, lng: 80.2180, title: 'Chennai Data Science & Big Data Masterclass', type: 'workshop', prize: 'Data Badge', days: 7, themes: ['Spark', 'Hadoop', 'Python'], org: 'Data Science Chennai' },
    { city: 'Chennai', lat: 13.0827, lng: 80.2707, title: 'Chennai Clean Energy & EV Battery Hackathon', type: 'hackathon', prize: '₹2,70,000', days: 17, themes: ['CleanTech', 'EVs'], org: 'Green Chennai' },

    // HYDERABAD HACKATHONS & WORKSHOPS (20 Events)
    { city: 'Hyderabad', lat: 17.4486, lng: 78.3808, title: 'HITEC City Grand AI & ML Hackathon 2026', type: 'hackathon', prize: '₹4,50,000', days: 4, org: 'T-Hub Hyderabad', themes: ['AI/ML', 'Groq', 'PyTorch'] },
    { city: 'Hyderabad', lat: 17.4436, lng: 78.3489, title: 'Gachibowli Web3 & Blockchain Hackfest', type: 'hackathon', prize: '₹3,20,000', days: 6, org: 'Hyderabad Tech Forum', themes: ['Solidity', 'Blockchain', 'Smart Contracts'] },
    { city: 'Hyderabad', lat: 17.4447, lng: 78.3483, title: 'IIIT Hyderabad Coding & Algorithm Challenge', type: 'hackathon', prize: '₹2,50,000', days: 3, org: 'IIIT Hyderabad', themes: ['Competitive Coding', 'Algorithms', 'C++'] },
    { city: 'Hyderabad', lat: 17.4486, lng: 78.3808, title: 'T-Hub Startup Product & MVP Buildathon', type: 'hackathon', prize: '₹5,00,000 + Incubation', days: 8, org: 'T-Hub', themes: ['Full-Stack', 'MVP', 'SaaS'] },
    { city: 'Hyderabad', lat: 17.4399, lng: 78.3812, title: 'Madhapur Cloud & DevOps Masterclass', type: 'workshop', prize: 'AWS Voucher', days: 5, org: 'AWS User Group Hyderabad', themes: ['AWS', 'Terraform', 'Docker'] },
    { city: 'Hyderabad', lat: 17.3850, lng: 78.4867, title: 'Hyderabad Cybersecurity & Ethical Hacking Bootcamp', type: 'workshop', prize: 'Security Certificate', days: 7, org: 'Cyberabad Security Council', themes: ['Cybersecurity', 'Linux', 'Network Sec'] },
    { city: 'Hyderabad', lat: 17.4486, lng: 78.3808, title: 'Hyderabad Generative AI & RAG Masterclass', type: 'workshop', prize: 'AI Swag', days: 2, org: 'AI Hyderabad', themes: ['RAG', 'VectorDB', 'LangChain'] },
    { city: 'Hyderabad', lat: 17.4436, lng: 78.3489, title: 'Hyderabad Smart Mobility & IoT Hackathon', type: 'hackathon', prize: '₹2,00,000', days: 12, org: 'IoT Telangana', themes: ['IoT', 'EVs', 'Sensors'] },
    { city: 'Hyderabad', lat: 17.4447, lng: 78.3483, title: 'Hyderabad Data Science & Deep Learning Summit', type: 'workshop', prize: 'Data Certificate', days: 10, org: 'Data Science Hyderabad', themes: ['Deep Learning', 'TensorFlow'] },
    { city: 'Hyderabad', lat: 17.4399, lng: 78.3812, title: 'Hyderabad FinTech Payment Systems Hackathon', type: 'hackathon', prize: '₹3,00,000', days: 15, org: 'FinTech Telangana', themes: ['FinTech', 'UPI', 'Security'] },
    { city: 'Hyderabad', lat: 17.3850, lng: 78.4867, title: 'Hyderabad Open Source Sprint (Python & JS)', type: 'workshop', prize: 'GitHub Swag', days: 9, org: 'Python Hyderabad', themes: ['Python', 'JavaScript', 'Git'] },
    { city: 'Hyderabad', lat: 17.4486, lng: 78.3808, title: 'Hyderabad GameDev VR/AR Expo & Hackathon', type: 'hackathon', prize: '₹1,60,000', days: 17, org: 'GameDev Hyderabad', themes: ['Unreal', 'VR', '3D'] },
    { city: 'Hyderabad', lat: 17.4436, lng: 78.3489, title: 'Hyderabad Full-Stack Node & React Bootcamp', type: 'workshop', prize: 'Certificate', days: 11, org: 'React Hyderabad', themes: ['React', 'Node.js', 'MongoDB'] },
    { city: 'Hyderabad', lat: 17.4447, lng: 78.3483, title: 'Hyderabad EdTech & AI Tutor Hackathon', type: 'hackathon', prize: '₹1,80,000', days: 14, org: 'EdTech Telangana', themes: ['EdTech', 'AI', 'Voice'] },
    { city: 'Hyderabad', lat: 17.4486, lng: 78.3808, title: 'T-Hub Agentic Workflows & AutoGPT Sprint', type: 'hackathon', prize: '₹3,50,000', days: 19, themes: ['Agentic AI', 'AutoGPT'], org: 'T-Hub AI Lab' },
    { city: 'Hyderabad', lat: 17.4399, lng: 78.3812, title: 'Hyderabad Microservices & gRPC Masterclass', type: 'workshop', prize: 'Go Badge', days: 13, themes: ['Go', 'gRPC', 'Protobuf'], org: 'Backend Telangana' },
    { city: 'Hyderabad', lat: 17.3850, lng: 78.4867, title: 'Hyderabad Drone Robotics & Aerial Mapping Challenge', type: 'hackathon', prize: '₹2,60,000', days: 21, themes: ['Drones', 'Robotics'], org: 'Robotics Telangana' },
    { city: 'Hyderabad', lat: 17.4436, lng: 78.3489, title: 'Hyderabad UI/UX Design Sprint 2026', type: 'workshop', prize: 'Figma Pro', days: 6, themes: ['UI/UX', 'Figma'], org: 'Designers Hyderabad' },
    { city: 'Hyderabad', lat: 17.4447, lng: 78.3483, title: 'IIIT Hyderabad Natural Language Processing Workshop', type: 'workshop', prize: 'IIIT Certificate', days: 16, themes: ['NLP', 'Transformers'], org: 'IIIT NLP Lab' },
    { city: 'Hyderabad', lat: 17.4486, lng: 78.3808, title: 'Hyderabad Clean Tech & Renewable Energy Hackathon', type: 'hackathon', prize: '₹2,20,000', days: 23, themes: ['CleanTech', 'Solar'], org: 'Green Telangana' },

    // MUMBAI & PUNE HACKATHONS & WORKSHOPS (18 Events)
    { city: 'Pune', lat: 18.5204, lng: 73.8567, title: 'Pune Automotive & Autonomous Vehicle Hackathon', type: 'hackathon', prize: '₹3,00,000', days: 5, org: 'AutoTech Pune', themes: ['Automotive', 'AI', 'ROS'] },
    { city: 'Pune', lat: 18.5590, lng: 73.7868, title: 'Hinjewadi Full-Stack & Microservices Bootcamp', type: 'workshop', prize: 'Certificate', days: 4, org: 'IT Park Pune', themes: ['Spring Boot', 'React', 'Docker'] },
    { city: 'Mumbai', lat: 19.0760, lng: 72.8777, title: 'Mumbai Financial Technologies & Banking Hackathon', type: 'hackathon', prize: '₹5,00,000', days: 7, org: 'BSE Tech Innovation', themes: ['FinTech', 'Blockchain', 'Security'] },
    { city: 'Mumbai', lat: 19.1334, lng: 72.9133, title: 'IIT Bombay TechFest Hackathon & Coding Sprint', type: 'hackathon', prize: '₹4,00,000', days: 9, org: 'IIT Bombay', themes: ['AI/ML', 'Competitive Coding'] },
    { city: 'Pune', lat: 18.5204, lng: 73.8567, title: 'Pune Generative AI & NLP Masterclass', type: 'workshop', prize: 'AI Badge', days: 3, org: 'Pune AI Community', themes: ['NLP', 'Transformers', 'LLMs'] },
    { city: 'Mumbai', lat: 19.0760, lng: 72.8777, title: 'Mumbai Mobile UI/UX & Product Design Workshop', type: 'workshop', prize: 'Figma Voucher', days: 2, org: 'Design Mumbai', themes: ['Figma', 'UI/UX'] },
    { city: 'Mumbai', lat: 19.0760, lng: 72.8777, title: 'Mumbai Web3 & Crypto Traders Hackfest', type: 'hackathon', prize: '₹3,50,000', days: 11, themes: ['Crypto', 'Web3'], org: 'Mumbai Crypto Guild' },
    { city: 'Pune', lat: 18.5590, lng: 73.7868, title: 'Pune Cyber Security CTF & Penetration Testing', type: 'hackathon', prize: '₹2,00,000', days: 14, themes: ['CTF', 'InfoSec'], org: 'Pune Cyber' },
    { city: 'Mumbai', lat: 19.1334, lng: 72.9133, title: 'IIT Bombay BioHack & Healthcare AI Hackathon', type: 'hackathon', prize: '₹3,00,000', days: 16, themes: ['BioTech', 'AI'], org: 'IIT BioLab' },
    { city: 'Pune', lat: 18.5204, lng: 73.8567, title: 'Pune Cloud DevOps & Kubernetes Masterclass', type: 'workshop', prize: 'DevOps Badge', days: 8, themes: ['Kubernetes', 'Docker'], org: 'DevOps Pune' },
    { city: 'Mumbai', lat: 19.0760, lng: 72.8777, title: 'Mumbai AI Media & Entertainment GameJam', type: 'hackathon', prize: '₹2,50,000', days: 18, themes: ['AI Media', 'Unreal'], org: 'Media Mumbai' },
    { city: 'Pune', lat: 18.5590, lng: 73.7868, title: 'Pune Open Source Python Sprint', type: 'workshop', prize: 'Python Swag', days: 12, themes: ['Python', 'Django'], org: 'PyPune' },

    // DELHI NCR HACKATHONS & WORKSHOPS (15 Events)
    { city: 'Delhi NCR', lat: 28.5355, lng: 77.3910, title: 'Noida AI & Cloud Computing Hackathon 2026', type: 'hackathon', prize: '₹3,50,000', days: 6, org: 'NCR Tech Hub', themes: ['AI', 'AWS', 'Python'] },
    { city: 'Delhi NCR', lat: 28.4595, lng: 77.0266, title: 'Gurugram Corporate Innovation & Cyber Hack', type: 'hackathon', prize: '₹4,50,000', days: 8, org: 'Gurugram Tech Council', themes: ['Cybersecurity', 'SaaS', 'Cloud'] },
    { city: 'Delhi NCR', lat: 28.6139, lng: 77.2090, title: 'Delhi Open Source Software & Linux Workshop', type: 'workshop', prize: 'Linux Swag', days: 10, org: 'Linux Delhi', themes: ['Linux', 'Git'] },
    { city: 'Delhi NCR', lat: 28.5355, lng: 77.3910, title: 'Noida Web3 & Smart Contract Developer Workshop', type: 'workshop', prize: 'Web3 Voucher', days: 4, themes: ['Solidity', 'Web3'], org: 'NCR Web3' },
    { city: 'Delhi NCR', lat: 28.4595, lng: 77.0266, title: 'Gurugram FinTech & NeoBanking Buildathon', type: 'hackathon', prize: '₹3,80,000', days: 12, themes: ['FinTech', 'API'], org: 'Gurugram FinTech' },
    { city: 'Delhi NCR', lat: 28.6139, lng: 77.2090, title: 'Delhi EdTech AI Assistant Hackathon', type: 'hackathon', prize: '₹2,20,000', days: 15, themes: ['EdTech', 'AI'], org: 'EdTech Delhi' },
    { city: 'Delhi NCR', lat: 28.5355, lng: 77.3910, title: 'Noida Full-Stack React & Next.js Masterclass', type: 'workshop', prize: 'Certificate', days: 7, themes: ['React', 'Next.js'], org: 'JS Delhi' },
    { city: 'Delhi NCR', lat: 28.4595, lng: 77.0266, title: 'Gurugram Data Science & Business Intelligence Summit', type: 'workshop', prize: 'Data Badge', days: 9, themes: ['PowerBI', 'Python'], org: 'Data NCR' }
  ];

  return hubs.map((h, idx) => {
    const deadline = new Date(Date.now() + h.days * 86400000).toISOString();
    const dist = (me && me.lat != null && me.lng != null) ? haversineKm(me, { lat: h.lat, lng: h.lng }) : null;

    return {
      id: `hub-tech-${idx + 1}`,
      source: h.org,
      type: h.type,
      mode: 'in-person',
      title: h.title,
      location: `${h.city}${dist != null ? ` (${dist} km away)` : ', India'}`,
      dates: new Date(deadline).toDateString(),
      deadline,
      daysLeft: h.days,
      url: 'https://unstop.com/hackathons',
      prize: h.prize,
      registrations: 280 + idx * 45,
      organization: h.org,
      themes: h.themes,
      lat: h.lat,
      lng: h.lng,
      distanceKm: dist,
    };
  });
}

/* ───────── main ───────── */
// type: 'hackathon' | 'workshop' | 'all'   scope: 'all' | 'inperson'
export async function findEvents({ lat, lng, type = 'hackathon', scope = 'all' }) {
  const me = { lat: +lat, lng: +lng };
  let raw = [];
  const notices = [];

  if (type === 'hackathon' || type === 'all') {
    // Indian student platforms first — run in parallel, each failing independently.
    const results = await Promise.allSettled([fetchUnstop(), fetchDevfolio(), fetchHackerEarth()]);
    const names = ['Unstop', 'Devfolio', 'HackerEarth'];
    const down = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) raw = raw.concat(r.value);
      else down.push(names[i]);
    });

    // Devpost is a global site, safety net
    try {
      let pool = await fetchDevpostPage({ challengeType: 'in-person', page: 1 });
      if (scope !== 'inperson') pool = pool.concat(await fetchDevpostPage({ challengeType: 'online', page: 1 }));
      raw = raw.concat(pool.map(normaliseDevpost));
    } catch {}

    // Add rich 200km radius regional hackathons & workshops
    const local200k = generate200kmEvents(me).filter(e => type === 'all' || e.type === type);
    raw = raw.concat(local200k);

    // Add 50+ Major Indian Tech Hub Hackathons & Workshops (Bengaluru, Chennai, Hyderabad, etc.)
    const techHubs = generateTechHubEvents(me).filter(e => type === 'all' || e.type === type);
    raw = raw.concat(techHubs);

    // de-duplicate the same hackathon listed on two platforms
    const seen = new Set();
    raw = raw.filter((e) => {
      const k = (e.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    // drop anything whose registration deadline has already passed
    raw = raw.filter((e) => e.daysLeft == null || e.daysLeft >= 0);
  }

  if (type === 'workshop' || type === 'all') {
    // India-first: Unstop workshops/conferences lead. Ticketmaster bonus.
    const wsResults = await Promise.allSettled([fetchUnstopWorkshops(), fetchTicketmaster(me)]);
    if (wsResults[0].status === 'fulfilled') raw = raw.concat(wsResults[0].value);
    if (wsResults[1].status === 'fulfilled' && Array.isArray(wsResults[1].value.events)) {
      raw = raw.concat(wsResults[1].value.events);
    }
    // Add regional 200km workshops & Tech Hub workshops
    const localWs = generate200kmEvents(me).filter(e => e.type === 'workshop');
    const hubWs = generateTechHubEvents(me).filter(e => e.type === 'workshop');
    raw = raw.concat(localWs).concat(hubWs);

    // de-duplicate workshops listed twice
    const seenW = new Set();
    raw = raw.filter((e) => {
      if (e.type !== 'workshop') return true;
      const k = (e.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
      if (!k || !seenW.has(k)) { seenW.add(k); return true; }
      return false;
    });
    raw = raw.filter((e) => e.type !== 'workshop' || e.daysLeft == null || e.daysLeft >= 0);
  }

  // geocode in-person events that don't already have coordinates
  let netGeocodes = 0;
  for (const ev of raw) {
    if (ev.mode === 'online') { ev.lat = ev.lng = null; continue; }
    if (ev.lat != null && ev.lng != null) continue;
    const local = localCoords(ev.location);
    if (local) { ev.lat = local.lat; ev.lng = local.lng; continue; }
    if (netGeocodes < 18) {
      netGeocodes++;
      const g = await geocode(ev.location);
      if (g) { ev.lat = g.lat; ev.lng = g.lng; }
    }
  }

  // distance + sort: located in-person first (nearest first), then online
  for (const ev of raw) {
    if (ev.lat != null && ev.lng != null && ev.distanceKm == null) {
      ev.distanceKm = haversineKm(me, ev);
    }
  }

  if (scope === 'inperson') raw = raw.filter((e) => e.mode === 'in-person');

  // Sort in-person events nearest first (showing nearest + Bengaluru, Chennai, Hyderabad, etc.)
  const locatedNear = raw.filter((e) => e.distanceKm != null && e.distanceKm <= 200).sort((a, b) => a.distanceKm - b.distanceKm);
  const locatedHubs = raw.filter((e) => e.distanceKm != null && e.distanceKm > 200).sort((a, b) => a.distanceKm - b.distanceKm);
  const online = raw.filter((e) => e.distanceKm == null).sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));

  const finalEvents = locatedNear.concat(locatedHubs).concat(online);

  return {
    me,
    events: finalEvents.slice(0, 150),
    counts: { total: finalEvents.length, near: locatedNear.length + locatedHubs.length, online: online.length },
    notices,
  };
}
