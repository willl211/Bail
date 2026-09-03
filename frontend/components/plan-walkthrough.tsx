'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

/* =============================================================================
   Plan-parcours — porté de maquette_interface/bail/bail.html

   Une piste de défilement haute donne la course, un conteneur `sticky` retient
   le plan à l'écran, et la caméra du canvas est asservie à la progression.

   Les pièces sont des STATIONS NUMÉROTÉES, parcourues dans l'ordre où un agent
   fait visiter — entrée, séjour, cuisine, chambres, salle de bain. C'est
   l'ordre qui porte le parcours produit, pas une métaphore pièce/fonction :
   rien ne prétend qu'une salle de bain « est » un bail. Chaque station ouvre
   l'écran correspondant.
   ========================================================================== */

const WALL = 0.16; // épaisseur des cloisons, en mètres

const PLAN = {
  w: 11.4,
  h: 6.6,
  rooms: [
    { id: 'sejour', nom: 'Séjour', a: '23 m²', x: 0, y: 0, w: 5.8, h: 4.2 },
    { id: 'ch1', nom: 'Chambre 1', a: '13 m²', x: 5.8, y: 0, w: 3.0, h: 4.2 },
    { id: 'ch2', nom: 'Chambre 2', a: '11 m²', x: 8.8, y: 0, w: 2.6, h: 4.2 },
    { id: 'cuisine', nom: 'Cuisine', a: '10 m²', x: 0, y: 4.2, w: 4.0, h: 2.4 },
    { id: 'entree', nom: 'Entrée', a: '4 m²', x: 4.0, y: 4.2, w: 1.8, h: 2.4 },
    { id: 'sdb', nom: 'Salle de bain', a: '7 m²', x: 5.8, y: 4.2, w: 3.0, h: 2.4 },
    { id: 'balcon', nom: 'Balcon', a: '6 m²', x: 8.8, y: 4.2, w: 2.6, h: 2.4, dehors: true },
  ],
  /* Percements : fenêtres en façade, portes avec leur quart de cercle. */
  ouvertures: [
    { x1: 1.0, y1: 0, x2: 2.6, y2: 0, t: 'win' },
    { x1: 3.4, y1: 0, x2: 5.0, y2: 0, t: 'win' },
    { x1: 6.5, y1: 0, x2: 8.1, y2: 0, t: 'win' },
    { x1: 9.4, y1: 0, x2: 10.8, y2: 0, t: 'win' },
    { x1: 1.0, y1: 6.6, x2: 2.6, y2: 6.6, t: 'win' },
    { x1: 6.4, y1: 6.6, x2: 7.6, y2: 6.6, t: 'win' },
    { x1: 4.4, y1: 6.6, x2: 5.4, y2: 6.6, t: 'door', hx: 4.4, hy: 6.6, r: 1.0, a0: -90, a1: 0 },
    { x1: 4.4, y1: 4.2, x2: 5.4, y2: 4.2, t: 'door', hx: 5.4, hy: 4.2, r: 1.0, a0: 180, a1: 270 },
    { x1: 4.0, y1: 5.0, x2: 4.0, y2: 5.9, t: 'door', hx: 4.0, hy: 5.0, r: 0.9, a0: 90, a1: 180 },
    { x1: 5.8, y1: 5.0, x2: 5.8, y2: 5.9, t: 'door', hx: 5.8, hy: 5.0, r: 0.9, a0: 0, a1: 90 },
    { x1: 5.8, y1: 2.5, x2: 5.8, y2: 3.4, t: 'door', hx: 5.8, hy: 3.4, r: 0.9, a0: 270, a1: 360 },
    { x1: 8.8, y1: 1.0, x2: 8.8, y2: 1.9, t: 'door', hx: 8.8, hy: 1.0, r: 0.9, a0: 90, a1: 180 },
    { x1: 9.6, y1: 4.2, x2: 10.6, y2: 4.2, t: 'door', hx: 9.6, hy: 4.2, r: 1.0, a0: 0, a1: 90 },
  ],
} as const;

