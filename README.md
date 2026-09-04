# Bail — plateforme de location longue durée (MVP v0, pilote Metz)

[![Vérification](https://github.com/willl211/Bail/actions/workflows/verification.yml/badge.svg)](https://github.com/willl211/Bail/actions/workflows/verification.yml)

Monorepo de la plateforme. Le contexte produit fait foi et vit dans
[`CLAUDE.md`](CLAUDE.md) et [`docs/`](docs/) — à lire avant d'écrire du code.

## Structure

```
frontend/            Next.js 16 (App Router, React 19) — web responsive
backend/             NestJS 12 + Prisma 6 + PostgreSQL
  prisma/schema.prisma   schéma de base (docs/data-model.md)
  prisma/seed.ts         jeu de démonstration (les 8 biens de la maquette)
docs/                cadrage produit, technique, juridique, marché
maquette_interface/  export Claude Design — référence visuelle de tous les écrans
env/                 modèles de variables d'environnement par environnement
scripts/use-env.mjs  répartit un modèle vers backend/.env et frontend/.env.local
docker-compose.yml   PostgreSQL local (développement uniquement)
```

## Démarrage local

Prérequis : Node ≥ 20 (`.nvmrc` : 22) et Docker Desktop.

```bash
npm install                  # installe les deux workspaces
npm run env:use development  # crée backend/.env et frontend/.env.local
npm run db:up                # PostgreSQL sur le port 5433
npm run mail:up              # Mailpit : boîte aux lettres locale
npm run db:migrate           # applique les migrations
npm run db:seed              # 6 quartiers, 8 biens, barème, modèles de bail
npm run dev                  # backend :4000 et frontend :3000 en parallèle
```

- Front : http://localhost:3000
- API : http://localhost:4000/api/v1
- État de l'API et des intégrations : http://localhost:4000/api/v1/health
- **E-mails envoyés : http://localhost:8025** (Mailpit)

Le port PostgreSQL est **5433**, pas 5432, pour ne pas entrer en conflit avec un
Postgres déjà installé sur le poste.

Les e-mails partent réellement, en SMTP, mais vers Mailpit : **rien ne quitte la
machine**, et on voit le rendu exact — liens compris — dans son interface. C'est
ce qui permet de vérifier le canal de bout en bout sans compte chez un
prestataire. Sans Mailpit démarré, l'API le signale au lancement et les envois
échouent proprement, sans faire échouer l'action qui les déclenche.

### Autres commandes

| Commande | Effet |
|---|---|
| `npm run build` | compile backend puis frontend |
| `npm run typecheck` | TypeScript sur les deux workspaces |
| `npm run lint` | ESLint sur les deux workspaces |
| `npm test` | tests unitaires puis d'intégration, sur les deux workspaces |
| `npm run test:unit --workspace backend` | uniquement les tests unitaires (rapides, sans base) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | remet la base à zéro et rejoue le seed |
| `npm run db:down` | arrête PostgreSQL |
| `npm run mail:up` | démarre Mailpit (SMTP :1025, interface :8025) |
| `npm run mail:down` | arrête Mailpit |

## Tests

```bash
npm test          # tout : 168 tests
```

Deux campagnes, séparées par ce qu'elles exigent pour tourner.

| | Unitaires | Composants | Intégration |
|---|---|---|---|
| Quoi | fonctions pures : contrôle de cohérence du bail, règle de publication, pièces exigées d'un dossier, formats d'affichage | écrans où vit une logique client, montés dans un DOM | l'application Nest complète, contre une vraie base PostgreSQL |
| Combien | 96 | 32 | 40 |
| Exige | rien | rien | `npm run db:up` |
| Durée | ~12 s | ~15 s | ~50 s |

Les tests unitaires couvrent d'abord ce qui a une portée légale : plafonds du
dépôt de garantie (1 mois en nu, 2 en meublé), durées de bail, refus d'un champ
hors schéma, marqueur non remplacé qui **reste visible** plutôt que d'être
effacé en silence. Ces valeurs sont en dur dans le code — les mettre en base
laisserait croire qu'on peut les relever — et ces tests sont le garde-fou qui
signalerait une tentative de les changer.

Les tests d'intégration ne portent que sur ce qu'une fonction isolée ne peut pas
prouver : six requêtes simultanées qui ne créent qu'un seul dossier, deux
locataires qui ne peuvent pas réserver le même créneau, un 404 (et non un 403)
sur le bien d'autrui, une session qui cesse de valoir dans la seconde. Chacun
correspond à un défaut réellement rencontré ou à une décision de conception
inscrite plus bas dans ce fichier.

La base de test (`bail_test`) est distincte de celle de développement et créée
automatiquement ; aucun test ne touche `bail_dev`. Ces suites **tournent en
série** : elles partagent une base et la vident entre chaque cas.

Tout est rejoué à chaque poussée et sur chaque pull request par
[`.github/workflows/verification.yml`](.github/workflows/verification.yml), avec
un vrai PostgreSQL en service — les tests d'intégration ne valent que contre un
moteur transactionnel. Les étapes vont du moins cher au plus cher : lint et
types échouent en quelques secondes, les tests en quelques minutes, la
compilation en dernier.

Les tests de composants ne couvrent que les écrans où quelque chose se décide :
un jeton à usage unique qui ne doit pas être consommé par une faute de frappe,
un motif de refus qui ne doit pas suivre l'agent d'un onglet à l'autre — il part
au locataire d'un côté, au propriétaire de l'autre —, un bouton qui ne doit pas
promettre une décision que l'API refusera. Les écrans purement présentatifs n'y
figurent pas : les tester reviendrait à recopier leur JSX dans une assertion.

## Environnements

Trois environnements dès le départ : `development`, `staging`, `production`.
Chacun a son modèle dans [`env/`](env/) ; `npm run env:use <environnement>`
répartit les variables vers `backend/.env` (tout sauf les `NEXT_PUBLIC_*`) et
`frontend/.env.local`.

Les fichiers `.env` réels ne sont jamais commités. Staging et production sont
hébergés chez OVH (hébergeur français, conformité RGPD sur des données
sensibles — pièces d'identité, bulletins de salaire).

## Intégrations tierces

Toutes en sandbox ou mockées pendant le développement, aucune ne bloque
l'avancement ([`docs/integrations.md`](docs/integrations.md)). Le driver se
choisit par variable d'environnement, et `/health` affiche celui qui tourne.

| Besoin | Prestataire | Driver par défaut |
|---|---|---|
| KYC / vérification des pièces | **non choisi** | `mock` (seule valeur acceptée) |
| Signature électronique du bail | DocuSign | `mock` (driver DocuSign pas encore écrit) |
| Paiement (abonnements, honoraires) | Stripe | `mock` en dev, clés de test ensuite |
| Visio des visites à distance | **non choisi** (reco : Daily.co) | `mock` (seule valeur acceptée) |

## Points de conception à ne pas casser

Ces contraintes sont dans le schéma et dans le code, pas seulement dans la doc.

1. **Pas de visite autonome par boîtier connecté.** Le modèle `Visit` ne couvre
   que `ACCOMPANIED` et `VIDEO`. Hors périmètre v0, prévu v1.
2. **Le bail sort d'un modèle légal verrouillé.** `LeaseTemplate` porte le texte,
   versionné et empreinté ; `Lease.fieldValues` ne porte que les valeurs
   injectées. Il n'existe aucun champ de texte libre sur `Lease` — l'IA vérifie
   la cohérence des champs, elle ne rédige pas.
3. **Aucun montant en dur.** Barème d'honoraires et abonnement propriétaire
   viennent de `fee_schedules` et `platform_settings`, modifiables sans
   redéploiement. Le barème seedé porte `isLegallyApproved = false`.
4. **La plateforme encaisse pour le compte du propriétaire.** `Payment` sépare le
   statut de paiement du circuit des fonds (`fundsStatus`), avec un état
   « reversé au propriétaire ».
5. **Protocole de visite.** KYC et pré-autorisation carte avant le rendez-vous,
   caméra obligatoire, enregistrement conservé 15 jours puis purgé.
6. **Les pièces d'un dossier locataire ne sortent jamais vers le propriétaire.**
   Le propriétaire voit le *résultat* des contrôles — revenu vérifié, taux
   d'effort, état du garant — jamais les documents. C'est la promesse faite au
   locataire, et elle est tenue par le code : aucune route ne sert une pièce de
   dossier à quelqu'un d'autre que son titulaire.
7. **Fichiers publics et privés sont séparés physiquement.** `storage/public`
   (photos d'annonces) est servi statiquement ; `storage/private` (pièces de
   dossier locataire : identité, bulletins de salaire) ne l'est **jamais** et
   ne sortira que par une route contrôlant qui demande quoi. Élargir le chemin
   servi d'un niveau rendrait des cartes d'identité téléchargeables.
8. **Le design vient de la maquette.** `frontend/app/globals.css` reprend les
   valeurs exactes de [`maquette_interface/bail/bail.html`](maquette_interface/bail/bail.html)
   (accent vert forêt `#0e5c3a`, papier `#f1f0ea`, Archivo à chasse variable +
   IBM Plex Mono, thème sombre charbon chaud `#1a1917`). Ne pas improviser un
   autre style. L'ancienne maquette « Seuil » en bordeaux est obsolète.
9. **Un seul rôle interne.** `AGENT` couvre l'agent de terrain et
   l'administrateur du back-office ; il n'y a pas de rôle `ADMIN` distinct tant
   que le produit n'en a pas besoin.
10. **Une seule règle de publication.** `propertyChecks()`
    ([`backend/src/modules/owner/property.checks.ts`](backend/src/modules/owner/property.checks.ts))
    est une fonction pure, appelée aux trois endroits qui en dépendent : ce que
    le propriétaire voit avant de soumettre, ce que l'API vérifie à la
    soumission, ce que le back-office rejoue avant de mettre en ligne. La
    dupliquer serait le plus sûr moyen de publier un jour un bien sans DPE.
11. **Une adresse confirmée est exigée pour engager un tiers.** Candidater et
    publier une annonce la demandent ; se connecter, remplir son dossier ou
    préparer une annonce, non. On ne coupe pas l'accès à quelqu'un dont le
    fournisseur de messagerie met dix minutes à distribuer, mais un dossier ou
    une annonce accrochés à une adresse jamais confirmée ne valent rien — le
    candidat ne saurait pas qu'il est retenu, le propriétaire pas qu'il a reçu
    une candidature. La règle vit dans une seule fonction, `accountBlockers`,
    partagée par les deux profils.
12. **Aucun e-mail ne transporte de donnée de dossier.** Ni revenu, ni pièce
    jointe, ni lien vers un fichier privé : le message dit qu'il s'est passé
    quelque chose et renvoie sur le site, où la session contrôle qui voit quoi.
    La promesse faite au locataire (point 6) ne s'arrête pas au bord du
    navigateur — une boîte aux lettres se transfère, se pirate et s'indexe.
13. **Le journal des envois ne garde pas le contenu des messages.**
    `email_messages` consigne le destinataire, le gabarit et le statut, jamais
    le corps rendu ni les variables. Un lien de réinitialisation en base
    vaudrait une prise de contrôle de compte pour qui sait lire une ligne SQL —
    c'est aussi pourquoi ces e-mails partent en direct plutôt que par une file
    d'attente, qui devrait les stocker.
14. **Le journal du back-office ne raconte que du vrai.** Il est reconstitué à
    partir d'horodatages réels — publications, candidatures, pièces contrôlées,
    visites, baux. Rien n'y est ajouté pour remplir la page : un journal qui
    mentirait sur ce qui s'est passé n'aurait aucune valeur d'audit. De même,
    le délai moyen de vérification affiché est mesuré sur les contrôles
    effectués, jamais paramétré.

## Avancement

Ordre de construction imposé par [`docs/build-order.md`](docs/build-order.md) :
un écran doit être fonctionnel avant de passer au suivant.

| # | Écran | État |
|---|---|---|
| 1 | Recherche et fiche annonce (sans compte) | **fait** — accueil, résultats filtrés, fiche, alignés sur la maquette Bail |
| 2 | Compte + espace propriétaire | **fait** — authentification, dépôt d'annonce, photos, diagnostics, abonnement, candidatures reçues (lecture seule) |
| 3 | Compte + dossier locataire | **fait** — compte, situation, dépôt des pièces, garant, transmission au contrôle |
| 4 | Candidature à un bien | **fait** — aperçu, blocages/avis selon les critères du bien, envoi, suivi |
| 5 | Prise de RDV de visite | **fait** — créneaux ouverts par le propriétaire, décision sur les candidatures, réservation et annulation |
| 6 | Génération de bail + signature | **fait** — attribution, injection des champs, contrôle de cohérence, envoi en signature (bloqué : voir ci-dessous) |
| 7 | Paiement des honoraires | **fait** — détail par poste avec plafonds légaux, comparatif, ouverture du règlement (bloqué : voir ci-dessous) |
| — | Back-office de l'agence | **fait** — registre à quatre onglets : dossiers, biens, baux & paiements, journal |
| — | E-mails transactionnels | **fait** — driver SMTP vérifié, journal d'envoi, file différée, 3 messages de compte et 11 notifications d'événements |

Le schéma de base couvre déjà les sept étapes. **Les sept sont complètes**, et
le back-office qui les débloque aussi.
L'écran « Candidatures reçues » de l'étape 2 n'est plus en lecture seule : le
propriétaire y retient un candidat — ce qui lui ouvre la prise de rendez-vous —
ou l'écarte, avec un motif transmis. L'acceptation définitive, qui déclenche la
génération du bail et fige les autres candidatures, relève de l'étape 6.

### Comptes de démonstration

`npm run db:seed` crée un propriétaire, un agent interne et quatre locataires
candidats, tous avec le mot de passe **`Demo1234!`** :

| Compte | Rôle |
|---|---|
| `proprietaire.demo@bail.local` | propriétaire des 8 biens, avec candidatures reçues |
| `agent.demo@bail.local` | agent interne (back-office) |
| `camille.ferry@bail.local`, `noah.bertrand@bail.local`, `ines.lemoine@bail.local`, `theo.marchand@bail.local` | locataires candidats |

Ces comptes n'existent que dans le seed de développement.

Le seed dépose aussi, pour chacun des 8 biens, un **DPE de démonstration** —
un PDF d'une page qui annonce en première ligne qu'il n'est pas un diagnostic.
Sans lui, ces annonces seraient diffusées alors que la règle de publication de
la plateforme les refuserait : le back-office afficherait « DPE manquant » sur
chacune, et le contrôle de cohérence du bail n'aurait aucune surface à
recouper. Les fichiers sont écrits sous `backend/storage/private/properties/`,
hors dépôt.

## Dette connue

- **React est déclaré et épinglé à la racine** (`19.2.0`, plus des `overrides`) :
  `@testing-library/react` ne l'exige qu'en pair (`^18 || ^19`), et sans version
  concrète à la racine npm y installait un React 18 qui masquait le 19 du front.
  Next et Testing Library chargeaient alors deux React différents. À revoir en
  même temps que la montée de version de Next.
- Les tests de composants ne couvrent que quatre écrans. Les parcours de
  candidature, de visite et de bail n'ont pas encore d'équivalent : leur logique
  est surtout côté API, déjà testée, mais un blocage mal affiché y passerait
  inaperçu.
- Les tests d'intégration démarrent l'application entière : **Nest 12 est
  distribué en ESM pur**, que le runtime CommonJS de Jest ne sait pas charger,
  d'où `--experimental-vm-modules` et `useESM` sur cette seule campagne. Un
  avertissement d'expérimentalité s'affiche à chaque exécution ; il est sans
  conséquence.
- `prisma` CLI tire `deepmerge-ts` signalé par `npm audit` (chaîne de
  développement uniquement, pas dans le runtime de l'API).
- Prisma signale que `package.json#prisma` sera retiré en Prisma 7 : à migrer
  vers `prisma.config.ts` lors du passage à Prisma 7.
- Stripe : le module de paiement est complet (abonnement, résiliation, reprise,
  webhook à signature vérifiée), mais aucun compte n'est branché.
  `PAYMENT_DRIVER=mock` reste la valeur par défaut ; passer en réel se réduit à
  `PAYMENT_DRIVER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et
  `STRIPE_PRODUCT_ID` ([`docs/integrations.md`](docs/integrations.md)).
- Le comparatif « ce que vous auriez payé ailleurs » compare douze mois
  d'abonnement à un honoraire de mise en location unique. C'est cohérent mais
  peu flatteur pour un bien qui reste diffusé toute l'année ; l'hypothèse
  (durée de diffusion) reste à trancher. Les taux de marché sont dans
  `platform_settings`, modifiables sans redéploiement.
- Aucun prestataire de vérification (KYC) n'est retenu : `KYC_DRIVER=mock` est la
  seule valeur acceptée, et le driver refuse de démarrer sur un nom inconnu
  plutôt que de retomber silencieusement sur le simulateur — en production, ça
  reviendrait à valider des pièces d'identité sans les contrôler. L'écran du
  dossier locataire affiche « prestataire simulé » tant que c'est le cas.
- Aucun prestataire de visio n'est retenu : `VIDEO_DRIVER=mock` est la seule
  valeur acceptée, et le driver refuse de démarrer sur un nom inconnu plutôt que
  de retomber sur le simulateur — en production, ça donnerait des rendez-vous en
  visio impossibles à rejoindre. Les salles portent une URL en `.invalid`, que
  personne ne prendra pour un vrai lien.
- L'**empreinte bancaire avant visite** n'est pas demandée tant qu'aucun
  prestataire de paiement n'est branché : la visite est alors confirmée d'emblée
  et l'écran l'annonce. Elle redeviendra bloquante dès que `PAYMENT_DRIVER`
  passera à `stripe`.
- **Aucun bail ne peut être signé**, et c'est voulu : le modèle légal seedé est
  un squelette de champs sans aucune clause, `isActive = false`, et le réglage
  `lease.generationEnabled` est à `false`. La chaîne complète est construite et
  vérifiée — attribution, injection, contrôle de cohérence, envoi, événements de
  signature — mais elle refuse d'envoyer tant que le texte de l'avocat n'est pas
  publié. Un acte sans clauses n'engagerait personne (CLAUDE.md règle 2).
- **À faire : écrire le driver DocuSign.** Décision du 3 septembre 2026 —
  reporté, pas abandonné. Contrairement à Stripe, dont le SDK typé permet une
  intégration vérifiable sans compte, une intégration DocuSign écrite à
  l'aveugle — JWT, gabarits d'enveloppe, onglets de signature — ne serait
  vérifiable par rien. Elle s'écrit contre le bac à sable, dès que le compte
  existe. L'interface (`SignatureDriver`) et les variables `DOCUSIGN_*` sont
  déjà en place : il n'y a qu'une classe à ajouter et un nom de driver à
  accepter dans `SignatureModule`.
- L'**adresse du bailleur n'est collectée nulle part**, alors qu'elle est
  obligatoire au bail (loi n° 89-462, article 3). Le contrôle de cohérence la
  signale comme champ manquant. À ajouter au compte propriétaire avant le
  premier bail réel.
- **Aucun honoraire ne peut être encaissé**, pour trois raisons cumulées, toutes
  volontaires : le barème est `isLegallyApproved = false`, aucun prestataire de
  paiement n'est branché, et le règlement suppose un bail signé — qui ne peut pas
  l'être non plus. L'écran l'annonce point par point.
- **Aucun formulaire de carte bancaire n'a été construit**, contrairement à la
  maquette. Les coordonnées bancaires ne doivent jamais transiter par Bail :
  c'est le prestataire qui les collecte, dans son propre cadre, ce qui nous tient
  hors du périmètre PCI-DSS. Reproduire le formulaire de la maquette aurait été
  une faute.
- **Quatre notifications restent à écrire**, faute de parcours atteignable :
  bail prêt à signer, bail signé, honoraires réglés, échec de prélèvement
  d'abonnement. Les trois premières supposent un modèle de bail validé
  juridiquement, la dernière un compte Stripe.
- Les candidatures **figées par l'attribution du logement** à un autre candidat
  ne déclenchent aucun e-mail : le gabarit disponible est celui d'un refus
  explicite du propriétaire, et l'employer ici annoncerait une décision que
  personne n'a formulée. Un gabarit dédié est à écrire.
- Les tâches planifiées (file d'envoi, purge des enregistrements) supposent
  **une seule instance d'API**, ce qui est le cas du pilote. Avec plusieurs, il
  faudra les verrouiller pour qu'elles ne tournent pas en double.
- **Aucun prestataire d'envoi n'est retenu.** `MAIL_DRIVER=smtp` pointe sur
  Mailpit en local ; passer en réel ne demande que les variables `SMTP_*` d'un
  hébergeur de messagerie. Viser un prestataire européen (Brevo, Mailjet) pour
  rester cohérent avec le choix OVH fait pour la conformité RGPD.
- Le driver de stockage `s3` n'est pas implémenté : seul `local` fonctionne.
  Le service échoue explicitement si un autre driver est configuré, plutôt que
  d'écrire sur le disque du serveur applicatif en croyant écrire sur l'objet.
