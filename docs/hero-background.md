# Fond architectural du bandeau d’accueil

Le fond du bloc « Le dossier une fois. La candidature en un clic. » reprend les matières de la maison : mur de pierre claire, pergola en bois et olivier. Il couvre toute la largeur du bandeau, y compris la recherche et le registre de chiffres. Un voile clair préserve la lisibilité ; le recadrage est adapté au mobile.

- Fichier : [whoma-mediterranean-hero.webp](../frontend/public/images/whoma-mediterranean-hero.webp), **1983 × 793**, environ **175 Kio**.
- Créé avec **ImageGen intégré**, puis converti en WebP avec Sharp. Aucun prestataire ou bibliothèque supplémentaire.
- Image décorative ignorée par les lecteurs d’écran, optimisée avec Next Image, chargée dès l’ouverture. Sur mobile, une source plus grande conserve le détail malgré le recadrage vertical de `object-fit: cover`.
- L’accueil demande désormais **4 annonces** à l’API existante. La grille les dispose sur 4 colonnes, 2 sous 1100 px et 1 sous 600 px ; elle conserve les liens et les sauvegardes existants.
- Vérification sur le site local à 1920, 1440, 900 et 390 px : fond chargé, 4 annonces distinctes, aucune exception JavaScript ni débordement horizontal observé.

### Prompt du fond (ImageGen intégré)

```text
Use case: photorealistic-natural.
Asset type: one standalone architectural background photograph / photoreal 3D render for a French rental website hero. This is an image asset only, not a website mockup.
Create an elegant sunlit Mediterranean house terrace in the South of France / northern Italy, with the same material world as a realistic architectural cutaway house: warm ivory limestone plaster, pale travertine paving, honey-coloured oak, restrained sage green details, olive trees, ornamental grass. Architectural visualization with realistic tactile materials and physically plausible late-afternoon light.
Composition: very wide horizontal landscape, ideally 2560 x 1024 (5:2). The scene must work as the full background behind a large headline, search form and a compact information panel. The LEFT TWO THIRDS of the image are a beautiful near-flat pale limestone plaster wall with subtle authentic texture and exceptionally quiet low-contrast lighting: plenty of real negative space for dark olive text. Very subtle soft olive-leaf shadows touch the bottom left edge but do NOT create dark patterns across the left centre. The RIGHT THIRD opens into a convincing terrace and garden: one warm oak pergola edge, a limestone corner with a slender bronze-framed glazed door, an olive tree and low meadow grasses, a little stone paving across the bottom. Keep recognizable wood and greenery around the far right and lower right edges. A continuous pale stone ground band along the bottom completes the architecture. No dramatic perspective, no large furniture, no objects or dark lines in the central text zone.
Mood: warm, airy, quiet, sophisticated, natural Mediterranean morning. Gentle soft shadows, realistic materials, editorial architectural photography quality, deep focus, believable buildable architecture. Palette pale cream, light beige limestone, warm wood, olive leaves and grass. Background is fully opaque and fills the image edge to edge. No border.
No text, no UI, no lettering, no logos, no people, no watermarks, no blueprint grid, no miniature house, no cutaway dollhouse in this background, no beach or swimming pool.
```

