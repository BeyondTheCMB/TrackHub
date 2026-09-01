// api/futbolfantasy.js — Vercel serverless proxy para la probabilidad de
// jugar de cada futbolista de LaLiga, vía FutbolFantasy.com.
//
// Dos modos, según el parámetro que llegue:
//   ?team=<slug>   → probabilidades de un solo equipo (útil para depurar).
//   ?all=1         → probabilidades de los 20 equipos de LaLiga a la vez,
//                     en paralelo. Este es el modo "centralizado" que usa
//                     BiwengerLog para sincronizar toda la plantilla de una
//                     tacada.
//
// AVISO (mismo patrón que Finect en vesta-quotes.js): la extracción se hace
// convirtiendo el HTML a texto plano (quitando etiquetas) y aplicando
// expresiones regulares sobre ese texto — no sobre el HTML crudo. Es un
// ajuste sobre el formato de hoy de FutbolFantasy, no algo blindado ante
// un cambio futuro de su maquetación. Cada fila de jugador en la página
// contiene, en texto plano y en este orden, el nombre completo, el
// porcentaje de probabilidad de ser titular la próxima jornada, la edad,
// el pie dominante y la altura — ese bloque de cinco datos es el ancla:
// es muy específico (no aparece en ningún otro sitio de la página) y por
// tanto tiene un riesgo de falso positivo prácticamente nulo. El nombre se
// captura mirando hacia atrás desde ese ancla; a veces una etiqueta de
// jerarquía ("Rotación", "Clave", "Importante"…) queda pegada justo
// delante del nombre — se recorta con una lista cerrada de esas etiquetas,
// tomada del propio glosario que publica FutbolFantasy en la página.
//
// Los slugs de equipo (alaves, athletic, atletico, barcelona, betis,
// celta, deportivo, elche, espanyol, getafe, levante, malaga, osasuna,
// racing, rayo-vallecano, real-madrid, real-sociedad, sevilla, valencia,
// villarreal) coinciden con el campo teamSlug que ya trae la API de
// Biwenger para cada jugador (ver BW_SOFASCORE_TEAMS en biwengerlog.js) —
// eso permite acotar el emparejamiento de nombres al mismo equipo en vez
// de buscar en las ~500 fichas de toda LaLiga a la vez.
//
// Respuesta ?team=:  { equipo, slug, players: [{nombre,prob,edad,pie,altura}], asOf }
// Respuesta ?all=1:  { asOf, teams: { <slug>: { equipo, players: [...] } }, errors: [{slug,message}] }

const LALIGA_TEAMS = {
  "alaves":         "Alavés",
  "athletic":       "Athletic",
  "atletico":       "Atlético",
  "barcelona":      "Barcelona",
  "betis":          "Betis",
  "celta":          "Celta",
  "deportivo":      "Deportivo",
  "elche":          "Elche",
  "espanyol":       "Espanyol",
  "getafe":         "Getafe",
  "levante":        "Levante",
  "malaga":         "Málaga",
  "osasuna":        "Osasuna",
  "racing":         "Racing",
  "rayo-vallecano": "Rayo Vallecano",
  "real-madrid":    "Real Madrid",
  "real-sociedad":  "Real Sociedad",
  "sevilla":        "Sevilla",
  "valencia":       "Valencia",
  "villarreal":     "Villarreal",
};

const HTML_ENTITIES = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&euro;": "€" };
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&euro;/g, m => HTML_ENTITIES[m])
    .replace(/\s+/g, " ")
    .trim();
}

// Ancla: "NN% NN años Pie H.HHm" — el bloque "Prob./Edad/Pie/Altura" que
// FutbolFantasy pinta junto a cada jugador. Nota: la altura usa PUNTO
// decimal ("1.76m"), no coma — a diferencia de los importes en euros de
// la misma página, que sí usan coma.
const ANCHOR_RE = /(\d{1,3})%\s(\d{1,2})\s?años\s(Derecho|Izquierdo|Ambidiestro)\s([\d.,]+)m/g;

