# Fond du cadre propriétaire

Le cadre « Décrivez le bien / Recevez des dossiers vérifiés / Signez le bail en ligne » utilise un intérieur méditerranéen lumineux : mur en pierre claire, encadrement en chêne et ouverture sur un jardin d’oliviers. Le voile clair conserve la lisibilité des trois étapes.

- Asset : [whoma-owner-panel.webp](../frontend/public/images/whoma-owner-panel.webp), **1672 × 941**, environ **92 Kio**.
- Créé avec **ImageGen intégré**, puis converti en WebP avec Sharp.
- Intégration dans [page.tsx](../frontend/app/page.tsx), styles `owner-pitch__steps` et `owner-pitch__image` dans [globals.css](../frontend/app/globals.css).
- Image décorative avec un texte alternatif vide, chargée à l’approche du cadre et optimisée par Next Image. Le fond beige reste disponible avant son chargement.
- Les trois étapes restent du texte HTML. Le visuel et son voile n’interceptent pas les interactions.
- Vérifié sur le site local à 1440 et 390 px : image chargée, trois étapes lisibles, aucun débordement horizontal ni exception JavaScript. Contrôle TypeScript et lint de la page réussis.

## Prompt utilisé

```text
Use case: photorealistic-natural.
Asset type: a standalone decorative background image for a website panel containing three rows of text. Image only, no interface.
Create a beautiful photoreal architectural interior detail of a fictional Mediterranean home, matching a house with pale limestone plaster, warm oak, travertine paving and an olive garden. Wide horizontal 16:9 composition, ideally 1920x1080.
The entire LEFT 80 PERCENT is an uninterrupted warm pale ivory limewashed wall with fine, realistic tactile plaster texture, evenly and softly lit, exceptionally low contrast and ample quiet negative space behind text. Subtle soft olive-leaf shadows can touch the lower left corner. The FAR RIGHT EDGE contains a narrow natural oak door/window frame opening onto soft olive foliage and sunlit meadow grasses outside, with a small glimpse of warm stone paving along the lower edge. The view feels like an inviting home interior looking toward a garden. Keep the recognizable wood grain and olive greenery concentrated at the far right and lower right edges so text can extend across almost the entire image without clashing. No furniture in the centre, no wall decorations, no seams or dark shadows cutting through the text area.
Lighting: soft Mediterranean late-afternoon light, warm but not orange, gentle natural shadows. Style: premium realistic 3D architectural rendering / editorial architecture photography, coherent real proportions, clear fine material detail, calm and airy. Colors: very light limestone beige, warm ivory, honey oak, olive and sage greens.
Fully opaque edge-to-edge image. No typography, no numbers, no lettering, no logo, no watermark, no UI, no people, no blueprints, no dramatic contrast, no dark room.
```
