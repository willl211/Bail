# Bail — maquette v0 (Metz)

Maquette interactive complète de la plateforme, en un seul fichier autonome :
[`bail.html`](bail.html). Aucune dépendance, aucun build, aucun backend. Ouvre le
fichier dans un navigateur, ou consulte la version publiée.

## Ce que couvre la maquette

Quinze écrans, dans l'ordre de construction de `docs/build-order.md` :

| # | Écran | Profil |
|---|---|---|
| 00 | Sommaire des écrans | — |
| 01 | Accueil | Public |
| 02 | Résultats de recherche | Public |
| 03 | Fiche annonce | Public |
| 04 | Compte propriétaire | Propriétaire |
| 05 | Dépôt d'annonce | Propriétaire |
| 06 | Abonnement | Propriétaire |
| 07 | Candidatures reçues | Propriétaire |
| 08 | Compte locataire | Locataire |
| 09 | Dossier numérique | Locataire |
| 10 | Candidature | Locataire |
| 11 | Prise de RDV de visite | Locataire |
| 12 | Bail et signature | Locataire |
| 13 | Honoraires | Locataire |
| 14 | Back-office | Admin |

Le bandeau noir en haut de page est un **chrome de revue**, pas un élément du
produit : il permet de basculer le profil connecté et le thème (auto / clair /
sombre), et de sauter d'un écran à l'autre.

## Profils et périmètres

Le sélecteur « Profil connecté » change réellement l'en-tête du produit : liens,
appel à l'action et identité affichée. Les écrans hors du périmètre du profil
courant sont **estompés** dans le rail ; ils restent cliquables pour la revue, et
le clic bascule automatiquement vers le profil qui y a droit.

| | Visiteur | Locataire | Propriétaire | Agent interne |
|---|---|---|---|---|
| Accueil, résultats, fiche annonce | ✓ | ✓ | ✓ | — |
| Inscription locataire / propriétaire | ✓ | ✓ | ✓ | — |
| Mon dossier, candidatures, visites, honoraires | — | ✓ | — | — |
| Mes biens, abonnement, candidatures reçues | — | — | ✓ | — |
| Bail | — | ✓ | ✓ | — |
| Back-office | — | — | — | ✓ |

Deux points de conception que la maquette rend visibles :

- **L'écran 04 est public.** « Espace propriétaire » recouvre deux choses : une
  page d'acquisition accessible sans compte (écran 04, liée depuis l'en-tête
  visiteur sous « Louer sans agence ») et un tableau de bord authentifié
  (écrans 05 à 07).
- **Le back-office a son propre point d'entrée.** Le profil agent interne ne
  reçoit pas l'en-tête public : fond en creux, filet d'accent, badge
  « Accès interne », navigation strictement interne, et aucun lien vers le site
  visiteur hormis « Quitter ».

La table `PROFILES` en tête de script porte ce découpage. Dans le produit réel,
elle vit **côté API** — un guard de rôle NestJS sur chaque route. Le front n'en
est que le reflet : masquer un lien n'a jamais été un contrôle d'accès, et
`/proprietaires/candidatures` doit répondre 403 quand l'URL est saisie à la main.

## Direction visuelle

Registre cadastral et plan de géomètre : filets d'un pixel, alignements stricts,
repères de calage aux angles des panneaux principaux, aplats hachurés à la place
des photos, barres d'échelle. Aucun arrondi, aucun dégradé, aucune ombre au repos.

- **Sans-serif** — Archivo (axe de chasse variable : `wdth 88` pour les titres
  serrés, `wdth 100` pour le texte courant).
- **Monospace** — IBM Plex Mono, pour **toute** donnée : loyer, surface, référence,
  statut, date, étiquette. C'est la règle qui tient le système.
- **Accent unique** — vert forêt `#0e5c3a` en clair, eucalyptus `#8cbba0` en
  sombre. Un seul jeton à changer, `--accent`, pour passer au bleu profond.
- **Couleurs d'état** — ambre `--pending` et terre cuite `--reject`. Elles portent
  une information (en cours, refusé), elles ne décorent rien.

Le thème sombre n'est pas une inversion, et surtout pas un fond noir verdâtre à
accent fluo — ça donnait un éditeur de code. Il est construit sur un **charbon
chaud** `#1a1917`, des gris biaisés ocre et un accent eucalyptus désaturé :
l'ambiance reste celle du thème clair, en creux. Échelle de contraste vérifiée :
14,5 / 9,3 / 6,3 / 4,6 pour les quatre niveaux d'encre, 8,1 pour l'accent.

Tous les jetons sont redéfinis dans `:root:not([data-theme='light'])` sous
`prefers-color-scheme: dark`, et dans `:root[data-theme='dark']` pour le choix
explicite du lecteur.

## Ton rédactionnel

