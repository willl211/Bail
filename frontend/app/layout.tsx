import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google';
import { Suspense } from 'react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { RevealObserver } from '@/components/reveal-observer';
import './globals.css';

// Les deux familles de la maquette : Space Grotesk pour le texte, IBM Plex Mono
// pour toute donnée chiffrée (surface, loyer, statuts, références).
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
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
    default: 'Seuil — location longue durée en direct à Metz',
    template: '%s · Seuil',
  },
  description:
    "Louer sans agence à Metz : les propriétaires publient avec un abonnement mensuel, les locataires déposent un dossier vérifié une seule fois puis candidatent en un clic.",
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f2f1ed',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${spaceGrotesk.variable} ${ibmPlexMono.variable}`}>
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
