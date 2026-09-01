# Design system et direction visuelle

## Source de vérité

La direction visuelle finale vit dans le projet **Claude Design** transféré par handoff — respecte ce design importé (couleurs, typographie, composants) pour tout écran déjà maquetté. Ce document sert de filet de sécurité pour les écrans qui n'auraient pas encore de maquette validée, ou pour comprendre l'intention derrière les choix.

## Principes retenus pendant l'exploration

- **Sobre et premium**, ancré dans l'immobilier, avec une touche technologique/IA assumée (dossiers vérifiés automatiquement, statuts affichés avec précision) — sans tomber dans le cliché "SaaS générique" (cartes identiques à coins arrondis, dégradés décoratifs, fond crème + accent terracotta).
- Direction explorée et appréciée : esthétique inspirée du **plan technique / registre cadastral** — hairlines, alignements précis, données affichées avec une typo monospace (surface, prix, statuts), reste du contenu en sans-serif nette. Palette sobre avec un seul accent fort (vert forêt ou bleu profond selon la version), pas de dégradé.
- Animations et micro-interactions **délibérées, pas systématiques** : une entrée en fondu au chargement, des cartes qui réagissent au survol, des badges de statut/vérification qui s'animent à l'apparition, un compteur animé pour une statistique clé (ex. nombre de biens vérifiés). Éviter l'animation générique sur chaque élément (fade-in-up sur toutes les sections) qui donne un rendu "généré".
- Format : web responsive uniquement, pas de version native au MVP.

## Ce qu'il faut éviter (retours explicites du porteur de projet)

- Rendu "site à l'ancienne", statique, sans détail ni mouvement.
- Style SaaS générique sans personnalité (cartes identiques, ombre grise systématique).
