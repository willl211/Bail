# Bail — plateforme de location longue durée (MVP v0, pilote Metz)

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
npm run db:migrate           # applique les migrations
npm run db:seed              # 6 quartiers, 8 biens, barème, modèles de bail
npm run dev                  # backend :4000 et frontend :3000 en parallèle
```

- Front : http://localhost:3000
- API : http://localhost:4000/api/v1
- État de l'API et des intégrations : http://localhost:4000/api/v1/health

Le port PostgreSQL est **5433**, pas 5432, pour ne pas entrer en conflit avec un
Postgres déjà installé sur le poste.

### Autres commandes

| Commande | Effet |
|---|---|
| `npm run build` | compile backend puis frontend |
| `npm run typecheck` | TypeScript sur les deux workspaces |
| `npm run lint` | ESLint sur les deux workspaces |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | remet la base à zéro et rejoue le seed |
| `npm run db:down` | arrête PostgreSQL |

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
| Signature électronique du bail | DocuSign | `mock` en dev, sandbox en staging |
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
| 6 | Génération de bail + signature | à faire |
| 7 | Paiement des honoraires | à faire |

Le schéma de base couvre déjà les sept étapes. Les étapes 1 à 5 sont complètes.
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
| `agent.demo@bail.local` | agent interne (back-office à construire) |
| `camille.ferry@bail.local`, `noah.bertrand@bail.local`, `ines.lemoine@bail.local`, `theo.marchand@bail.local` | locataires candidats |

Ces comptes n'existent que dans le seed de développement.

## Dette connue

- `prisma` CLI tire `deepmerge-ts` signalé par `npm audit` (chaîne de
  développement uniquement, pas dans le runtime de l'API).
- Prisma signale que `package.json#prisma` sera retiré en Prisma 7 : à migrer
  vers `prisma.config.ts` lors du passage à Prisma 7.
- Stripe : le module de paiement est complet (abonnement, résiliation, reprise,
  webhook à signature vérifiée), mais aucun compte n'est branché.
  `PAYMENT_DRIVER=mock` reste la valeur par défaut ; passer en réel se réduit à
  `PAYMENT_DRIVER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` et
  `STRIPE_PRODUCT_ID` ([`docs/integrations.md`](docs/integrations.md)).
- `SubscriptionService.syncQuantity()` n'a pas encore d'appelant : l'assiette
  facturée doit être resynchronisée quand un bien entre ou sort de la diffusion,
  c'est-à-dire depuis le back-office, qui n'est pas construit. Le montant
  *affiché* est toujours exact — il est recalculé à chaque lecture — seule la
  quantité côté prestataire pourrait diverger une fois un compte branché.
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
- Le contrôle manuel des pièces (justificatif de domicile, refus motivé) attend
  le back-office : aucun écran ne permet encore à un agent de statuer, donc une
  pièce en revue humaine y reste.
- Aucun prestataire de visio n'est retenu : `VIDEO_DRIVER=mock` est la seule
  valeur acceptée, et le driver refuse de démarrer sur un nom inconnu plutôt que
  de retomber sur le simulateur — en production, ça donnerait des rendez-vous en
  visio impossibles à rejoindre. Les salles portent une URL en `.invalid`, que
  personne ne prendra pour un vrai lien.
- La **purge des enregistrements de visite à 15 jours** n'a pas d'exécutant :
  `Visit.recordingExpiresAt` est posée à l'ouverture de la salle, mais aucune
  tâche planifiée ne balaie encore les enregistrements arrivés à échéance. À
  brancher avant toute visio réelle (docs/integrations.md).
- L'**empreinte bancaire avant visite** n'est pas demandée tant qu'aucun
  prestataire de paiement n'est branché : la visite est alors confirmée d'emblée
  et l'écran l'annonce. Elle redeviendra bloquante dès que `PAYMENT_DRIVER`
  passera à `stripe`.
- Le driver de stockage `s3` n'est pas implémenté : seul `local` fonctionne.
  Le service échoue explicitement si un autre driver est configuré, plutôt que
  d'écrire sur le disque du serveur applicatif en croyant écrire sur l'objet.
