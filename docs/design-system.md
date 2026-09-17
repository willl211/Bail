# Design system et direction visuelle

## Source de vérité

La structure, les typographies et les composants partent de la maquette **Claude Design**. La palette a été révisée à la demande du porteur du projet le **7 septembre 2026** : une ambiance plus claire, inspirée du sud de la France et de l’Italie, en accord avec la maison en coupe de l’accueil. Cette palette remplace les couleurs de la maquette antérieure.

## Palette méditerranéenne actuelle

| Rôle | Couleur | Usage |
|---|---|---|
| Crème | `#f5f1e7` | Fond général et barre du navigateur |
| Ivoire | `#fffcf5` | En-tête, cartes et champs |
| Pierre claire | `#f6f5f0` | Section maison, assortie au fond de l’image |
| Beige sable | `#f0e5d3` | Panneau du parcours propriétaire |
| Sauge | `#e8eddc` | Registre d’accueil et bandeau d’activité |
| Olive | `#5e6a36` | Actions, sélection, liens et focus |
| Olive profond | `#49562f` | Titres et petits textes accentués |
| Chêne | `#785839` | Repères, numéros et détails éditoriaux |
| Herbe | `#6f843f` | Barres et points graphiques, jamais les petits textes |

Les couleurs sont centralisées dans `frontend/app/globals.css`. Les encres secondaires restent suffisamment foncées pour être lisibles sur les fonds beige et sauge. Les états d’attente et d’erreur conservent leurs couleurs sémantiques.

Le site reste **clair même lorsque le système est en mode sombre**. Le CSS, les métadonnées du navigateur et le visuel de la maison utilisent tous cette même direction. Le contraste des boutons crème sur olive est d’environ **5,7:1**.

Vérification visuelle effectuée sur l’application locale : accueil et maison sur ordinateur/mobile, recherche et dossier visiteur. Les textes secondaires, labels, badges et boutons contrôlés passent le seuil de contraste de 4,5:1. La préférence système sombre charge bien la même palette et la même image claire.

## Principes de structure conservés

- **Sobre et chaleureux**, ancré dans l’immobilier, avec des statuts lisibles et des actions clairement identifiées.
- Alignements précis, filets fins aux tons de pierre et données affichées en monospace (surface, prix, statuts). Depuis le 17 septembre, Newsreader compose les grands titres et DM Sans le contenu. La maison apporte les matières et le relief ; la palette prolonge ses couleurs.
- Animations et micro-interactions **délibérées, pas systématiques** : une entrée en fondu au chargement, des cartes qui réagissent au survol, des badges de statut/vérification qui s'animent à l'apparition, un compteur animé pour une statistique clé (ex. nombre de biens vérifiés). Éviter l'animation générique sur chaque élément (fade-in-up sur toutes les sections) qui donne un rendu "généré".
- Format : web responsive uniquement, pas de version native au MVP.

## Typographie — évolution du 17 septembre 2026

- **Newsreader** : titres de pages, accueil, sections éditoriales, présentation
  propriétaire et fiche logement. Graisse 500, empattements doux, espacement
  légèrement resserré et interlignes plus ouverts que l’ancienne Archivo condensée.
- **DM Sans** : paragraphes, navigation, boutons, formulaires et petites rubriques.
  Les écrans de gestion conservent ainsi une lecture rapide.
- **IBM Plex Mono** : montants, surfaces, références et repères chiffrés conservés.

Les fichiers WOFF2 et leurs licences sont intégrés dans `frontend/app/fonts`.
Les anciens réglages de chasse `wdth` propres à Archivo sont retirés. Les titres
gardent une taille fluide et des retours à la ligne équilibrés. Les couleurs,
la maison et les parcours ne changent pas avec cette évolution.

La compilation et le contrôle du chargement des ressources complètent cette
intégration ; ils ne remplacent pas une recette visuelle. La seconde passe du
17 septembre adapte le menu, les filtres, les panneaux, les tableaux et les
formulaires aux petits écrans dans `frontend/app/responsive.css`. La **recette
visuelle du mobile** reste à faire : tous les rôles, largeurs 320 à 430 px,
clavier ouvert et tests sur téléphone. Voir `frontend-finishing.md`.
Aucun navigateur pilotable n’était disponible lors de cette passe. Compilation
frontend et lint validés ; accueil, recherche, connexion et inscriptions répondent
en HTTP 200. Les cinq fichiers WOFF2 sont bien servis par le site local et leur
format a été vérifié, sans requête du site vers Google Fonts.

## Ce qu'il faut éviter (retours explicites du porteur de projet)

- Rendu "site à l'ancienne", statique, sans détail ni mouvement.
- Style SaaS générique sans personnalité (cartes identiques, ombre grise systématique).
