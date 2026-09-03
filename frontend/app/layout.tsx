import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RevealObserver } from '@/components/reveal-observer';
import './globals.css';

// Les deux familles de la maquette : Archivo pour le texte — son axe de chasse
// variable sert les titres serrés (`wdth` 88) autant que le texte courant —
// et IBM Plex Mono pour toute donnée chiffrée (surface, loyer, statut,
// référence). C'est cette règle qui tient le système visuel.
// Archivo est chargée en fonte variable (pas de `weight` figé) : c'est la
// condition pour exposer l'axe de chasse `wdth`, dont le système se sert pour
// resserrer les titres (`font-variation-settings: 'wdth' 88`).
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Bail — location longue durée en direct à Metz',
    template: '%s · Bail',
  },
  description:
    "Louer sans agence à Metz : les propriétaires publient avec un abonnement mensuel, sans commission. Les locataires déposent un dossier vérifié une seule fois, puis candidatent en un clic.",
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deux thèmes : papier bible en clair, charbon chaud en sombre.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f0ea' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1917' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-scroll-behavior` : sans cet attribut, Next applique le défilement
    // doux de `html` aux changements de route, et chaque navigation se met à
    // glisser au lieu d'afficher la nouvelle page en haut.
    <html
      lang="fr"
      data-scroll-behavior="smooth"
      className={`${archivo.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
        <Suspense fallback={null}>
          <RevealObserver />
        </Suspense>
      </body>
    </html>
  );
}
