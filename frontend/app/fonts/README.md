# Polices locales de whoma

Choix du 17 septembre 2026 : Newsreader pour les grands titres, DM Sans pour
le texte courant. IBM Plex Mono est conservée pour les montants et références.
Chargement par `next/font/local` dans `app/layout.tsx`, avec `display: swap`.
Les deux familles principales sont préchargées ; les trois graisses monospace
sont chargées à l’usage. Aucun téléchargement externe à la compilation.

Les fichiers WOFF2 sont les sous-ensembles latins officiels de Google Fonts,
incluant les accents français, œ/Œ et le symbole euro. Les caractères hors de
ces sous-ensembles utilisent les polices de secours du système. Les fichiers
sont inchangés, accompagnés de leur licence SIL Open Font License 1.1.

| Fichier | Graisses déclarées | Source |
|---|---|---|
| dm-sans-latin.woff2 | 400–700, variable | https://fonts.gstatic.com/s/dmsans/v17/rP2Hp2ywxg089UriCZOIHQ.woff2 |
| newsreader-latin.woff2 | 400–600, variable | https://fonts.gstatic.com/s/newsreader/v26/cY9AfjOCX1hbuyalUrK4397yjA.woff2 |
| ibm-plex-mono-400-latin.woff2 | 400 | https://fonts.gstatic.com/s/ibmplexmono/v20/-F63fjptAgt5VM-kVkqdyU8n1i8q1w.woff2 |
| ibm-plex-mono-500-latin.woff2 | 500 | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3twJwlBFgg.woff2 |
| ibm-plex-mono-600-latin.woff2 | 600 | https://fonts.gstatic.com/s/ibmplexmono/v20/-F6qfjptAgt5VM-kVkqdyU8n3vAOwlBFgg.woff2 |

Licences originales : [DM Sans](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt),
[Newsreader](https://github.com/google/fonts/blob/main/ofl/newsreader/OFL.txt),
[IBM Plex Mono](https://github.com/google/fonts/blob/main/ofl/ibmplexmono/OFL.txt).
Conserver ces licences lors de toute redistribution.
