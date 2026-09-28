import { gsap } from "gsap";

/**
 * La escena animada del hero: un día de trabajo contado por Camila, la conductora.
 * =============================================================================
 *
 * Pedidos → retiro en bodega → asignación y carga → en ruta → entrega. Solo lo
 * operativo, sin dinero (decisión del usuario, 2026-09-27: la versión con la
 * tabla de pedidos mostraba códigos y «no daba confianza»). Aprobada como
 * maqueta en https://claude.ai/artifact/SwdZBhoqk5sPHhVz1r7F2y (v3).
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ ES IMPERATIVA Y NO JSX
 * -----------------------------------------------------------------------------
 * La escena son ~60 piezas que GSAP mueve 60 veces por segundo. Si React las
 * dibujara, cada cuadro sería un render; y el traductor de Chrome, que envuelve
 * los textos en `<font>`, tumbaría la página en cuanto React quisiera editar uno
 * (mordió el 2026-09-27, commit `70c8461`). Aquí React solo dibuja el marco, y
 * este módulo es dueño de todo lo que cambia: el lienzo, el riel y el subtítulo.
 *
 * -----------------------------------------------------------------------------
 * CÓMO ESTÁ ARMADA
 * -----------------------------------------------------------------------------
 * · Las escenas viven en un solo «mundo» a lo largo del eje x (0 · 800 · 1600 ·
 *   ruta · 3600) y una cámara lo recorre: se acerca en los momentos clave y
 *   sigue a la camioneta en la ruta.
 * · Los personajes tienen rodillas y codos (dos huesos por extremidad). Su pose
 *   son números en un objeto que GSAP interpola; un único `ticker` los traduce a
 *   atributos `transform` en cada cuadro. Así el `seek` del riel es exacto.
 * · En pantallas angostas el lienzo pasa a cuadrado y encuadra el centro, donde
 *   ocurre toda la acción: en el teléfono se ve casi del mismo tamaño.
 * · Un teléfono grande muestra la app en cada momento (retiro, su día, la ruta,
 *   la evidencia de la entrega). Cuando aparece, la cámara corre la acción a la
 *   izquierda para dejarle sitio (`cam.tel`).
 *
 * -----------------------------------------------------------------------------
 * «TU EMPRESA», NO RUTAX
 * -----------------------------------------------------------------------------
 * La camioneta, la gorra y el uniforme llevan un logo genérico que dice «Tu
 * empresa», en un naranja que no es de Rutax (decisión del usuario, 2026-09-28):
 * quien reparte es el courier que nos compra. Rutax aparece solo dentro de la
 * app, que es lo que vendemos.
 *
 * ⚠️ Dos trampas de GSAP que ya mordieron al construirla:
 * · Un `fromTo` pinta su estado inicial apenas se crea. Si ese estado es visible
 *   (un anillo con opacidad), aparece desde el primer cuadro: `immediateRender:false`.
 * · `tl.seek(t)` suprime los `onUpdate` por defecto y los contadores quedan en
 *   cero: se busca con `seek(t, false)`.
 */

export interface PiezasFlujo {
  figura: HTMLElement;
  lienzo: SVGSVGElement;
  pasos: HTMLElement[];
  titulo: HTMLElement;
  subtitulo: HTMLElement;
  pausa: HTMLButtonElement;
  iconoPausa: SVGSVGElement;
}