interface Station {
  room: string | null;
  n: string;
  t: string;
  s: string;
  d: string;
  k: string[];
  go?: string;
  cta?: string;
}

const STATIONS: Station[] = [
  {
    room: null,
    n: '',
    t: 'Chaque pièce, une étape',
    s: 'Parcours Bail · 6 stations',
    d: 'De l’annonce aux clés. Cliquez une pièce pour ouvrir l’écran correspondant.',
    k: ['Sans agence', 'Dossier vérifié', 'Bail en ligne'],
  },
  {
    room: 'entree',
    n: '01',
    t: 'L’annonce vérifiée',
    s: 'Entrée · station 01',
    d: 'Surface, DPE et diagnostics contrôlés avant la mise en ligne.',
    k: ['Contrôle sous 2 h', 'Cadastre'],
    go: '/recherche',
    cta: 'Ouvrir une annonce',
  },
  {
    room: 'sejour',
    n: '02',
    t: 'Le dossier numérique',
    s: 'Séjour · station 02',
    d: 'Identité, revenus, garant. Déposés une fois, vérifiés sous 24 h.',
    k: ['KYC externe', 'Hébergé en France'],
    go: '/dossier',
    cta: 'Ouvrir un dossier',
  },
  {
    room: 'cuisine',
    n: '03',
    t: 'La candidature',
    s: 'Cuisine · station 03',
    d: 'Un clic depuis votre dossier. Aucune pièce à ressaisir.',
    k: ['Réponse 31 h', 'Taux d’effort'],
    go: '/dossier',
    cta: 'Voir une candidature',
  },
  {
    room: 'ch1',
    n: '04',
    t: 'La visite',
    s: 'Chambre 1 · station 04',
    d: 'Accompagnée ou en visio. Identité vérifiée avant le rendez-vous.',
    k: ['Sur place', 'Visio'],
    go: '/dossier',
    cta: 'Prendre un rendez-vous',
  },
  {
    room: 'ch2',
    n: '05',
    t: 'Le bail',
    s: 'Chambre 2 · station 05',
    d: 'Modèle légal verrouillé, champs injectés, signature électronique.',
    k: ['Champs vérifiés', 'Non modifiable'],
    go: '/dossier',
    cta: 'Ouvrir le bail',
  },
  {
    room: 'sdb',
    n: '06',
    t: 'Les honoraires',
    s: 'Salle de bain · station 06',
    d: 'Annoncés avant de candidater, payés une fois. Moins cher qu’une agence.',
    k: ['8 €/m²', 'Une seule fois'],
    go: '/dossier',
    cta: 'Voir le paiement',
  },
];

const roomById = (id: string | null) =>
  id ? PLAN.rooms.find((room) => room.id === id) ?? null : null;

/** Seules les pièces qui portent une station sont cliquables. */
const stepForRoom = (id: string | null) =>
  id === null ? -1 : STATIONS.findIndex((station) => station.room === id);

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

interface Camera {
  x: number;
  y: number;
  s: number;
}

