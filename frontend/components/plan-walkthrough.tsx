'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

const STEPS = [
  {
    n: '01',
    label: 'Annonce',
    title: 'Trouvez votre prochain chez-vous.',
    description:
      'Consultez les logements, leurs caractéristiques et les conditions de location. Prenez le temps de trouver celui qui vous correspond.',
    href: '/recherche',
    cta: 'Découvrir les logements',
  },
  {
    n: '02',
    label: 'Dossier',
    title: 'Votre dossier, au même endroit.',
    description:
      'Rassemblez vos informations et vos justificatifs dans votre espace personnel. Vous pouvez suivre les éléments à compléter.',
    href: '/dossier',
    cta: 'Accéder à mon dossier',
  },
  {
    n: '03',
    label: 'Candidature',
    title: 'Un logement vous plaît ? Candidatez.',
    description:
      'Retrouvez votre dossier pour présenter votre candidature et suivre son avancement depuis votre espace.',
    href: '/dossier',
    cta: 'Accéder à mon dossier',
  },
  {
    n: '04',
    label: 'Visite',
    title: 'Projetez-vous dans les lieux.',
    description:
      'Lorsque votre candidature avance, retrouvez les informations utiles pour organiser votre visite et préparer vos questions.',
    href: '/dossier',
    cta: 'Accéder à mon dossier',
  },
  {
    n: '05',
    label: 'Bail',
    title: 'Les détails avant les clés.',
    description:
      'Une fois votre candidature retenue, prenez connaissance du bail et de ses annexes avant de passer à la signature.',
    href: '/dossier',
    cta: 'Accéder à mon dossier',
  },
  {
    n: '06',
    label: 'Honoraires',
    title: 'Gardez les frais en vue.',
    description:
      'Consultez les honoraires indiqués pour le logement et les informations de paiement associées à votre parcours.',
    href: '/dossier',
    cta: 'Accéder à mon dossier',
  },
] as const;

const STATIC_QUERIES = [
  '(max-width: 760px)',
  '(max-height: 650px)',
  '(prefers-reduced-motion: reduce)',
];

// Le serveur rend toujours le parcours complet. L'animation est ensuite activée
// selon les capacités du navigateur et les préférences de la personne.
const serverAnimationMode = () => false;

function browserAnimationMode() {
  return (
    typeof window !== 'undefined' &&
    typeof window.CSS?.supports === 'function' &&
    window.CSS.supports('animation-timeline: view()') &&
    typeof window.IntersectionObserver === 'function' &&
    typeof window.ResizeObserver === 'function' &&
    STATIC_QUERIES.every((query) => !window.matchMedia(query).matches)
  );
}

function subscribeAnimationMode(onChange: () => void) {
  const queries = STATIC_QUERIES.map((query) => window.matchMedia(query));
  queries.forEach((query) => query.addEventListener('change', onChange));
  return () => queries.forEach((query) => query.removeEventListener('change', onChange));
}