Le texte courant est volontairement bref : le titre porte la promesse, les
puces de réassurance portent les preuves, et les paragraphes ne répètent ni
l'un ni l'autre. Une accroche fait une phrase, pas trois. Quand une donnée est
déjà affichée dans un badge ou une caractéristique, elle n'est pas reprise en
prose.

## Le plan-parcours (accueil)

Reprise de la mécanique de `terminal-industries.com` : une **piste de défilement
haute** (640 vh) donne la course, un conteneur **`sticky`** retient la scène à
l'écran, et la caméra suit la progression. Terminal scrube des vidéos
pré-rendues sur un canvas ; ici le canvas dessine un **plan de géomètre** — plus
juste pour la marque, net à tous les zooms, et sans un octet d'asset externe.

Comme chez Terminal, le dispositif **présente le produit**, il ne montre pas un
bien particulier. Les pièces sont des **stations numérotées**, parcourues dans
l'ordre où un agent fait visiter — entrée, séjour, cuisine, chambres, salle de
bain — et cet ordre porte le parcours de la plateforme :

| Station | Pièce | Fonction | Écran ouvert |
|---|---|---|---|
| 01 | Entrée | L'annonce vérifiée | 03 Fiche annonce |
| 02 | Séjour | Le dossier numérique | 09 Dossier |
| 03 | Cuisine | La candidature | 10 Candidature |
| 04 | Chambre 1 | La visite | 11 Visite |
| 05 | Chambre 2 | Le bail | 12 Bail |
| 06 | Salle de bain | Les honoraires | 13 Paiement |

**Cliquer une pièce ouvre son écran.** Le repère numéroté dessiné dans la pièce
est la promesse ; le bouton de la fiche fait la même chose au clavier.

C'est l'**ordre** qui porte le sens, pas la pièce : rien ne prétend qu'une salle
de bain « est » un bail. Le balcon n'a pas de station et ne prend pas le curseur
« main » — un repère qui ne mène nulle part vaut moins que pas de repère.

Points d'implémentation :

- La projection est **recalculée à chaque image** depuis la taille réelle de la
  scène : le cadrage reste juste à toutes les tailles de fenêtre.
- Le zoom est interpolé en **échelle logarithmique**, sinon la fin du mouvement
  paraît freiner.
- Chaque étape tient un **palier** (28 % du segment) avant de repartir : la
  caméra respire au lieu de glisser sans fin.
- Les pièces sont **survolables et cliquables** — un clic amène le défilement à
  l'étape correspondante. L'entrée et le balcon n'ont pas d'étape : ils
  s'éclairent au survol mais ne prennent pas le curseur « main ».
- Le canvas ne suit pas la cascade CSS : un `MutationObserver` sur `data-theme`
  et un écouteur `prefers-color-scheme` le repeignent. Le trait de maçonnerie a
  son propre jeton `--plan-wall`, sombre sur papier et gris chaud en thème
  sombre — l'encre pure y ferait des bandes éblouissantes.
- Sous 760 px ou en `prefers-reduced-motion`, la scène **n'est pas épinglée** :
  plan complet fixe, puis les pièces en liste. Le mode est réévalué à chaque
  redimensionnement, pas seulement au chargement.

## Animations

Délibérées, jamais systématiques :

- entrée en fondu échelonnée sur le seul bloc d'ouverture ;
- compteur animé sur les biens vérifiés ;
- révélation au défilement, une fois, par section ;
- cartes qui se soulèvent au survol et révèlent leur référence ;
- badges de statut qui apparaissent par un `pop` ;
- barres de progression et jauges qui se remplissent à l'entrée sur l'écran ;
- bandeau d'activité en défilement continu, mis en pause au survol ;
- **une** vérification KYC qui bascule en direct sur l'écran 09, avec brouillage
  de caractères, deux secondes après l'arrivée sur l'écran.

Tout est neutralisé sous `prefers-reduced-motion: reduce`.

## Données

Huit biens réels de forme (studios/T1 et T2/T3, meublés et nus, quartiers de Metz),
des dossiers à quatre stades de vérification, des candidatures aux cinq statuts,
des baux et paiements à différentes étapes du circuit des fonds. Les prestataires
réglementés sont affichés en mode test, conformément à `docs/integrations.md`.

Barème du pilote, paramétrable : abonnement 39 €/mois/bien, honoraires locataire
8 €/m², état des lieux 1 €/m². Ces montants ne sont pas figés (`docs/legal-context.md`).

## Écarts à signaler

- La marque est **Bail**, alors que le code de `frontend/` et la maquette
  Claude Design importée portent **Seuil**, avec un accent bordeaux `#7a1f2b`.
  Le nom et l'accent sont à trancher avant l'implémentation.
- Le profil **admin** (écran 14) n'existe pas dans la maquette importée ; il est
  construit ici à partir de `docs/data-model.md` (rôle « agent interne ») et du
  back-office agence de `docs/product-brief.md`.