export function PlanWalkthrough() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runwayRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);

  const camRef = useRef<Camera | null>(null);
  const hoverRef = useRef<string | null>(null);
  const paintRef = useRef<Record<string, string> | null>(null);

  // Sans pilotage au défilement : plan complet fixe puis stations en liste.
  // Réévalué à chaque redimensionnement, pas seulement au montage.
  const [isStatic, setIsStatic] = useState(true);
  const staticRef = useRef(true);

  /* Les couleurs viennent des jetons CSS : le plan suit le thème. */
  const colors = useCallback((force = false) => {
    if (paintRef.current && !force) return paintRef.current;
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string) => cs.getPropertyValue(name).trim();
    paintRef.current = {
      paper: read('--surface-alt'),
      floor: read('--surface'),
      wall: read('--plan-wall'),
      faint: read('--grid-line'),
      ink3: read('--ink-3'),
      ink4: read('--ink-4'),
      accent: read('--accent'),
      wash: read('--accent-tint-strong'),
    };
    return paintRef.current;
  }, []);

  const camFor = useCallback((room: string | null, W: number, H: number): Camera => {
    if (!room) {
      return {
        x: PLAN.w / 2,
        y: PLAN.h / 2,
        s: Math.min(W / (PLAN.w + 2.8), H / (PLAN.h + 2.8)),
      };
    }
    const r = roomById(room)!;
    return {
      x: r.x + r.w / 2,
      y: r.y + r.h / 2,
      s: Math.min(W / (r.w + 1.8), H / (r.h + 1.8)),
    };
  }, []);

  const draw = useCallback(
    (cam: Camera, active: string | null, overview: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const P = colors();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (!W || !H) return;

      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = P.paper;
      ctx.fillRect(0, 0, W, H);

      const s = cam.s;
      const ox = W / 2 - cam.x * s;
      const oy = H / 2 - cam.y * s;
      const X = (v: number) => ox + v * s;
      const Y = (v: number) => oy + v * s;

      /* Trame métrique — le fond de plan. */
      ctx.strokeStyle = P.faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = -4; gx <= PLAN.w + 4; gx++) {
        ctx.moveTo(X(gx), 0);
        ctx.lineTo(X(gx), H);
      }
      for (let gy = -4; gy <= PLAN.h + 4; gy++) {
        ctx.moveTo(0, Y(gy));
        ctx.lineTo(W, Y(gy));
      }
      ctx.stroke();

      /* Maçonnerie pleine, puis sols creusés dedans : les cloisons apparaissent. */
      ctx.fillStyle = P.wall;
      ctx.fillRect(X(-0.12), Y(-0.12), (PLAN.w + 0.24) * s, (PLAN.h + 0.24) * s);
      PLAN.rooms.forEach((r) => {
        ctx.fillStyle = 'dehors' in r && r.dehors ? P.paper : P.floor;
        ctx.fillRect(X(r.x + WALL / 2), Y(r.y + WALL / 2), (r.w - WALL) * s, (r.h - WALL) * s);
      });

      /* Percements : on repose le sol par-dessus la maçonnerie. */
      PLAN.ouvertures.forEach((o) => {
        ctx.fillStyle = P.floor;
        const horiz = o.y1 === o.y2;
        if (horiz) {
          ctx.fillRect(X(o.x1), Y(o.y1 - WALL / 2 - 0.03), (o.x2 - o.x1) * s, (WALL + 0.06) * s);
        } else {
          ctx.fillRect(X(o.x1 - WALL / 2 - 0.03), Y(o.y1), (WALL + 0.06) * s, (o.y2 - o.y1) * s);
        }

        if (o.t === 'win') {
          ctx.strokeStyle = P.ink4;
          ctx.lineWidth = Math.max(1, 0.03 * s);
          ctx.beginPath();
          ctx.moveTo(X(o.x1), Y(o.y1));
          ctx.lineTo(X(o.x2), Y(o.y2));
          ctx.stroke();
        } else if ('hx' in o) {
          ctx.strokeStyle = P.ink4;
          ctx.lineWidth = Math.max(1, 0.022 * s);
          ctx.beginPath();
          ctx.arc(X(o.hx), Y(o.hy), o.r * s, (o.a0 * Math.PI) / 180, (o.a1 * Math.PI) / 180);
          ctx.stroke();
        }
      });

      /* Pièce active : lavis d'accent et liseré. */
      const ra = roomById(active);
      if (ra) {
        ctx.fillStyle = P.wash;
        ctx.fillRect(X(ra.x + WALL / 2), Y(ra.y + WALL / 2), (ra.w - WALL) * s, (ra.h - WALL) * s);
        ctx.strokeStyle = P.accent;
        ctx.lineWidth = Math.max(1.5, 0.035 * s);
        ctx.strokeRect(
          X(ra.x + WALL / 2),
          Y(ra.y + WALL / 2),
          (ra.w - WALL) * s,
          (ra.h - WALL) * s,
        );
      }

      /* Textes en repère écran : taille constante quel que soit le zoom. */
      ctx.textAlign = 'center';
      const sans = getComputedStyle(document.body).fontFamily;
      PLAN.rooms.forEach((r) => {
        const cx = X(r.x + r.w / 2);
        const cy = Y(r.y + r.h / 2);
        if (cx < -70 || cx > W + 70 || cy < -50 || cy > H + 50) return;

        const on = r.id === active;
        const hov = r.id === hoverRef.current;
        const step = stepForRoom(r.id);

        /* Repère de station : le cartouche numéroté d'un plan annoté. */
        if (step > -1) {
          const b = 22;
          const bx = cx - b / 2;
          const by = cy - 34;
          ctx.fillStyle = on ? P.accent : P.floor;
          ctx.fillRect(bx, by, b, b);
          ctx.strokeStyle = P.accent;
          ctx.lineWidth = 1;
          ctx.strokeRect(bx + 0.5, by + 0.5, b - 1, b - 1);
          ctx.fillStyle = on ? P.paper : P.accent;
          ctx.font = '500 10px ui-monospace, monospace';
          ctx.fillText(STATIONS[step].n, cx, by + 15);
        }

        ctx.fillStyle = on ? P.accent : hov ? P.ink3 : P.ink4;
        ctx.font = `600 13px ${sans}`;
        ctx.fillText(r.nom, cx, cy + 2);
        ctx.font = '500 11px ui-monospace, monospace';
        ctx.fillStyle = on ? P.accent : P.ink4;
        ctx.fillText(r.a, cx, cy + 18);
      });

      /* Cotes et échelle : seulement en vue d'ensemble. */
      if (overview > 0.02) {
        ctx.globalAlpha = overview;
        ctx.strokeStyle = P.ink4;
        ctx.lineWidth = 1;
        const dy = Y(PLAN.h) + 34;
        ctx.beginPath();
        ctx.moveTo(X(0), dy);
        ctx.lineTo(X(PLAN.w), dy);
        ctx.moveTo(X(0), dy - 5);
        ctx.lineTo(X(0), dy + 5);
        ctx.moveTo(X(PLAN.w), dy - 5);
        ctx.lineTo(X(PLAN.w), dy + 5);
        ctx.stroke();
        ctx.fillStyle = P.ink4;
        ctx.font = '500 10px ui-monospace, monospace';
        ctx.fillText('11,40 m', X(PLAN.w / 2), dy - 10);
        ctx.globalAlpha = 1;
      }
    },
    [colors],
  );

  const update = useCallback(() => {
    const canvas = canvasRef.current;
    const runway = runwayRef.current;
    if (!canvas || !runway) return;

    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;

    if (staticRef.current) {
      draw(camFor(null, W, H), null, 1);
      return;
    }

    const rect = runway.getBoundingClientRect();
    const span = Math.max(1, rect.height - H);
    const p = Math.min(1, Math.max(0, -rect.top / span));

    const n = STATIONS.length;
    const idx = p * (n - 1);
    const i = Math.min(n - 2, Math.floor(idx));
    const f = idx - i;
    /* Palier puis transition : la caméra respire au lieu de glisser sans fin. */
    const m = easeInOut(Math.min(1, Math.max(0, (f - 0.28) / 0.72)));

    const a = camFor(STATIONS[i].room, W, H);
    const b = camFor(STATIONS[i + 1].room, W, H);
    // Zoom interpolé en échelle logarithmique : en linéaire, la fin du
    // mouvement paraît freiner.
    const cam: Camera = {
      x: a.x + (b.x - a.x) * m,
      y: a.y + (b.y - a.y) * m,
      s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * m),
    };
    camRef.current = cam;

    const active = m < 0.5 ? STATIONS[i].room : STATIONS[i + 1].room;
    const base = camFor(null, W, H).s;
    draw(cam, hoverRef.current ?? active, Math.min(1, Math.max(0, 1 - (cam.s / base - 1) * 1.6)));

    const cards = cardsRef.current?.children;
    if (cards) {
      Array.from(cards).forEach((el, k) => {
        const o = Math.max(0, 1 - Math.abs(idx - k) / 0.55);
        const node = el as HTMLElement;
        node.style.opacity = o.toFixed(3);
        node.style.transform = `translateY(${((1 - o) * 14).toFixed(1)}px)`;
        node.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
      });
    }
    if (barRef.current) barRef.current.style.width = `${(p * 100).toFixed(1)}%`;
    if (countRef.current) {
      countRef.current.textContent = `${String(Math.min(n, Math.round(idx) + 1)).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
    }
  }, [camFor, draw]);

  /* Conversion écran -> mètres, pour le survol et le clic. */
  const hitTest = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    const cam = camRef.current;
    if (!canvas || !cam || staticRef.current) return null;

    const rect = canvas.getBoundingClientRect();
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const wx = (event.clientX - rect.left - (W / 2 - cam.x * cam.s)) / cam.s;
    const wy = (event.clientY - rect.top - (H / 2 - cam.y * cam.s)) / cam.s;

    const hit = PLAN.rooms.find(
      (r) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h,
    );
    return hit?.id ?? null;
  }, []);

  useEffect(() => {
    const syncMode = () => {
      const next =
        window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        window.matchMedia('(max-width: 760px)').matches;
      if (next !== staticRef.current) {
        staticRef.current = next;
        setIsStatic(next);
        hoverRef.current = null;
      }
      update();
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    };

    syncMode();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', syncMode, { passive: true });

    /* Le canvas ne suit pas la cascade CSS : on repeint au changement de thème. */
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const repaint = () => {
      colors(true);
      update();
    };
    mq.addEventListener('change', repaint);

    // Les polices changent la métrique des étiquettes une fois chargées.
    document.fonts?.ready.then(update).catch(() => {});
    const settle = window.setTimeout(syncMode, 400);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', syncMode);
      mq.removeEventListener('change', repaint);
      window.clearTimeout(settle);
    };
  }, [colors, update]);

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTest(event);
    if (hit === hoverRef.current) return;
    hoverRef.current = hit;
    event.currentTarget.style.cursor = hit && stepForRoom(hit) > -1 ? 'pointer' : 'default';
    update();
  };

  const onLeave = () => {
    hoverRef.current = null;
    update();
  };

  return (
    <section className={isStatic ? 'plan plan--static' : 'plan'} aria-label="Le parcours Bail">
      <div className="plan__runway" ref={runwayRef}>
        <div className="plan__pin">
          <canvas
            ref={canvasRef}
            className="plan__canvas"
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          />

          <div className="plan__hud">
            <div className="plan__meta">
              <span className="label label--accent">Le parcours Bail, pièce par pièce</span>
              <span className="label">Cliquez une pièce pour ouvrir l’écran</span>
            </div>
            <span className="label plan__count" ref={countRef}>
              01 / 07
            </span>
            <div className="plan__bar">
              <span ref={barRef} />
            </div>

            <div ref={cardsRef}>
              {STATIONS.map((station) => (
                <article key={station.t} className="plan__card">
                  <span className="label label--accent">
                    {station.n ? `Station ${station.n}` : 'Parcours'}
                  </span>
                  <h3 className="plan__card-title">{station.t}</h3>
                  <span className="label">{station.s}</span>
                  <p className="plan__card-text">{station.d}</p>
                  <div className="plan__card-keys">
                    {station.k.map((key) => (
                      <span key={key} className="badge badge--mute badge--nodot">
                        {key}
                      </span>
                    ))}
                  </div>
                  {station.go ? (
                    <Link href={station.go} className="btn btn-sm btn-block mt-12">
                      {station.cta} →
                    </Link>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Repli sans défilement piloté : les stations en liste, chacune cliquable. */}
      <div className="plan__list">
        {STATIONS.filter((station) => station.go).map((station) => (
          <Link key={station.t} href={station.go!} className="plan__list-item">
            <span className="label label--accent">{station.n}</span>
            <span>
              <b>{station.t}</b> — <span className="muted">{station.d}</span>
            </span>
            <span className="plan__list-arrow">→</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