// Nombre: carrera de palabras que empiezan en mayúscula, permitiendo
// conectores en minúscula típicos de apellidos españoles/neerlandeses
// ("Frenkie de Jong", "Rodri de la Fuente"...) en medio.
const NAME_RE = /([A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’.-]*(?:\s+(?:de|del|la|los|van|von|dos|da|le|el)?\s*[A-ZÀ-ÖØ-Þ][\wÀ-ÿ'’.-]*)*)\s*$/;

// Etiquetas de "jerarquía" que FutbolFantasy pinta justo delante del
// nombre en algunas filas — se recortan si aparecen como primera palabra
// capturada, para no colarlas dentro del nombre del jugador.
const JERARQUIA = new Set(["Dios", "Clave", "Importante", "Rotación", "Revulsivo", "Reserva", "Descarte", "Suplente", "Titular"]);
function stripJerarquia(nombre) {
  const words = nombre.split(/\s+/);
  while (words.length > 1 && JERARQUIA.has(words[0])) words.shift();
  return words.join(" ");
}

async function fetchTeamProbabilities(slug, signal) {
  const url = `https://www.futbolfantasy.com/laliga/equipos/${slug}`;
  const r = await fetch(url, {
    signal,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "es-ES,es;q=0.9",
    },
  });
  if (!r.ok) throw { status: 502, message: `FutbolFantasy respondió ${r.status} para "${slug}"` };
  const html = await r.text();
  const text = htmlToText(html);

  const seen = new Map(); // nombre normalizado → registro (dedupe: la página repite jugadores en varias secciones)
  let m;
  ANCHOR_RE.lastIndex = 0;
  while ((m = ANCHOR_RE.exec(text)) !== null) {
    const [, prob, edad, pie, altura] = m;
    const before = text.slice(Math.max(0, m.index - 80), m.index);
    const nm = before.match(NAME_RE);
    if (!nm) continue;
    const nombre = stripJerarquia(nm[1].trim());
    if (!nombre || nombre.length < 2) continue;
    seen.set(nombre, { nombre, prob: Number(prob), edad: Number(edad), pie, altura: altura.replace(",", ".") });
  }

  if (seen.size === 0) {
    throw { status: 422, message: `No se encontraron jugadores para "${slug}" — puede que FutbolFantasy haya cambiado el formato de la página.` };
  }

  return { equipo: LALIGA_TEAMS[slug] || slug, slug, players: [...seen.values()] };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { team, all } = req.query;

  try {
    if (team && typeof team === "string") {
      const slug = team.trim().toLowerCase();
      if (!LALIGA_TEAMS[slug]) {
        return res.status(400).json({ error: `Slug de equipo desconocido: "${slug}". Válidos: ${Object.keys(LALIGA_TEAMS).join(", ")}` });
      }
      const q = await fetchTeamProbabilities(slug);
      return res.status(200).json({ ...q, asOf: new Date().toISOString() });
    }

    if (all) {
      const slugs = Object.keys(LALIGA_TEAMS);
      const results = await Promise.allSettled(
        slugs.map(slug => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 9000);
          return fetchTeamProbabilities(slug, controller.signal).finally(() => clearTimeout(timeout));
        })
      );

      const teams = {};
      const errors = [];
      results.forEach((r, i) => {
        const slug = slugs[i];
        if (r.status === "fulfilled") {
          teams[slug] = { equipo: r.value.equipo, players: r.value.players };
        } else {
          errors.push({ slug, message: (r.reason && r.reason.message) || String(r.reason) });
        }
      });

      return res.status(200).json({ asOf: new Date().toISOString(), teams, errors });
    }

    return res.status(400).json({ error: "Falta el parámetro 'team' o 'all'." });
  } catch (e) {
    const status = (e && e.status) || 500;
    const message = (e && e.message) || String(e);
    return res.status(status).json({ error: message });
  }
}