const NS = "http://www.w3.org/2000/svg";
const R = Math.PI / 180;
/** El color de «tu empresa»: intencionalmente ajeno a la paleta de Rutax. */
const MARCA = "#EF6C3E";
const MARCA_OSC = "#CF5528";
/** Logo genérico del courier: un círculo con una flecha, y el nombre si hay sitio. */
function logoEmpresa(x: number, y: number, r: number, texto?: { tam: number; color: string }) {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${MARCA}"/>` +
    `<path d="M${x - r * 0.42} ${y + r * 0.1} L${x - r * 0.05} ${y + r * 0.45} L${x + r * 0.5} ${y - r * 0.35}" fill="none" stroke="#FFFFFF" stroke-width="${Math.max(1.2, r * 0.26)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    (texto ? `<text x="${x + r + 6}" y="${y + texto.tam * 0.36}" font-size="${texto.tam}" font-weight="700" fill="${texto.color}" letter-spacing="-.3">Tu empresa</text>` : "")
  );
}

const LIMITES = [0, 4.9, 11.4, 16.2, 21.4, 29.2];
/** A dónde salta cada paso del riel: cuando su escena ya está encuadrada, no a mitad del paneo. */
const ENTRADAS = [0.01, 7.4, 12.0, 17.2, 22.2];
const TEXTOS: [string, string][] = [
  ["Llegan los pedidos", "Desde las tiendas de tus clientes, sin digitar nada."],
  ["Retiro en bodega", "El conductor escanea cada paquete con la app."],
  ["Se reparten los pedidos", "Cada conductor recibe los suyos, por zona."],
  ["Salen a repartir", "La ruta ya viene ordenada en la app."],
  ["Entregado", "Con foto y ubicación, y tu cliente lo ve al momento."],
];

const ICONO_PAUSA =
  '<rect x="2" y="1" width="3.5" height="12" fill="currentColor"/><rect x="8.5" y="1" width="3.5" height="12" fill="currentColor"/>';
const ICONO_PLAY = '<path d="M3 1.5 L12.5 7 L3 12.5 Z" fill="currentColor"/>';

const LIENZO = `
<defs>
  <radialGradient id="fo-luz" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="var(--e-st-glow)"/><stop offset="1" stop-color="var(--e-st-bg)"/></radialGradient>
  <linearGradient id="fo-suelo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--e-st-floor-top)"/><stop offset="1" stop-color="var(--e-st-floor)"/></linearGradient>
  <linearGradient id="fo-haz" x1="0" x2="1"><stop offset="0" stop-color="var(--e-accent)" stop-opacity=".9"/><stop offset="1" stop-color="var(--e-accent)" stop-opacity=".08"/></linearGradient>
  <clipPath id="fo-pantalla"><rect x="6" y="6" width="138" height="288" rx="21"/></clipPath>
  <filter id="fo-difuso" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="3.2"/></filter>
  <filter id="fo-bokeh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="fo-elevar" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#0B1114" flood-opacity=".14"/></filter>
</defs>
<rect x="-400" y="-400" width="1440" height="1160" fill="url(#fo-luz)"/>
<g data-p="fondo" opacity=".75"></g>
<g data-p="mundo">
  <rect x="-800" y="290" width="6000" height="500" fill="url(#fo-suelo)"/>
  <rect x="-800" y="289" width="6000" height="1.5" fill="var(--e-st-horizon)"/>
  <g data-p="rayas"></g>
  <g data-p="escenas"></g>
  <g data-p="actores"></g>
  <g data-p="frente"></g>
</g>
<g data-p="hud"></g>
<rect data-p="flash" x="-400" y="-400" width="1440" height="1160" fill="#FFFFFF" opacity="0"/>
<rect data-p="velo" x="-400" y="-400" width="1440" height="1160" fill="var(--e-raised)" opacity="0"/>`;

/* ───────────────────────── utilidades ───────────────────────── */

function fx(n: number) {
  return n.toFixed(2);
}
function nodo(padre: Element, markup: string, attrs?: Record<string, string>): SVGGElement {
  const g = document.createElementNS(NS, "g");
  g.innerHTML = markup;
  if (attrs) for (const k in attrs) g.setAttribute(k, attrs[k]);
  padre.appendChild(g);
  return g;
}
function hijo<T extends Element = SVGGElement>(padre: Element, selector: string): T {
  const el = padre.querySelector<T>(selector);
  if (!el) throw new Error(`flujo-escena: falta ${selector}`);
  return el;
}

function cajaSVG(w: number, h: number) {
  return (
    `<rect x="${-w / 2}" y="${-h}" width="${w}" height="${h}" rx="3" fill="var(--e-kraft)"/>` +
    `<rect x="${w / 2 - w * 0.32}" y="${-h}" width="${w * 0.32}" height="${h}" rx="3" fill="var(--e-kraft-osc)" opacity=".45"/>` +
    `<rect x="-3" y="${-h}" width="6" height="${h}" fill="var(--e-tape)"/>` +
    `<rect x="${-w / 2 + 5}" y="${-h * 0.45}" width="${w * 0.28}" height="${h * 0.24}" rx="1.2" fill="#FFFFFF" opacity=".88"/>` +
    `<rect x="${-w / 2}" y="-3" width="${w}" height="3" rx="1.5" fill="#000" opacity=".1"/>`
  );
}

interface Caja {
  el: SVGGElement;
  sq: SVGGElement;
  w: number;
  h: number;
}
/** Caja móvil: el grupo externo se traslada; el interno se aplasta desde la base. */
function caja(padre: Element, w: number, h: number, x: number, y: number): Caja {
  const el = nodo(padre, `<g>${cajaSVG(w, h)}</g>`);
  const sq = el.firstChild as SVGGElement;
  gsap.set(el, { x, y });
  gsap.set(sq, { transformOrigin: "50% 100%" });
  return { el, sq, w, h };
}

/* ───────────────────────── personajes ───────────────────────── */

interface Rig {
  el: SVGGElement;
  todo: SVGGElement;
  sups: NodeListOf<SVGGElement>;
  mB: SVGGElement;
  mF: SVGGElement;
  rB: SVGGElement;
  rF: SVGGElement;
  hB: SVGGElement;
  hF: SVGGElement;
  cB: SVGGElement;
  cF: SVGGElement;
  cab: SVGGElement;
  coleta: SVGGElement | null;
  ojo: SVGGElement;
  boca: SVGPathElement;
  tel: SVGGElement;
  carga: SVGGElement;
  x: number;
  y: number;
  dir: number;
  esc: number;
  op: number;
  fase: number;
  amp: number;
  inclina: number;
  cabeza: number;
  shF: number;
  elF: number;
  shB: number;
  elB: number;
  swing: number;
  telOp: number;
  cargaOp: number;
  feliz: number;
  semilla: number;
}

interface Aspecto {
  polera: string;
  poleraOsc: string;
  piel: string;
  pielOsc: string;
  pantalon: string;
  pantalonOsc: string;
  pelo: string;
  estilo: "gorra" | "rizos";
  marca?: boolean;
}

/** Origen en los pies, mira a la derecha. Cadera (0,-46), hombro (0,-82), cuello (0,-90). */
function persona(padre: Element, o: Aspecto): Rig {
  const zapato = "#1C262B";
  const pierna = (t: "B" | "F") => {
    const c = t === "B" ? o.pantalonOsc : o.pantalon;
    return (
      `<g class="muslo${t}"><line y2="22" stroke="${c}" stroke-width="12.5" stroke-linecap="round"/>` +
      `<g class="rodilla${t}"><line y2="20" stroke="${c}" stroke-width="11" stroke-linecap="round"/>` +
      `<path d="M-6 17.5 Q-6.5 25 1 25 H12.5 Q15.5 25 14.5 21.5 Q13 17 5 16.5 Z" fill="${zapato}"/></g></g>`
    );
  };
  const brazo = (t: "B" | "F", item = "") => {
    const c = t === "B" ? o.poleraOsc : o.polera;
    const piel = t === "B" ? o.pielOsc : o.piel;
    return (
      `<g class="hombro${t}"><line y2="15" stroke="${c}" stroke-width="10.5" stroke-linecap="round"/>` +
      `<g class="codo${t}"><line y2="14" stroke="${piel}" stroke-width="7.5" stroke-linecap="round"/><circle cy="17.5" r="4.9" fill="${piel}"/>${item}</g></g>`
    );
  };
  const tel =
    '<g class="tel"><g transform="rotate(-12)"><rect x="-4" y="9" width="10.5" height="17" rx="2.4" fill="#0B1114"/><rect x="-2.4" y="11" width="7.3" height="12" rx="1.3" fill="#00D6B4"/></g></g>';
  const pelo =
    o.estilo === "gorra"
      ? `<path d="M-17 -1 Q-19 -17 -3 -19 L0 6 Q-12 12 -17 -1 Z" fill="${o.pelo}"/>` +
        `<g class="coleta" transform="translate(-15 -3)"><path d="M0 0 Q-9 6 -7 20 Q-2 14 3 4 Z" fill="${o.pelo}"/></g>`
      : `<circle cx="-9" cy="-10" r="8" fill="${o.pelo}"/><circle cx="1" cy="-15" r="8.5" fill="${o.pelo}"/><circle cx="11" cy="-11" r="7" fill="${o.pelo}"/><circle cx="-14" cy="-1" r="6.5" fill="${o.pelo}"/><circle cx="-11" cy="8" r="5" fill="${o.pelo}"/>`;
  const gorra =
    o.estilo === "gorra"
      ? `<path d="M-16.5 -5 Q-15.5 -22 2 -22 Q17.5 -22 17.5 -6 Z" fill="${MARCA}"/>` + '<path d="M-16.5 -5 Q-15.5 -22 2 -22 Q-8 -18 -9 -5 Z" fill="#000" opacity=".12"/>' +
        `<path d="M12 -7.5 Q23 -9 27.5 -4.5 Q20 -2.8 12 -4 Z" fill="${MARCA_OSC}"/>` +
        '<circle cx="2" cy="-13" r="3.6" fill="#FFFFFF"/><path d="M0.6 -12.8 L1.9 -11.6 L3.9 -14.2" fill="none" stroke="#EF6C3E" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>'
      : "";
  const marca = o.marca
    ? '<circle cx="5" cy="-73" r="4.6" fill="#FFFFFF"/><path d="M3.1 -72.8 L4.8 -71.2 L7.4 -74.6" fill="none" stroke="#EF6C3E" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
    : "";

  const g = nodo(
    padre,
    '<ellipse cx="3" cy="1" rx="23" ry="4.8" fill="var(--e-st-shadow)" style="opacity:var(--e-st-shadow-op)" filter="url(#fo-difuso)"/>' +
      '<g class="todo">' +
      pierna("B") +
      '<g class="sup">' +
      brazo("B") +
      `<rect x="-4" y="-94" width="8" height="10" fill="${o.pielOsc}"/>` +
      `<path d="M-14 -86 Q-17.5 -66 -13.5 -45 H13.5 Q17.5 -66 14 -86 Q0 -92 -14 -86 Z" fill="${o.polera}"/>` +
      '<path d="M-14 -86 Q-17.5 -66 -13.5 -45 H-5 Q-9 -66 -6 -89.5 Z" fill="#000" opacity=".13"/>' +
      `<path d="M-13.5 -50 H13.5 V-44 Q0 -41 -13.5 -44 Z" fill="${o.pantalon}"/>` +
      marca +
      '<g class="cabeza">' +
      pelo +
      `<circle r="17" fill="${o.piel}"/>` +
      '<path d="M1 -17 A17 17 0 0 0 1 17 A12 17 0 0 1 1 -17 Z" fill="#000" opacity=".08"/>' +
      `<circle cx="-2" cy="2" r="3.8" fill="${o.pielOsc}"/>` +
      `<path d="M16.4 -1 Q19 2.4 16 4" fill="none" stroke="${o.pielOsc}" stroke-width="1.6" stroke-linecap="round"/>` +
      '<circle cx="11" cy="5" r="3.3" fill="#F08A7E" opacity=".32"/>' +
      '<g class="ojo" transform="translate(9 -1.5)"><ellipse rx="2.2" ry="2.9" fill="#0B1114"/><circle cx=".8" cy="-1.1" r=".8" fill="#FFFFFF"/></g>' +
      `<path d="M5.5 -7.6 Q9 -9.8 13 -7.8" fill="none" stroke="${o.pelo}" stroke-width="1.7" stroke-linecap="round"/>` +
      '<path class="boca" d="M8 7.5 Q11 10 14.2 7" fill="none" stroke="#6B2E24" stroke-width="1.7" stroke-linecap="round"/>' +
      gorra +
      "</g>" +
      `<g class="carga"><g transform="translate(24 -65)">${cajaSVG(30, 24)}</g></g>` +
      "</g>" +
      pierna("F") +
      `<g class="sup">${brazo("F", tel)}</g>` +
      "</g>"
  );
  return {
    el: g,
    todo: hijo(g, ".todo"),
    sups: g.querySelectorAll<SVGGElement>(".sup"),
    mB: hijo(g, ".musloB"),
    mF: hijo(g, ".musloF"),
    rB: hijo(g, ".rodillaB"),
    rF: hijo(g, ".rodillaF"),
    hB: hijo(g, ".hombroB"),
    hF: hijo(g, ".hombroF"),
    cB: hijo(g, ".codoB"),
    cF: hijo(g, ".codoF"),
    cab: hijo(g, ".cabeza"),
    coleta: g.querySelector<SVGGElement>(".coleta"),
    ojo: hijo(g, ".ojo"),
    boca: hijo<SVGPathElement>(g, ".boca"),
    tel: hijo(g, ".tel"),
    carga: hijo(g, ".carga"),
    x: 0,
    y: 290,
    dir: 1,
    esc: 1,
    op: 1,
    fase: 0,
    amp: 0,
    inclina: 0,
    cabeza: 0,
    shF: 0,
    elF: -8,
    shB: 0,
    elB: -8,
    swing: 1,
    telOp: 0,
    cargaOp: 0,
    feliz: 0,
    semilla: Math.random() * 6,
  };
}

function pintarPersona(r: Rig, t: number) {
  r.el.setAttribute("transform", `translate(${fx(r.x)} ${fx(r.y)}) scale(${fx(r.dir * r.esc)} ${fx(r.esc)})`);
  r.el.setAttribute("opacity", fx(r.op));
  const a = r.amp;
  const s = Math.sin(r.fase);
  const c = Math.cos(r.fase);
  const respira = Math.sin(t * 2.2 + r.semilla) * 0.6 * (1 - a);
  r.todo.setAttribute("transform", `translate(0 ${fx(-2.4 * a * Math.abs(c) + respira * 0.4)})`);
  r.sups.forEach((sup) => sup.setAttribute("transform", `rotate(${fx(r.inclina + 3 * a)} 0 -46)`));
  r.mF.setAttribute("transform", `translate(0 -46) rotate(${fx(-25 * a * s)})`);
  r.mB.setAttribute("transform", `translate(0 -46) rotate(${fx(25 * a * s)})`);
  r.rF.setAttribute("transform", `translate(0 22) rotate(${fx(a * (4 + 40 * Math.pow(Math.max(0, c), 1.5)))})`);
  r.rB.setAttribute("transform", `translate(0 22) rotate(${fx(a * (4 + 40 * Math.pow(Math.max(0, -c), 1.5)))})`);
  const sw = a * r.swing;
  r.hF.setAttribute("transform", `translate(0 -82) rotate(${fx(r.shF + 22 * sw * s)})`);
  r.hB.setAttribute("transform", `translate(0 -82) rotate(${fx(r.shB - 22 * sw * s)})`);
  r.cF.setAttribute("transform", `translate(0 15) rotate(${fx(r.elF - sw * (10 + 14 * Math.max(0, -s)))})`);
  r.cB.setAttribute("transform", `translate(0 15) rotate(${fx(r.elB - sw * (10 + 14 * Math.max(0, s)))})`);
  r.cab.setAttribute("transform", `rotate(${fx(r.cabeza + 1.5 * a * Math.sin(r.fase * 2 - 0.6))} 0 -90) translate(0 -105)`);
  if (r.coleta) {
    const giro = 8 + 16 * a * Math.sin(r.fase * 2 - 1.1) + Math.sin(t * 1.7) * 2 * (1 - a) - r.inclina;
    r.coleta.setAttribute("transform", `translate(-15 -3) rotate(${fx(giro)})`);
  }
  const ojo = (t + r.semilla) % 3.4 < 0.12 ? 0.12 : 1; // parpadeo
  r.ojo.setAttribute("transform", `translate(9 -1.5) scale(1 ${ojo})`);
  r.boca.setAttribute("d", `M8 7.5 Q11 ${fx(10 + r.feliz * 2.4)} 14.2 7`);
  r.tel.setAttribute("opacity", fx(r.telOp));
  r.carga.setAttribute("opacity", fx(r.cargaOp));
}

/** Mano delantera en coordenadas de mundo: de ahí sale el haz del escáner. */
function mano(r: Rig) {
  const a1 = r.shF * R;
  const ex = -15 * Math.sin(a1);
  const ey = -82 + 15 * Math.cos(a1);
  const a2 = (r.shF + r.elF) * R;
  return { x: r.x + r.dir * (ex - 19 * Math.sin(a2)) * r.esc, y: r.y + (ey + 19 * Math.cos(a2)) * r.esc };
}

/* ───────────────────────── montaje ───────────────────────── */

export function montarFlujo(p: PiezasFlujo): () => void {
  const { figura, lienzo } = p;
  lienzo.innerHTML = LIENZO;
  const parte = (n: string) => hijo<SVGGElement>(lienzo, `[data-p="${n}"]`);
  const mundo = parte("mundo");
  const fondoG = parte("fondo");
  const E = parte("escenas");
  const actores = parte("actores");
  const frente = parte("frente");
  const flash = parte("flash");
  const velo = parte("velo");

  /* Luces desenfocadas del fondo, con paralaje */
  for (const b of [[80, 90, 70, "a"], [330, 60, 50, "b"], [560, 120, 80, "a"], [820, 70, 60, "b"], [1060, 110, 70, "a"], [1300, 60, 55, "b"]] as const) {
    nodo(fondoG, `<circle cx="${b[0]}" cy="${b[1]}" r="${b[2]}" fill="var(--e-st-bokeh-${b[3]})" filter="url(#fo-bokeh)"/>`);
  }

  /* Camioneta */
  const vanG = nodo(
    actores,
    '<ellipse cx="80" cy="1" rx="86" ry="6" fill="var(--e-st-shadow)" style="opacity:var(--e-st-shadow-op)" filter="url(#fo-difuso)"/>' +
      '<g class="lineas" opacity="0"><rect x="-58" y="-70" width="40" height="3" rx="1.5" fill="var(--e-muted)" opacity=".5"/><rect x="-44" y="-50" width="30" height="3" rx="1.5" fill="var(--e-muted)" opacity=".4"/><rect x="-66" y="-32" width="46" height="3" rx="1.5" fill="var(--e-muted)" opacity=".35"/></g>' +
      '<g class="carro">' +
      '<path d="M0 -26 V-80 Q0 -90 10 -90 H104 Q116 -90 124 -80 L150 -52 Q159 -47 159 -37 V-25 Q159 -17 151 -17 H8 Q0 -17 0 -26 Z" fill="var(--e-van)"/>' +
      '<path d="M0 -40 H159 V-25 Q159 -17 151 -17 H8 Q0 -17 0 -26 Z" fill="var(--e-van-sombra)" opacity=".7"/>' +
      `<rect x="0" y="-44" width="159" height="5" fill="${MARCA}"/>` +
      '<path d="M111 -82 Q117 -82 121 -76 L142 -52 H111 Z" fill="var(--e-vidrio)"/>' +
      '<path d="M111 -82 Q117 -82 121 -76 L128 -68 L111 -58 Z" fill="#FFFFFF" opacity=".35"/>' +
      `<g class="chofer"><circle cx="126" cy="-60" r="7.5" fill="#C98E6A"/><path d="M118 -63 Q126 -74 134 -63 Z" fill="${MARCA}"/></g>` +
      logoEmpresa(24, -66, 11, { tam: 16, color: "#0B1114" }) +
      '<circle cx="155" cy="-40" r="10" fill="#FFD98A" opacity=".25"/><rect x="152" y="-44" width="6" height="8" rx="2" fill="#FFD98A"/>' +
      '<g class="puertaVan"><rect x="-1" y="-86" width="6" height="66" rx="2" fill="var(--e-van-sombra)"/></g>' +
      "</g>" +
      '<g class="rueda" data-cx="34"><circle r="13.5" fill="#1C262B"/><circle r="6.5" fill="#C6D6D8"/><path d="M-6 0H6M0 -6V6" stroke="#1C262B" stroke-width="2"/></g>' +
      '<g class="rueda" data-cx="124"><circle r="13.5" fill="#1C262B"/><circle r="6.5" fill="#C6D6D8"/><path d="M-6 0H6M0 -6V6" stroke="#1C262B" stroke-width="2"/></g>' +
      '<g class="humo"></g>'
  );
  const ruedas = Array.from(vanG.querySelectorAll<SVGGElement>(".rueda"));
  const carroG = hijo(vanG, ".carro");
  const lineasG = hijo(vanG, ".lineas");
  const choferG = hijo(vanG, ".chofer");
  const puertaVan = hijo(vanG, ".puertaVan");
  const humoG = hijo(vanG, ".humo");
  const humos = Array.from({ length: 6 }, () => nodo(humoG, '<circle r="6" fill="var(--e-muted)" opacity=".35"/>', { opacity: "0" }));

  const CX = 1600;
  const van = { x: CX + 430, y: 290, op: 1, sx: 1, sy: 1, rot: 0, puerta: 0, lineas: 0, chofer: 0 };

  /* 1 · Pedidos: notificaciones que salen del teléfono */
  const TARJ: [string, string][] = [
    ["Mercado Libre", "#FFE600"],
    ["Shopify", "#95BF47"],
    ["Tu tienda", "#00B89A"],
  ];
  const tarjetas = TARJ.map(([nombre, color]) =>
    nodo(
      E,
      '<g filter="url(#fo-elevar)"><rect width="196" height="46" rx="12" fill="var(--e-panel)" stroke="var(--e-panel-line)"/></g>' +
        `<circle cx="24" cy="23" r="12" fill="${color}" opacity=".22"/><path d="M17 19 L19 14 H29 L31 19 Z M18 20 H30 V30 H18 Z" fill="${color}"/>` +
        `<text x="46" y="21" font-size="14.5" font-weight="700" fill="var(--e-fg)">${nombre}</text>` +
        '<text x="46" y="36" font-size="11.5" fill="var(--e-muted)">Nuevo pedido</text>' +
        '<circle cx="180" cy="23" r="4" fill="var(--e-accent)"/>'
    )
  );
  const pildora = nodo(
    E,
    '<g filter="url(#fo-elevar)"><rect width="196" height="52" rx="26" fill="var(--e-fg)"/></g>' +
      '<text class="mono" x="24" y="34" font-size="22" font-weight="600" fill="var(--e-bg)"><tspan data-p="cntA">0</tspan></text>' +
      '<text x="72" y="32" font-size="13.5" font-weight="600" fill="var(--e-bg)" opacity=".8">pedidos hoy</text>'
  );
  const puntitos = Array.from({ length: 8 }, () => nodo(E, '<circle r="4" fill="var(--e-accent)"/>', { opacity: "0" }));

  /* 2 · Retiro */
  const BX = 800;
  const cajasB = [caja(E, 46, 36, BX + 445, 254), caja(E, 46, 36, BX + 420, 290), caja(E, 46, 36, BX + 470, 290)];
  const DEST_B = [
    { x: BX + 222, y: 290 },
    { x: BX + 222, y: 254 },
    { x: BX + 222, y: 218 },
  ];
  const haz = nodo(E, '<polygon points="0,0 0,0 0,0" fill="url(#fo-haz)"/>', { opacity: "0" });
  const hazPoly = haz.firstChild as SVGPolygonElement;
  const vistos = cajasB.map(() =>
    nodo(
      E,
      '<circle r="10" fill="var(--e-accent)"/><path d="M-4.5 0 L-1.2 3.4 L5 -3.4" fill="none" stroke="#04231E" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
      { opacity: "0" }
    )
  );

  /* 3 · Asignación y carga */
  const PUESTOS = [
    { x: CX + 180, n: "Rosa", c: "#E3A93A", fin: 11 },
    { x: CX + 262, n: "Diego", c: "#2F8FD0", fin: 10 },
    { x: CX + 344, n: "Camila", c: MARCA, fin: 11 },
  ];
  const etiquetas = PUESTOS.map((pu, i) => {
    const g = nodo(
      E,
      '<g filter="url(#fo-elevar)"><rect class="marcoEt" x="-38" width="76" height="46" rx="10" fill="var(--e-panel)" stroke="var(--e-panel-line)" stroke-width="1.5"/></g>' +
        `<circle cx="-22" cy="16" r="8" fill="${pu.c}"/><circle cx="-22" cy="13.5" r="3.4" fill="#FFFFFF" opacity=".9"/><path d="M-27.5 21 Q-22 15.5 -16.5 21 Z" fill="#FFFFFF" opacity=".9"/>` +
        `<text x="-9" y="20" font-size="12.5" font-weight="700" fill="var(--e-fg)">${pu.n}</text>` +
        `<text class="mono" data-p="nC${i}" x="-30" y="37" font-size="11.5" font-weight="600" fill="var(--e-muted)">0</text>` +
        `<rect x="-38" y="44" width="76" height="2" rx="1" fill="${pu.c}"/>`
    );
    gsap.set(g, { x: pu.x, y: 160, opacity: 0 });
    nodo(E, `<ellipse cx="${pu.x}" cy="291" rx="30" ry="4" fill="${pu.c}" opacity=".22"/>`);
    return g;
  });
  const pila = (
    [
      [CX + 242, 290],
      [CX + 282, 290],
      [CX + 262, 258],
      [CX + 222, 290],
      [CX + 302, 290],
      [CX + 262, 226],
    ] as const
  ).map(([x, y]) => caja(E, 38, 30, x, y));

  /* 4 · Ruta */
  let rayas = "";
  for (let x = 1900; x < 4100; x += 74) rayas += `<rect x="${x}" y="318" width="34" height="4" rx="2" fill="var(--e-st-horizon)"/>`;
  parte("rayas").innerHTML = rayas;

  /* 5 · Entrega: una puerta sola */
  const DX = 3600;
  nodo(
    E,
    `<rect x="${DX + 396}" y="186" width="68" height="104" rx="3" fill="var(--e-marco)"/>` +
      `<rect x="${DX + 404}" y="194" width="52" height="96" fill="#0B1114" opacity=".85"/>`
  );
  const casaInterior = nodo(E, "");
  const puerta = nodo(
    E,
    `<rect x="${DX + 404}" y="194" width="52" height="96" fill="var(--e-puerta)"/><rect x="${DX + 410}" y="202" width="40" height="36" rx="2" fill="#000" opacity=".1"/><circle cx="${DX + 447}" cy="244" r="2.8" fill="#F1F6F6"/>`
  );
  nodo(
    E,
    `<rect x="${DX + 472}" y="214" width="26" height="15" rx="2" fill="var(--e-panel)" stroke="var(--e-panel-line)"/><text class="mono" x="${DX + 485}" y="225" font-size="9.5" font-weight="600" fill="var(--e-fg)" text-anchor="middle">142</text>` +
      `<ellipse cx="${DX + 430}" cy="292" rx="40" ry="5" fill="var(--e-kraft-osc)" opacity=".5"/>` +
      `<rect x="${DX + 480}" y="270" width="20" height="20" rx="3" fill="var(--e-kraft-osc)"/><ellipse cx="${DX + 485}" cy="262" rx="6" ry="11" fill="var(--e-hoja)"/><ellipse cx="${DX + 496}" cy="259" rx="6" ry="13" fill="var(--e-hoja)"/>`
  );
  const toc = nodo(E, '<path d="M0 -8 Q6 0 0 8 M7 -12 Q15 0 7 12" fill="none" stroke="var(--e-muted)" stroke-width="2" stroke-linecap="round"/>', {
    opacity: "0",
  });
  gsap.set(toc, { x: DX + 394, y: 232 });

  /* Actores */
  const camila = persona(actores, {
    polera: MARCA,
    poleraOsc: MARCA_OSC,
    piel: "#C98E6A",
    pielOsc: "#B27A57",
    pantalon: "#3E5A66",
    pantalonOsc: "#304953",
    pelo: "#2B1D16",
    estilo: "gorra",
    marca: true,
  });
  const clienta = persona(casaInterior, {
    polera: "#E3A93A",
    poleraOsc: "#C58D24",
    piel: "#8D5A3F",
    pielOsc: "#784A32",
    pantalon: "#4B5563",
    pantalonOsc: "#3A4250",
    pelo: "#1A1412",
    estilo: "rizos",
  });
  const cajaVuela = caja(frente, 30, 24, 0, 0);
  gsap.set(cajaVuela.el, { opacity: 0 });

  const sello = nodo(
    frente,
    '<circle class="onda" r="36" fill="none" stroke="var(--e-accent)" stroke-width="3" opacity="0"/>' +
      '<g class="nucleo"><circle r="34" fill="var(--e-accent-deep)" stroke="var(--e-accent)" stroke-width="3"/>' +
      '<path class="check" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" d="M-14 1 L-4 11 L15 -9" fill="none" stroke="var(--e-accent-text)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>' +
      '<g class="rotulo" opacity="0"><g filter="url(#fo-elevar)"><rect x="-56" y="46" width="112" height="30" rx="15" fill="var(--e-fg)"/></g><text y="66" font-size="14.5" font-weight="700" fill="var(--e-bg)" text-anchor="middle">Entregado</text></g>',
    { transform: `translate(${DX + 250} 96)` }
  );
  const nucleo = hijo(sello, ".nucleo");
  const onda = hijo<SVGCircleElement>(sello, ".onda");

  /* ═══════════════ El teléfono con la app ═══════════════
   * Pantalla de 138 × 288 dentro de un aparato de 150 × 300. Cada pantalla es un
   * grupo con su propio fondo, así un fundido entre dos nunca deja ver la de abajo.
   */
  const barraApp = (titulo: string, chip?: { texto: string; color: string; ancho: number }) =>
    '<rect width="138" height="288" fill="var(--e-panel)"/>' +
    '<rect x="112" y="7" width="14" height="6" rx="1.5" fill="none" stroke="var(--e-fg)" stroke-width="1"/><rect x="113.5" y="8.5" width="9" height="3" rx=".5" fill="var(--e-fg)"/>' +
    '<rect x="96" y="9" width="2.5" height="4" fill="var(--e-fg)"/><rect x="100" y="7.5" width="2.5" height="5.5" fill="var(--e-fg)"/><rect x="104" y="6" width="2.5" height="7" fill="var(--e-fg)"/>' +
    '<rect x="12" y="25" width="9" height="3" fill="var(--e-fg)"/><rect x="15.5" y="30" width="9" height="3" fill="var(--e-accent)"/>' +
    `<text x="30" y="34" font-size="13" font-weight="700" fill="var(--e-fg)">${titulo}</text>` +
    (chip
      ? `<rect x="${126 - chip.ancho}" y="24" width="${chip.ancho}" height="14" rx="7" fill="${chip.color}" opacity=".16"/>` +
        `<text x="${126 - chip.ancho / 2}" y="34" font-size="8.5" font-weight="700" fill="${chip.color}" text-anchor="middle">${chip.texto}</text>`
      : "") +
    '<rect y="44" width="138" height="1" fill="var(--e-panel-line)"/>';
  const visto = (cx: number, cy: number, r: number) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="var(--e-accent)"/><path d="M${cx - r * 0.45} ${cy} L${cx - r * 0.1} ${cy + r * 0.35} L${cx + r * 0.5} ${cy - r * 0.35}" fill="none" stroke="#04231E" stroke-width="${r * 0.28}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const esquinas = (x0: number, y0: number, x1: number, y1: number) =>
    `<path d="M${x0} ${y0 + 10} V${y0} H${x0 + 10} M${x1 - 10} ${y0} H${x1} V${y0 + 10} M${x1} ${y1 - 10} V${y1} H${x1 - 10} M${x0 + 10} ${y1} H${x0} V${y1 - 10}" fill="none" stroke="var(--e-accent)" stroke-width="2.2" stroke-linecap="round"/>`;
  let qr = "";
  for (let f = 0; f < 5; f++) for (let c = 0; c < 5; c++) if ((f * 7 + c * 3 + f * c) % 3 !== 1 || (f < 2 && c < 2)) qr += `<rect x="${56 + c * 5}" y="${74 + f * 5}" width="4.4" height="4.4" fill="#0B1114"/>`;

  // Retiro: el visor escaneando la etiqueta y la lista que se llena
  const pantRetiro =
    barraApp("Retiro", { texto: "Bodega", color: "var(--e-accent-text)", ancho: 42 }) +
    '<rect x="10" y="54" width="118" height="84" rx="10" fill="#0E1417"/>' +
    `<rect x="46" y="66" width="46" height="60" rx="3" fill="#F4F1EA"/>${qr}<rect x="52" y="104" width="34" height="3" rx="1.5" fill="#0B1114" opacity=".5"/><rect x="52" y="110" width="24" height="3" rx="1.5" fill="#0B1114" opacity=".35"/>` +
    esquinas(38, 60, 100, 132) +
    '<rect data-p="scanTel" x="40" y="62" width="58" height="2" rx="1" fill="var(--e-accent)"/>' +
    '<rect data-p="flashTel" x="10" y="54" width="118" height="84" rx="10" fill="#FFFFFF" opacity="0"/>' +
    '<text x="10" y="157" font-size="9.5" fill="var(--e-muted)">Escaneados</text>' +
    '<text class="mono" x="10" y="182" font-size="24" font-weight="600" fill="var(--e-fg)"><tspan data-p="cntB">0</tspan><tspan font-size="12" fill="var(--e-muted)" font-weight="500"> / 32</tspan></text>' +
    '<rect x="10" y="190" width="118" height="6" rx="3" fill="var(--e-bar)"/><rect data-p="barB" x="10" y="190" width="0" height="6" rx="3" fill="var(--e-accent)"/>' +
    [206, 226, 246]
      .map(
        (y) =>
          `<g class="filaTel" opacity="0"><rect x="10" y="${y - 9}" width="13" height="11" rx="1.5" fill="var(--e-kraft)"/><rect x="15.5" y="${y - 9}" width="2" height="11" fill="var(--e-tape)"/>` +
          `<text x="30" y="${y}" font-size="10" font-weight="600" fill="var(--e-fg)">Paquete</text>${visto(122, y - 3.5, 6)}</g>`
      )
      .join("") +
    '<g data-p="listoB" opacity="0"><rect x="10" y="260" width="118" height="20" rx="10" fill="var(--e-accent-deep)"/>' +
    '<text x="69" y="273.5" font-size="9.5" font-weight="700" fill="var(--e-accent-text)" text-anchor="middle">Retiro completo</text></g>';

  // Su día: lo que le tocó, por comuna
  const ZONAS: [string, number][] = [
    ["Ñuñoa", 3],
    ["Providencia", 4],
    ["Las Condes", 4],
  ];
  const pantDia =
    barraApp("Mi día", { texto: "Hoy", color: "var(--e-accent-text)", ancho: 30 }) +
    '<text class="mono" x="10" y="94" font-size="36" font-weight="600" fill="var(--e-fg)">11</text>' +
    '<text x="10" y="112" font-size="10" fill="var(--e-muted)">pedidos asignados</text>' +
    ZONAS.map(
      ([z, n], i) =>
        `<g class="zonaTel" opacity="0"><text x="10" y="${142 + i * 28}" font-size="11" font-weight="600" fill="var(--e-fg)">${z}</text>` +
        `<text class="mono" x="128" y="${142 + i * 28}" font-size="11" font-weight="600" fill="var(--e-muted)" text-anchor="end">${n}</text>` +
        `<rect x="10" y="${148 + i * 28}" width="118" height="4" rx="2" fill="var(--e-bar)"/><rect x="10" y="${148 + i * 28}" width="${(118 * n) / 4}" height="4" rx="2" fill="${MARCA}" opacity=".8"/></g>`
    ).join("") +
    '<g data-p="btnIniciar"><rect x="10" y="240" width="118" height="32" rx="9" fill="var(--e-accent)"/>' +
    '<text x="69" y="260" font-size="11.5" font-weight="700" fill="#04231E" text-anchor="middle">Iniciar ruta</text></g>';

  // La ruta: mapa con el recorrido ordenado y la siguiente parada
  const RUTA_TEL = "M16 168 L16 136 L52 136 L52 100 L96 100 L96 68 L122 68";
  const PARADAS_TEL: [number, number, number][] = [
    [34, 136, 0.243],
    [52, 112, 0.447],
    [80, 100, 0.641],
    [96, 78, 0.825],
    [122, 68, 1],
  ];
  const pantRuta =
    barraApp("Mi ruta", { texto: "En ruta", color: "var(--e-pro)", ancho: 40 }) +
    '<rect x="8" y="52" width="122" height="130" rx="10" fill="var(--e-st-bg)" stroke="var(--e-panel-line)"/>' +
    '<path d="M16 52 V182 M52 52 V182 M96 52 V182 M8 68 H130 M8 100 H130 M8 136 H130 M8 168 H130" stroke="var(--e-panel-line)" stroke-width="5" fill="none"/>' +
    `<path d="${RUTA_TEL}" fill="none" stroke="var(--e-pro)" stroke-width="3" stroke-dasharray="2 5" stroke-linecap="round" opacity=".45"/>` +
    `<path data-p="rutaTel" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" d="${RUTA_TEL}" fill="none" stroke="var(--e-pro)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    PARADAS_TEL.map(
      ([x, y], i) =>
        `<circle cx="${x}" cy="${y}" r="7" fill="var(--e-panel)" stroke="var(--e-pro)" stroke-width="2"/>` +
        `<text class="mono" x="${x}" y="${y + 2.8}" font-size="7.5" font-weight="700" fill="var(--e-pro)" text-anchor="middle">${i + 1}</text>` +
        `<g class="paradaOk" opacity="0">${visto(x, y, 7.4)}</g>`
    ).join("") +
    // Una casita junto a la última parada: la ruta termina cerca de donde termina el día del
    // conductor. Sin texto, a propósito (decisión del usuario, 2026-09-28).
    '<g transform="translate(112 88)"><path d="M0 5.5 L6.5 0 L13 5.5 V13 H0 Z" fill="var(--e-panel)" stroke="var(--e-fg)" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<rect x="5" y="8" width="3" height="5" fill="var(--e-fg)"/></g>' +
    '<g data-p="vanTel"><circle r="7" fill="var(--e-fg)" opacity=".15"/><circle r="4.5" fill="var(--e-fg)"/></g>' +
    '<rect x="8" y="192" width="122" height="46" rx="10" fill="var(--e-st-bg)"/>' +
    '<text x="16" y="207" font-size="8.5" fill="var(--e-muted)">Siguiente parada</text>' +
    '<text data-p="sigTel" x="16" y="226" font-size="12" font-weight="700" fill="var(--e-fg)">Parada 1 de 5</text>' +
    '<text class="mono" x="122" y="207" font-size="8.5" font-weight="600" fill="var(--e-muted)" text-anchor="end">4 min</text>' +
    '<text data-p="progTel" x="10" y="258" font-size="10" fill="var(--e-muted)">0 de 5 entregadas</text>' +
    '<rect x="10" y="266" width="118" height="5" rx="2.5" fill="var(--e-bar)"/><rect data-p="progBar" x="10" y="266" width="0" height="5" rx="2.5" fill="var(--e-accent)"/>';

  // La entrega: la foto, y la evidencia que queda registrada
  const pantEntrega =
    barraApp("Entrega", { texto: "5 de 5", color: "var(--e-accent-text)", ancho: 36 }) +
    '<rect x="8" y="54" width="122" height="118" rx="10" fill="#0E1417"/>' +
    '<rect x="50" y="72" width="38" height="84" rx="2" fill="#2A3D44"/><rect x="54" y="76" width="30" height="80" fill="var(--e-puerta)"/><circle cx="79" cy="118" r="1.8" fill="#F1F6F6"/>' +
    '<rect x="58" y="140" width="22" height="16" rx="2" fill="var(--e-kraft)"/><rect x="67.5" y="140" width="3" height="16" fill="var(--e-tape)"/>' +
    esquinas(18, 62, 120, 164) +
    '<rect data-p="flashFoto" x="8" y="54" width="122" height="118" rx="10" fill="#FFFFFF" opacity="0"/>' +
    `<g data-p="fotoOk" opacity="0">${visto(116, 68, 9)}</g>` +
    '<g data-p="ubicTel" opacity="0"><path d="M16 196 C11 190 11 183 16 183 C21 183 21 190 16 196 Z" fill="var(--e-accent)"/><circle cx="16" cy="187.5" r="1.8" fill="var(--e-panel)"/>' +
    '<text x="28" y="192" font-size="10" font-weight="600" fill="var(--e-fg)">Ubicación registrada</text></g>' +
    '<g data-p="horaTel" opacity="0"><circle cx="16" cy="211" r="6" fill="none" stroke="var(--e-accent)" stroke-width="1.8"/><path d="M16 208 V211 H18.5" fill="none" stroke="var(--e-accent)" stroke-width="1.6" stroke-linecap="round"/>' +
    '<text class="mono" x="28" y="214.5" font-size="10" font-weight="600" fill="var(--e-fg)">16:42</text></g>' +
    '<g data-p="btnFoto"><rect x="10" y="240" width="118" height="32" rx="9" fill="none" stroke="var(--e-accent)" stroke-width="1.6"/>' +
    '<text x="69" y="260" font-size="11.5" font-weight="700" fill="var(--e-accent-text)" text-anchor="middle">Tomar foto</text></g>' +
    '<g data-p="btnOk" opacity="0"><rect x="10" y="240" width="118" height="32" rx="9" fill="var(--e-accent)"/>' +
    '<text x="69" y="260" font-size="11.5" font-weight="700" fill="#04231E" text-anchor="middle">Entregado</text></g>';

  const telG = nodo(
    parte("hud"),
    '<g filter="url(#fo-elevar)"><rect width="150" height="300" rx="26" fill="#0B1114"/></g>' +
      '<rect x="1.5" y="1.5" width="147" height="297" rx="24.5" fill="none" stroke="#2A3A41" stroke-width="1"/>' +
      '<g clip-path="url(#fo-pantalla)"><g transform="translate(6 6)">' +
      `<g data-pant="retiro">${pantRetiro}</g><g data-pant="dia">${pantDia}</g><g data-pant="ruta">${pantRuta}</g><g data-pant="entrega">${pantEntrega}</g>` +
      "</g></g>" +
      '<rect x="56" y="11" width="38" height="9" rx="4.5" fill="#0B1114"/>',
    { opacity: "0" }
  );
  const pantalla = (n: string) => hijo<SVGGElement>(telG, `[data-pant="${n}"]`);
  const pRetiro = pantalla("retiro");
  const pDia = pantalla("dia");
  const pRuta = pantalla("ruta");
  const pEntrega = pantalla("entrega");
  gsap.set([pRetiro, pDia, pRuta, pEntrega], { opacity: 0 });
  const rutaTel = hijo<SVGPathElement>(telG, '[data-p="rutaTel"]');
  const largoRuta = rutaTel.getTotalLength();
  const vanTel = hijo(telG, '[data-p="vanTel"]');
  const tel = { op: 0, dy: 26 };
  let angosto = false;
  function pintarTel() {
    // En el lienzo cuadrado del teléfono el aparato va más chico y más al borde.
    const [x, y, e] = angosto ? [368, 40, 0.86] : [474, 30, 1];
    telG.setAttribute("transform", `translate(${x} ${fx(y + tel.dy)}) scale(${e})`);
    telG.setAttribute("opacity", fx(tel.op));
  }

  /* Cámara */
  const cam = { x: 320, y: 188, z: 1, sigue: 0, tel: 0 };
  let zBase = 1.12;
  const hazEstado = { op: 0, obj: 0 };

  function pintarVan() {
    vanG.setAttribute("transform", `translate(${fx(van.x)} ${fx(van.y)})`);
    vanG.setAttribute("opacity", fx(van.op));
    carroG.setAttribute("transform", `translate(80 -17) rotate(${fx(van.rot)}) scale(${fx(van.sx)} ${fx(van.sy)}) translate(-80 17)`);
    const giro = ((van.x / (2 * Math.PI * 13.5)) * 360) % 360;
    ruedas.forEach((r) => r.setAttribute("transform", `translate(${r.dataset.cx} -13.5) rotate(${fx(giro)})`));
    puertaVan.setAttribute("transform", `rotate(${fx(-van.puerta)} 2 -86)`);
    lineasG.setAttribute("opacity", fx(van.lineas));
    choferG.setAttribute("opacity", fx(van.chofer));
  }
  function pintarHaz() {
    haz.setAttribute("opacity", fx(hazEstado.op));
    if (hazEstado.op <= 0) return;
    const m = mano(camila);
    const c = cajasB[hazEstado.obj];
    const bx = Number(gsap.getProperty(c.el, "x"));
    const by = Number(gsap.getProperty(c.el, "y"));
    hazPoly.setAttribute("points", `${fx(m.x + 4)},${fx(m.y + 2)} ${fx(bx - c.w / 2)},${fx(by - c.h)} ${fx(bx - c.w / 2)},${fx(by)}`);
  }
  function pintarCamara() {
    const cx = cam.x * (1 - cam.sigue) + (van.x + (angosto ? 92 : 118)) * cam.sigue;
    // Con el teléfono a la vista, la acción se corre a la izquierda y, en el lienzo cuadrado, se aleja un poco.
    // En el cuadrado, además, la escena baja para que el piso quede abajo y no sobre cielo vacío.
    const [focoTel, zTel, bajaTel] = angosto ? [236, 0.8, 58] : [240, 1, 0];
    const foco = 320 + (focoTel - 320) * cam.tel;
    const esc = cam.z * zBase * (1 + (zTel - 1) * cam.tel);
    mundo.setAttribute("transform", `translate(${fx(foco)} ${fx(188 + bajaTel * cam.tel)}) scale(${fx(esc)}) translate(${fx(-cx)} ${fx(-cam.y)})`);
    fondoG.setAttribute("transform", `translate(${fx(-(cx * 0.07) % 260)} 0)`);
  }
  const t0 = performance.now();
  function pintarTodo() {
    const t = (performance.now() - t0) / 1000;
    pintarPersona(camila, t);
    pintarPersona(clienta, t);
    pintarVan();
    pintarCamara();
    pintarHaz();
    pintarTel();
  }

  /* Estado inicial */
  Object.assign(camila, { x: 224, shF: -38, elF: -92, telOp: 1, cabeza: 9, shB: 4 });
  Object.assign(clienta, { x: DX + 442, y: 290, dir: -1, op: 0 });
  tarjetas.forEach((g) => gsap.set(g, { x: 254, y: 176, scale: 0.2, opacity: 0, transformOrigin: "0% 50%" }));
  gsap.set(pildora, { x: 288, y: 232, opacity: 0, scale: 0.8, transformOrigin: "50% 50%" });
  gsap.set(nucleo, { scale: 0, transformOrigin: "50% 50%" });

  /* ═══════════════ Guion ═══════════════ */
  const tl = gsap.timeline({ repeat: -1, paused: true, defaults: { ease: "power2.inOut" } });

  function caminar(r: Rig, x1: number, t: number, d: number, ritmo = 1.5) {
    tl.to(r, { x: x1, duration: d, ease: "power1.inOut" }, t);
    tl.to(r, { fase: `+=${Math.PI * 2 * d * ritmo}`, duration: d, ease: "none" }, t);
    tl.to(r, { amp: 1, duration: 0.3, ease: "power1.out" }, t);
    tl.to(r, { amp: 0, duration: 0.34, ease: "power1.in" }, t + d - 0.34);
  }
  /** Salto con anticipación, estiramiento y aterrizaje elástico. */
  function salto(c: Caja, x1: number, y1: number, t: number, d: number, alto: number) {
    tl.to(c.sq, { scaleY: 0.8, scaleX: 1.14, duration: 0.13, ease: "power2.out" }, t);
    tl.to(c.sq, { scaleY: 1.12, scaleX: 0.9, rotation: -8, duration: 0.14, ease: "power2.out" }, t + 0.13);
    tl.to(c.el, { x: x1, duration: d, ease: "power1.inOut" }, t + 0.13);
    tl.to(
      c.el,
      {
        keyframes: [
          { y: `-=${alto}`, duration: d * 0.5, ease: "power2.out" },
          { y: y1, duration: d * 0.5, ease: "power2.in" },
        ],
      },
      t + 0.13
    );
    tl.to(c.sq, { rotation: 0, duration: d * 0.8, ease: "power1.inOut" }, t + 0.27);
    tl.to(c.sq, { scaleY: 0.74, scaleX: 1.2, duration: 0.07, ease: "power2.in" }, t + 0.13 + d - 0.03);
    tl.to(c.sq, { scaleY: 1, scaleX: 1, duration: 0.5, ease: "elastic.out(1,.42)" }, t + 0.13 + d + 0.04);
  }
  function pop(el: Element, t: number, esc = 0.6) {
    tl.fromTo(el, { opacity: 0, scale: esc, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.8)" }, t);
  }
  function contador(nombre: string, hasta: number, t: number, d: number, fmt?: (v: number) => string) {
    const o = { v: 0 };
    const el = parte(nombre);
    tl.to(o, { v: hasta, duration: d, ease: "power1.inOut", onUpdate: () => void (el.textContent = fmt ? fmt(o.v) : String(Math.round(o.v))) }, t);
  }
  function humo(t: number, n: number) {
    for (let i = 0; i < n; i++) {
      tl.fromTo(
        humos[i % humos.length],
        { opacity: 0.55, x: -4, y: -22, scale: 0.4, transformOrigin: "50% 50%" },
        { opacity: 0, x: -24 - i * 6, y: -30 - i * 3, scale: 1.6, duration: 0.7, ease: "power1.out", immediateRender: false },
        t + i * 0.12
      );
    }
  }

  /* 1 · Pedidos (0 – 4.9) */
  tl.to(cam, { z: 1.05, duration: 4.6, ease: "sine.inOut" }, 0);
  const ALTURAS = [62, 116, 170];
  tarjetas.forEach((g, k) => {
    const t = 0.45 + k * 0.62;
    tl.to(camila, { elF: -104, duration: 0.12, ease: "power1.out" }, t - 0.12).to(camila, { elF: -92, duration: 0.3, ease: "power2.out" }, t);
    tl.to(g, { x: 288, y: ALTURAS[k], scale: 1, opacity: 1, duration: 0.7, ease: "back.out(1.5)" }, t);
  });
  tl.to(camila, { cabeza: -6, duration: 0.45, ease: "power2.out" }, 1.9);
  puntitos.forEach((pt, i) => {
    const t = 2.35 + i * 0.11;
    tl.fromTo(pt, { opacity: 0, x: 254, y: 176 }, { opacity: 1, x: 380 + (i % 3) * 14, y: 246, duration: 0.42, ease: "power2.in" }, t);
    tl.to(pt, { opacity: 0, duration: 0.1 }, t + 0.4);
  });
  pop(pildora, 2.35, 0.7);
  contador("cntA", 32, 2.45, 1.35);
  tl.to(
    camila,
    {
      keyframes: [
        { cabeza: 2, duration: 0.18 },
        { cabeza: -6, duration: 0.22 },
        { cabeza: 0, duration: 0.25 },
      ],
      feliz: 1,
      ease: "sine.inOut",
    },
    3.7
  );
  tl.to(camila, { shF: 0, elF: -8, telOp: 0, duration: 0.35 }, 4.35);
  caminar(camila, 560, 4.55, 1.5);
  tl.to(cam, { x: 1120, z: 1, duration: 1.25 }, 4.85);
  tl.set(camila, { x: 740, feliz: 0 }, 6.05);
  caminar(camila, BX + 300, 6.1, 1.45);

  /* 2 · Retiro (4.9 – 11.4) */
  tl.to(camila, { shF: -88, elF: -6, telOp: 1, cabeza: 4, duration: 0.4, ease: "back.out(1.6)" }, 7.55);
  tl.to(cam, { z: 1.07, duration: 3.2, ease: "sine.inOut" }, 7.6);
  cajasB.forEach((c, j) => {
    const ts = 8.1 + j * 0.9;
    const v = vistos[j];
    tl.set(hazEstado, { obj: j }, ts);
    tl.to(hazEstado, { op: 1, duration: 0.1, ease: "none" }, ts).to(hazEstado, { op: 0, duration: 0.22 }, ts + 0.38);
    const vx = Number(gsap.getProperty(c.el, "x"));
    const vy = Number(gsap.getProperty(c.el, "y")) - c.h - 14;
    tl.fromTo(v, { opacity: 0, scale: 0.3, x: vx, y: vy, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2.6)" }, ts + 0.12);
    tl.to(v, { opacity: 0, duration: 0.15 }, ts + 0.46);
    salto(c, DEST_B[j].x, DEST_B[j].y, ts + 0.42, 0.55, 80);
  });
  contador("cntB", 32, 8.1, 2.6);
  const barra = { v: 0 };
  const barB = parte("barB");
  tl.to(barra, { v: 1, duration: 2.6, ease: "power1.inOut", onUpdate: () => barB.setAttribute("width", fx(118 * barra.v)) }, 8.1);
  pop(parte("listoB"), 10.75, 0.4);
  tl.to(camila, { shF: 0, elF: -8, telOp: 0, cabeza: 0, feliz: 1, duration: 0.35 }, 10.95);
  tl.to(cam, { x: 1920, z: 1, duration: 1.2 }, 11.3);
  tl.set(camila, { op: 0, feliz: 0 }, 11.6);

  /* 3 · Asignación y carga (11.4 – 16.2) */
  etiquetas.forEach((g, i) => tl.to(g, { opacity: 1, y: 150, duration: 0.45, ease: "back.out(1.6)" }, 12.0 + i * 0.12));
  const destino = [0, 1, 2, 0, 1, 2];
  pila.forEach((c, i) => salto(c, PUESTOS[destino[i]].x, 290 - Math.floor(i / 3) * 30, 12.5 + i * 0.26, 0.5, 70));
  PUESTOS.forEach((pu, i) => contador(`nC${i}`, pu.fin, 12.6 + i * 0.1, 1.9));
  tl.to(hijo(etiquetas[2], ".marcoEt"), { attr: { stroke: MARCA }, duration: 0.3 }, 14.35);
  tl.set(camila, { x: CX - 40, op: 1 }, 12.9);
  caminar(camila, CX + 392, 12.9, 1.6);
  tl.to(van, { puerta: 95, duration: 0.45, ease: "back.out(1.4)" }, 14.0);
  [pila[2], pila[5]].forEach((c, k) => {
    const t = 14.55 + k * 0.42;
    tl.to(camila, { shF: -70, elF: -40, duration: 0.16, ease: "power2.out" }, t).to(camila, { shF: -20, elF: -10, duration: 0.24 }, t + 0.16);
    salto(c, van.x + 10, 262, t, 0.42, 46);
    tl.to(c.el, { opacity: 0, duration: 0.12 }, t + 0.6);
  });
  tl.to(van, { puerta: 0, duration: 0.4, ease: "back.out(2.2)" }, 15.5);
  tl.to(
    van,
    {
      keyframes: [
        { sy: 0.96, sx: 1.02, duration: 0.08 },
        { sy: 1, sx: 1, duration: 0.4, ease: "elastic.out(1,.5)" },
      ],
    },
    15.88
  );
  caminar(camila, CX + 520, 15.6, 0.7);
  tl.to(camila, { op: 0, duration: 0.2 }, 16.1);
  tl.to(van, { chofer: 1, duration: 0.2 }, 16.2);

  /* 4 · En ruta (16.2 – 21.4) */
  tl.to(van, { rot: 1.6, sx: 0.97, duration: 0.25, ease: "power2.out" }, 16.3);
  humo(16.35, 5);
  tl.to(van, { x: CX + 660, duration: 1.05, ease: "power2.in" }, 16.45);
  tl.to(van, { rot: 0, sx: 1, duration: 0.5, ease: "elastic.out(1,.5)" }, 16.55);
  tl.to(cam, { sigue: 1, duration: 0.8 }, 16.4);
  tl.to(van, { x: 3400, duration: 2.8, ease: "none" }, 17.5);
  tl.to(van, { lineas: 1, duration: 0.3 }, 17.4).to(van, { lineas: 0, duration: 0.3 }, 20.0);
  tl.to(
    van,
    {
      keyframes: [
        { sy: 0.985, duration: 0.14 },
        { sy: 1, duration: 0.14 },
      ],
      repeat: 9,
      ease: "sine.inOut",
    },
    17.5
  );
  tl.to(van, { x: DX + 128, duration: 1.3, ease: "power2.out" }, 20.3);
  tl.to(
    van,
    {
      keyframes: [
        { rot: -2.2, sx: 1.03, duration: 0.14 },
        { rot: 0, sx: 1, duration: 0.55, ease: "elastic.out(1,.45)" },
      ],
    },
    21.5
  );
  humo(21.55, 3);
  tl.set(cam, { x: DX + 300 }, 20.8);
  tl.to(cam, { sigue: 0, duration: 1 }, 20.9);

  /* 5 · Entregado (21.4 – 29.2) */
  tl.to(van, { chofer: 0, duration: 0.2 }, 21.9);
  tl.set(camila, { x: DX + 296, y: 290, dir: 1, shF: -68, elF: -24, shB: -62, elB: -26, swing: 0, cargaOp: 1, telOp: 0 }, 21.95);
  tl.to(camila, { op: 1, duration: 0.25 }, 21.95);
  caminar(camila, DX + 360, 22.15, 1.0, 1.6);
  tl.to(camila, { shF: -104, elF: -52, duration: 0.22, ease: "power2.out" }, 23.3);
  tl.to(camila, { elF: -30, duration: 0.09, repeat: 3, yoyo: true, ease: "power1.inOut" }, 23.55);
  tl.fromTo(toc, { opacity: 0, scale: 0.6, transformOrigin: "0% 50%" }, { opacity: 1, scale: 1, duration: 0.2 }, 23.58).to(toc, { opacity: 0, duration: 0.2 }, 23.95);
  tl.to(camila, { shF: -68, elF: -24, duration: 0.25 }, 24.0);
  tl.to(cam, { z: 1.14, y: 196, duration: 1.1, ease: "sine.inOut" }, 23.5);
  tl.to(puerta, { scaleX: 0.1, transformOrigin: "0% 50%", duration: 0.55, ease: "back.out(1.1)" }, 24.15);
  tl.to(clienta, { op: 1, duration: 0.3 }, 24.3);
  caminar(clienta, DX + 430, 24.3, 0.5, 1.6);
  tl.to(clienta, { shF: -66, elF: -26, shB: -60, elB: -28, feliz: 1, duration: 0.35 }, 24.85);
  tl.set(camila, { cargaOp: 0 }, 25.15);
  tl.set(cajaVuela.el, { opacity: 1, x: DX + 360 + 24, y: 290 - 65 }, 25.15);
  tl.to(cajaVuela.el, { x: DX + 430 - 24, duration: 0.4 }, 25.15);
  tl.to(
    cajaVuela.el,
    {
      keyframes: [
        { y: 290 - 78, duration: 0.2, ease: "power2.out" },
        { y: 290 - 65, duration: 0.2, ease: "power2.in" },
      ],
    },
    25.15
  );
  tl.set(cajaVuela.el, { opacity: 0 }, 25.55);
  tl.set(clienta, { cargaOp: 1 }, 25.55);
  tl.to(camila, { shB: 0, elB: -8, shF: -112, elF: -24, telOp: 1, duration: 0.4, ease: "back.out(1.5)" }, 25.7);
  tl.to(flash, { opacity: 0.75, duration: 0.05, ease: "none" }, 26.15).to(flash, { opacity: 0, duration: 0.45, ease: "power1.out" }, 26.2);
  tl.to(cam, { z: 1, y: 188, duration: 0.9 }, 26.1);
  tl.to(nucleo, { scale: 1, duration: 0.65, ease: "back.out(2)" }, 26.35);
  tl.fromTo(onda, { opacity: 0.9, attr: { r: 34 } }, { opacity: 0, attr: { r: 70 }, duration: 0.8, ease: "power1.out", immediateRender: false }, 26.45);
  tl.to(hijo(sello, ".check"), { attr: { "stroke-dashoffset": 0 }, duration: 0.35, ease: "power2.out" }, 26.6);
  tl.fromTo(hijo(sello, ".rotulo"), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: "back.out(1.6)" }, 26.75);
  tl.to(camila, { shF: 0, elF: -8, telOp: 0, feliz: 1, duration: 0.4 }, 26.9);
  tl.to(clienta, { shB: -158, elB: -20, duration: 0.3, ease: "power2.out" }, 27.1).to(
    clienta,
    { shB: -138, duration: 0.2, repeat: 3, yoyo: true, ease: "sine.inOut" },
    27.4
  );
  tl.to(velo, { opacity: 1, duration: 0.5, ease: "none" }, 28.7);
  /* ═══ La app en el teléfono, al compás de la escena ═══ */
  const enTel = (sel: string) => hijo(telG, sel);
  const aparece = (el: Element, t: number) =>
    tl.fromTo(el, { opacity: 0, x: 10 }, { opacity: 1, x: 0, duration: 0.35, ease: "power3.out" }, t);
  const toque = (el: Element, t: number) =>
    tl.to(el, { keyframes: [{ scale: 0.93, duration: 0.1 }, { scale: 1, duration: 0.3, ease: "back.out(2)" }], transformOrigin: "50% 50%" }, t);

  // Retiro: el visor escanea, cada caja suma una fila
  tl.set(pRetiro, { opacity: 1 }, 7.2);
  tl.to(cam, { tel: 1, duration: 0.8 }, 7.15);
  tl.to(tel, { op: 1, dy: 0, duration: 0.55, ease: "power3.out" }, 7.3);
  tl.fromTo(enTel('[data-p="scanTel"]'), { y: 0 }, { y: 64, duration: 0.45, repeat: 6, yoyo: true, ease: "sine.inOut", immediateRender: false }, 7.7);
  const filasTel = telG.querySelectorAll(".filaTel");
  cajasB.forEach((_, j) => {
    const ts = 8.1 + j * 0.9;
    tl.fromTo(enTel('[data-p="flashTel"]'), { opacity: 0.8 }, { opacity: 0, duration: 0.3, immediateRender: false }, ts + 0.1);
    aparece(filasTel[j], ts + 0.3);
  });
  tl.to(tel, { op: 0, dy: 26, duration: 0.4, ease: "power2.in" }, 11.05);
  tl.to(cam, { tel: 0, duration: 0.8 }, 11.1);
  tl.set(pRetiro, { opacity: 0 }, 11.5);

  // Su día: le llegan sus pedidos, por comuna
  tl.set(pDia, { opacity: 1 }, 14.1);
  tl.to(cam, { tel: 1, duration: 0.8 }, 14.1);
  tl.to(tel, { op: 1, dy: 0, duration: 0.55, ease: "power3.out" }, 14.2);
  telG.querySelectorAll(".zonaTel").forEach((z, i) => aparece(z, 14.6 + i * 0.18));
  toque(enTel('[data-p="btnIniciar"]'), 16.0);

  // La ruta: se dibuja mientras la camioneta avanza. Termina en la parada 4:
  // la 5 es la que se entrega en la escena siguiente.
  tl.to(pRuta, { opacity: 1, duration: 0.35 }, 16.3);
  tl.set(pDia, { opacity: 0 }, 16.7);
  const sigTel = enTel('[data-p="sigTel"]');
  const progTel = enTel('[data-p="progTel"]');
  const progBar = enTel('[data-p="progBar"]');
  const inicio = rutaTel.getPointAtLength(0);
  vanTel.setAttribute("transform", `translate(${fx(inicio.x)} ${fx(inicio.y)})`);
  const avance = { p: 0 };
  const FIN_RUTA = 0.93;
  tl.to(
    avance,
    {
      p: FIN_RUTA,
      duration: 2.9,
      ease: "none",
      onUpdate: () => {
        rutaTel.setAttribute("stroke-dashoffset", fx(1 - avance.p));
        const pt = rutaTel.getPointAtLength(avance.p * largoRuta);
        vanTel.setAttribute("transform", `translate(${fx(pt.x)} ${fx(pt.y)})`);
        const hechas = PARADAS_TEL.filter(([, , f]) => avance.p >= f - 0.001).length;
        sigTel.textContent = `Parada ${Math.min(5, hechas + 1)} de 5`;
        progTel.textContent = `${hechas} de 5 entregadas`;
        progBar.setAttribute("width", fx((118 * hechas) / 5));
      },
    },
    17.4
  );
  telG.querySelectorAll(".paradaOk").forEach((g, i) => {
    const f = PARADAS_TEL[i][2];
    if (f <= FIN_RUTA) pop(g, 17.4 + (f / FIN_RUTA) * 2.9 - 0.05, 0.5);
  });

  // La entrega: la foto, y la evidencia que queda registrada
  tl.to(pEntrega, { opacity: 1, duration: 0.35 }, 21.8);
  tl.set(pRuta, { opacity: 0 }, 22.2);
  toque(enTel('[data-p="btnFoto"]'), 25.9);
  tl.fromTo(enTel('[data-p="flashFoto"]'), { opacity: 0.95 }, { opacity: 0, duration: 0.5, ease: "power1.out", immediateRender: false }, 26.15);
  pop(enTel('[data-p="fotoOk"]'), 26.35, 0.4);
  aparece(enTel('[data-p="ubicTel"]'), 26.55);
  aparece(enTel('[data-p="horaTel"]'), 26.75);
  tl.to(enTel('[data-p="btnFoto"]'), { opacity: 0, duration: 0.2 }, 27.0);
  pop(enTel('[data-p="btnOk"]'), 27.0, 0.85);

  tl.set({}, {}, 29.2);
  // Al reiniciar, el velo se levanta en vez de cortar.
  tl.eventCallback("onRepeat", () => {
    gsap.fromTo(velo, { opacity: 1 }, { opacity: 0, duration: 0.5, ease: "none" });
  });

  /* ═══════════════ Riel, controles y encuadre ═══════════════ */
  const barras = p.pasos.map((paso) => hijo<HTMLElement>(paso, "[data-barra]"));
  let actual = -1;
  function seccion(t: number) {
    for (let i = LIMITES.length - 2; i >= 0; i--) if (t >= LIMITES[i]) return i;
    return 0;
  }
  function pintarRiel() {
    const t = tl.time();
    const i = seccion(t);
    barras.forEach((b, j) => {
      const f = j < i ? 1 : j > i ? 0 : (t - LIMITES[i]) / (LIMITES[i + 1] - LIMITES[i]);
      b.style.transform = `scaleX(${Math.min(1, f).toFixed(3)})`;
    });
    if (i !== actual) {
      actual = i;
      p.pasos.forEach((paso, j) => paso.toggleAttribute("data-visto", j <= i));
      // textContent reemplaza todo lo que haya dentro, aunque el traductor lo haya envuelto.
      p.titulo.textContent = TEXTOS[i][0];
      p.subtitulo.textContent = TEXTOS[i][1];
    }
  }
  const tick = () => {
    pintarTodo();
    pintarRiel();
  };
  gsap.ticker.add(tick);

  function encuadre() {
    angosto = figura.clientWidth < 560;
    figura.toggleAttribute("data-angosto", angosto);
    zBase = angosto ? 1 : 1.12;
    lienzo.setAttribute("viewBox", angosto ? "140 8 360 360" : "0 0 640 360");
  }
  const ro = new ResizeObserver(encuadre);
  ro.observe(figura);
  encuadre();

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let pausado = reduce;
  let visible = true;
  const sincronizar = () => (pausado || !visible ? tl.pause() : tl.play());
  const pintarBoton = () => {
    p.pausa.setAttribute("aria-label", pausado ? "Reanudar animación" : "Pausar animación");
    p.iconoPausa.innerHTML = pausado ? ICONO_PLAY : ICONO_PAUSA;
  };
  const alPausar = () => {
    pausado = !pausado;
    pintarBoton();
    sincronizar();
  };
  p.pausa.addEventListener("click", alPausar);
  const alSaltar = p.pasos.map((paso, i) => {
    const boton = hijo<HTMLButtonElement>(paso, "button");
    // Con movimiento reducido se muestra el cuadro final de cada paso; si no, se reproduce desde su inicio.
    const fn = () => {
      tl.seek(reduce ? LIMITES[i + 1] - 0.1 : ENTRADAS[i], false);
      tick();
    };
    boton.addEventListener("click", fn);
    return { boton, fn };
  });
  const io = new IntersectionObserver(
    ([e]) => {
      visible = !!e?.isIntersecting;
      sincronizar();
    },
    { threshold: 0.2 }
  );
  io.observe(figura);

  pintarBoton();
  if (reduce) tl.seek(LIMITES[1] - 0.1, false);
  tick();
  sincronizar();

  return () => {
    tl.kill();
    gsap.killTweensOf(velo);
    gsap.ticker.remove(tick);
    ro.disconnect();
    io.disconnect();
    p.pausa.removeEventListener("click", alPausar);
    alSaltar.forEach(({ boton, fn }) => boton.removeEventListener("click", fn));
    lienzo.innerHTML = "";
  };
}
