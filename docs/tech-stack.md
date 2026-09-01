# Stack technique

Décisions validées par le porteur de projet — ne pas rouvrir ces choix sans raison forte.

## Stack

| Couche | Choix |
|---|---|
| Frontend web | Next.js / React |
| Backend | Node.js (NestJS) |
| Base de données | PostgreSQL |
| Mobile | Aucun natif au MVP — web responsive uniquement (décision réexaminée puis confirmée) |
| Hébergement | OVH (hébergeur français, utile pour la conformité RGPD sur des données sensibles) |
| Gestion de code | GitHub |
| Outil de suivi de projet | Pas de préférence exprimée — recommandation : Linear |
| Environnements | Dev / Staging / Production dès le départ |

## Structure de repo recommandée

Monorepo avec séparation claire frontend/backend :

```
/frontend      (Next.js)
/backend       (NestJS)
/docs          (ce dossier, à conserver dans le repo)
.env.example par environnement
README.md avec instructions de lancement local
```

## Design

Approche choisie : **maquettes complètes avant de coder**, réalisées dans Claude Design puis transférées via handoff. Respecte le design importé pour tous les écrans déjà maquettés. Voir `design-system.md` pour les principes directeurs si un écran n'a pas encore de maquette validée.
