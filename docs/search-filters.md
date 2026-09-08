# Filtres de recherche — septembre 2026

Le bandeau reprend la proposition validée : fond architectural clair dans l’en-tête, surfaces ivoire, sélections olive, pied de panneau sauge. L’image existante `whoma-owner-panel.webp` est réutilisée. Sur ordinateur, le panneau défile indépendamment si la hauteur disponible est insuffisante ; sur mobile et tablette, il se replie au-dessus des résultats.

## Critères

- `includeCharges` : activé par défaut, le budget compare loyer + charges. `false` compare le loyer hors charges. Les prix des annonces restent affichés charges comprises, avec une explication lorsque le budget est hors charges.
- `propertyType` : `APARTMENT` ou `HOUSE` ; paramètre absent pour tous les logements.
- Pièces : 1, 2 et 3 sont des nombres exacts (`minRooms` = `maxRooms`). « 4+ » pose uniquement `minRooms=4`.
- Surface, ameublement et quartiers conservent leur fonctionnement. Les compteurs de quartiers indiquent le total du quartier, indépendamment des autres critères.
- Aucun plafond par défaut. Un plafond explicite de 1 400 € reste un filtre ; le lien « Sans plafond » le retire.

Tous les critères se combinent dans l’URL. Une temporisation commune de 250 ms regroupe les mouvements des curseurs. Les choix discrets sont appliqués immédiatement. Changer un filtre remet la pagination au début ; réinitialiser conserve le tri et annule les modifications en attente.

## Données et vérification

La migration `20260907220000_property_type` ajoute une colonne nullable. Elle renseigne uniquement les huit appartements identifiables du compte de démonstration ; les autres annonces restent sans type, visible dans « Tous ». Le formulaire de dépôt et l’API propriétaire permettent de renseigner le type. Aucun bien ni compte n’est recréé.

La validation du booléen lit l’entrée brute : la conversion implicite de Nest interprète sinon la chaîne `false` comme vraie. Le harnais d’intégration utilise désormais la même option de conversion que l’application.

Les tests couvrent le budget avec et sans charges, les seuils, les types manquants, les pièces exactes et minimum, les combinaisons, la visibilité, les paramètres invalides, l’enregistrement du type, la réinitialisation et les réponses de navigation arrivant en retard. Le contrôle visuel utilise le site local aux largeurs 1440, 900, 390 et 320 px.