export function PlanWalkthrough() {
  const headingId = useId();
  const detailId = useId();
  const runwayRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeStep, setActiveStep] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const supportsAnimation = useSyncExternalStore(
    subscribeAnimationMode,
    browserAnimationMode,
    serverAnimationMode,
  );
  const isAnimated = supportsAnimation && !imageFailed;
  const step = STEPS[activeStep];

  useEffect(() => {
    const runway = runwayRef.current;
    const stage = stageRef.current;
    if (!isAnimated || !runway || !stage) return;

    let intersectionObserver: IntersectionObserver | null = null;

    const refreshObservation = () => {
      const travel = Math.max(1, runway.offsetHeight - stage.offsetHeight);
      const stickyTop = Math.max(0, parseFloat(getComputedStyle(stage).top) || 0);
      const triggerTop = Math.min(window.innerHeight - 2, stickyTop);

      // Chaque segment correspond à l'étape la plus proche du cadrage courant.
      // Seul le franchissement d'une limite met à jour l'état React.
      markerRefs.current.forEach((marker, index) => {
        if (!marker) return;
        const start = index === 0 ? 0 : (index - 0.5) / (STEPS.length - 1);
        const end =
          index === STEPS.length - 1 ? 1 : (index + 0.5) / (STEPS.length - 1);
        marker.style.top = `${start * travel}px`;
        marker.style.height = `${Math.max(1, (end - start) * travel)}px`;
      });

      intersectionObserver?.disconnect();
      intersectionObserver = new IntersectionObserver(
        () => {
          const progress = Math.min(
            1,
            Math.max(0, (stickyTop - runway.getBoundingClientRect().top) / travel),
          );
          setActiveStep(Math.round(progress * (STEPS.length - 1)));
        },
        {
          rootMargin: `-${triggerTop}px 0px -${Math.max(0, window.innerHeight - triggerTop - 2)}px 0px`,
          threshold: 0,
        },
      );
      markerRefs.current.forEach((marker) => {
        if (marker) intersectionObserver?.observe(marker);
      });
    };

    refreshObservation();
    const resizeObserver = new ResizeObserver(refreshObservation);
    resizeObserver.observe(runway);
    resizeObserver.observe(stage);
    window.addEventListener('resize', refreshObservation, { passive: true });

    return () => {
      intersectionObserver?.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', refreshObservation);
    };
  }, [isAnimated]);

  const selectStep = (index: number) => {
    const runway = runwayRef.current;
    const stage = stageRef.current;
    if (!isAnimated || !runway || !stage) return;

    const stickyTop = parseFloat(getComputedStyle(stage).top) || 0;
    const travel = Math.max(0, runway.offsetHeight - stage.offsetHeight);
    const top =
      window.scrollY +
      runway.getBoundingClientRect().top -
      stickyTop +
      (index / (STEPS.length - 1)) * travel;

    // Navigation volontaire uniquement : le défilement ordinaire reste natif.
    window.scrollTo({ top, behavior: 'smooth' });
  };

  return (
    <section
      className={`house-walkthrough${isAnimated ? ' house-walkthrough--animated' : ''}`}
      aria-labelledby={headingId}
    >
      <header className="house-walkthrough__heading">
        <div>
          <span className="label label--accent">Le parcours whoma</span>
          <h2 id={headingId}>Un chez-vous. Un parcours simple.</h2>
          <p>De la première annonce à la remise des clés, chaque étape a sa place.</p>
        </div>
        <Link href="/recherche" className="link link--accent">
          Voir les logements <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <div ref={runwayRef} className="house-walkthrough__runway">
        <div ref={stageRef} className="house-walkthrough__stage">
          <figure className="house-walkthrough__visual">
            <div className="house-walkthrough__camera">
              {imageFailed ? (
                <div
                  className="house-walkthrough__image-fallback"
                  role="img"
                  aria-label="Maison contemporaine fictive vue en coupe"
                >
                  <span className="label label--accent">Une maison, un nouveau départ</span>
                  <p>Une maison imaginée, ouverte sur ses espaces de vie.</p>
                </div>
              ) : (
                <Image
                  src="/images/whoma-house-cutaway.webp"
                  alt="Maison contemporaine fictive vue en coupe, dévoilant ses pièces meublées et ses espaces de vie."
                  width={1536}
                  height={1024}
                  sizes={
                    isAnimated
                      ? '(max-width: 1100px) 65vw, 900px'
                      : '(max-width: 950px) 100vw, 900px'
                  }
                  className="house-walkthrough__image"
                  onError={() => setImageFailed(true)}
                />
              )}
            </div>
            <figcaption className="house-walkthrough__caption">
              Une maison imaginée pour découvrir le parcours whoma.
            </figcaption>
          </figure>

          {isAnimated ? (
            <aside
              className="house-walkthrough__content"
              aria-label="Les étapes de votre location"
            >
              <nav className="house-walkthrough__steps" aria-label="Choisir une étape">
                {STEPS.map((item, index) => (
                  <button
                    key={item.n}
                    type="button"
                    className="house-walkthrough__step"
                    aria-current={index === activeStep ? 'step' : undefined}
                    aria-controls={detailId}
                    onClick={() => selectStep(index)}
                  >
                    <span className="house-walkthrough__step-number">{item.n}</span>
                    <span className="house-walkthrough__step-label">{item.label}</span>
                  </button>
                ))}
              </nav>

              <article
                className="house-walkthrough__detail"
                id={detailId}
                aria-labelledby={`${detailId}-title`}
              >
                <span className="label label--accent">{step.n} / 06 · {step.label}</span>
                <h3 id={`${detailId}-title`}>{step.title}</h3>
                <p>{step.description}</p>
                <Link href={step.href} className="btn">
                  {step.cta} <span aria-hidden="true">↗</span>
                </Link>
              </article>

              <p className="house-walkthrough__hint">
                Faites défiler ou choisissez une étape.
              </p>
            </aside>
          ) : (
            <ol className="house-walkthrough__list" aria-label="Les étapes de votre location">
              {STEPS.map((item) => (
                <li key={item.n}>
                  <span className="house-walkthrough__step-number" aria-hidden="true">
                    {item.n}
                  </span>
                  <article>
                    <span className="label label--accent">{item.label}</span>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <Link href={item.href} className="link link--accent">
                      {item.cta} <span aria-hidden="true">↗</span>
                    </Link>
                  </article>
                </li>
              ))}
            </ol>
          )}
        </div>

        {isAnimated
          ? STEPS.map((item, index) => (
              <div
                key={item.n}
                ref={(node) => {
                  markerRefs.current[index] = node;
                }}
                className="house-walkthrough__marker"
                aria-hidden="true"
              />
            ))
          : null}
      </div>
    </section>
  );
}
