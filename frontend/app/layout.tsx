import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RevealObserver } from '@/components/reveal-observer';
import './globals.css';
import './responsive.css';

// Fichiers et licences versionnés : aucun téléchargement à la compilation.
// Titres chaleureux, interface sobre et repères chiffrés alignés.
const dmSans = localFont({
  src: './fonts/dm-sans-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-sans',
  display: 'swap',
});

const newsreader = localFont({
  src: './fonts/newsreader-latin.woff2',
  weight: '400 600',
  style: 'normal',
  variable: '--font-display',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
});

const ibmPlexMono = localFont({
  src: [
    { path: './fonts/ibm-plex-mono-400-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-500-latin.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-mono-600-latin.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: {
    default: 'whoma — location longue durée en direct à Metz',
    template: '%s · whoma',
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
  // La palette méditerranéenne conserve sa lumière sur tous les appareils.
  themeColor: '#f5f1e7',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-scroll-behavior` : sans cet attribut, Next applique le défilement
    // doux de `html` aux changements de route, et chaque navigation se met à
    // glisser au lieu d'afficher la nouvelle page en haut.
    <html
      lang="fr"
      data-scroll-behavior="smooth"
      className={`${dmSans.variable} ${newsreader.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <a className="skip-link" href="#page-content">Aller au contenu</a>
        <SiteHeader />
        <div id="page-content" tabIndex={-1}>{children}</div>
        <SiteFooter />
        <Suspense fallback={null}>
          <RevealObserver />
        </Suspense>
      </body>
    </html>
  );
}
