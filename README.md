# Seuil — plateforme de location longue durée (MVP v0, pilote Metz)

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
| KYC / vérification d'identité | **non choisi** | `mock` |
| Signature électronique du bail | DocuSign | `mock` en dev, sandbox en staging |
| Paiement (abonnements, honoraires) | Stripe | `mock` en dev, clés de test ensuite |
| Visio des visites à distance | non tranché (reco : Daily.co) | `mock` |

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
6. **Le design vient de la maquette.** `frontend/app/globals.css` reprend les
   valeurs exactes de `maquette_interface/` (bordeaux `#7a1f2b`, fond `#f2f1ed`,
   Space Grotesk + IBM Plex Mono). Ne pas improviser un autre style.

## Avancement

Ordre de construction imposé par [`docs/build-order.md`](docs/build-order.md) :
un écran doit être fonctionnel avant de passer au suivant.

| # | Écran | État |
|---|---|---|
| 1 | Recherche et fiche annonce (sans compte) | **fait** — accueil, résultats filtrés, fiche |
| 2 | Compte + espace propriétaire | à faire |
| 3 | Compte + dossier locataire | à faire |
| 4 | Candidature à un bien | à faire |
| 5 | Prise de RDV de visite | à faire |
| 6 | Génération de bail + signature | à faire |
| 7 | Paiement des honoraires | à faire |

Le schéma de base couvre déjà les sept étapes ; seuls les écrans et les services
de l'étape 1 sont construits.

## Dette connue

- `prisma` CLI tire `deepmerge-ts` signalé par `npm audit` (chaîne de
  développement uniquement, pas dans le runtime de l'API).
- Prisma signale que `package.json#prisma` sera retiré en Prisma 7 : à migrer
  vers `prisma.config.ts` lors du passage à Prisma 7.
- Pas d'authentification : l'écran 1 est public par conception. Le choix du
  mécanisme (session, JWT, fournisseur) est à trancher à l'étape 2.
