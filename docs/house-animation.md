# Maison de l’accueil

La section `PlanWalkthrough` remplace le plan technique par une maison contemporaine fictive en coupe : pierre claire, bois, cuisine sauge et pièces meublées.

## Fonctionnement

- Rendu architectural pré-calculé, avec six cadrages par translation et zoom CSS au défilement. Il ne s’agit pas d’un modèle 3D avec caméra libre.
- Les boutons permettent de rejoindre chaque étape. Un seul texte d’étape est affiché dans le mode animé ; les liens rejoignent les routes existantes.
- Le navigateur anime l’image avec une timeline CSS. IntersectionObserver synchronise le texte aux changements d’étape ; aucun gestionnaire de scroll permanent ni boucle de rendu JavaScript.
- Le parcours complet reste présent côté serveur, sans JavaScript, sur petit écran, lorsque les animations sont réduites, lorsque les API nécessaires ne sont pas prises en charge, ou si l’image ne charge pas.
- Depuis la palette méditerranéenne demandée le 7 septembre 2026, l’image claire est utilisée sur tous les appareils, en accord avec le thème clair du site. Le fichier sombre initial reste conservé mais n’est plus chargé.

## Fichiers

- Composant : [plan-walkthrough.tsx](../frontend/components/plan-walkthrough.tsx).
- Styles : [globals.css](../frontend/app/globals.css), règles `house-walkthrough`.
- Asset clair : [whoma-house-cutaway.webp](../frontend/public/images/whoma-house-cutaway.webp), 1536 × 1024, environ 322 Kio.
- Asset sombre initial, conservé sans être chargé : [whoma-house-cutaway-dark.webp](../frontend/public/images/whoma-house-cutaway-dark.webp), 1536 × 1024, environ 517 Kio.
- Tests : [plan-walkthrough.spec.tsx](../frontend/components/plan-walkthrough.spec.tsx).

Aucune dépendance ajoutée. Images générées avec l’outil ImageGen intégré, puis converties en WebP avec Sharp. La demande initiale d’alpha n’a pas été respectée par le générateur ; les versions livrées utilisent volontairement des fonds opaques. La variante intermédiaire à damier n’est pas utilisée.

## Vérifications

- Compilation de production Next.js et contrôle TypeScript réussis.
- Lint du frontend réussi ; 117 tests frontend réussis, dont 7 consacrés au parcours.
- Aperçus locaux du composant vérifiés dans Chrome sans interface : 1366 × 768, 1366 × 660, 800 × 700 et 390 × 844, thèmes clair/sombre et préférence de mouvement réduit.
- Six cadrages et textes concordants ; navigation directe par bouton vérifiée ; aucun débordement horizontal ni exception JavaScript constaté.
- Vérification visuelle isolée avec les styles et le composant réels, les primitives Next Image/Link remplacées par leurs éléments HTML dans l’aperçu. La compilation vérifie l’intégration Next ; les parcours avec le backend n’ont pas été relancés.

## Prompts de génération

### Image initiale (version sombre)

```text
Use case: stylized-concept, photorealistic architectural visualization.
Asset type: high resolution standalone house image for a French rental website, animated by panning and zooming at scroll. NOT a website mockup. No interface.
Primary request: Create one fictional contemporary French family house as a stunning highly realistic architectural cutaway rendering. The roof is cleanly removed over most rooms to reveal a believable, beautifully furnished interior. This must read as a REAL BUILDABLE HOME with rich physical materials, not a flat blueprint, a diagram, a toy or low-poly model.
Composition: landscape 3:2 image, entire house and its small landscaped plot fully visible with a small clear margin, elevated three-quarter architectural camera looking toward the front and right side, high enough to see all rooms clearly. The house occupies about 88% of the frame. One coherent single-storey dwelling, with a small gabled roof remaining over a rear entry volume. On the left/front is a generous sunlit living room with a cream linen sofa, oak coffee table and woven rug opening onto a stone terrace; behind it is an open kitchen with muted sage green cabinetry, a travertine island and oak dining table. On the right are two distinct bedrooms with linen bedding and a smaller limestone bathroom. At the front middle is a recognizable solid oak front door and a stone path. Low cut walls on camera-facing sides expose room interiors; back and side facades retain full height and beautiful large glass windows with slender bronze frames. A small lawn, ornamental grasses and one airy mature tree anchor the house in a real environment.
Materials and lighting: warm limestone/stucco walls, real oak grain, softly textured textiles, detailed brushed metal, physically plausible glass, natural late-afternoon sunlight, soft ambient occlusion, restrained warm interiors. Premium architectural visualization quality, photoreal path traced rendering, everything crisp and coherent, deep focus, realistic proportional furniture, elegant and calm.
Background: genuine transparent alpha background outside the small cutout landscaped plot, including transparent space around tree leaves. Natural subtle ground contact shadow only. This image will sit on both warm ivory and dark charcoal website backgrounds, so no baked-in white rectangle and no white halo.
No text, no numbers, no labels, no measurement lines, no arrows, no people, no watermarks, no UI, no exploded floating roof.
```

### Adaptation du fond (version claire)

Référence : l’image initiale.

```text
Edit this house rendering. Preserve the exact building, floor plan, furniture, garden, tree, camera angle and sunlight. Replace ONLY the dark blurred background surrounding the plot and tree with a perfectly flat, uniform, matte warm ivory background, RGB 246 245 240, hex #f6f5f0. Completely opaque solid ivory, no gradient, no checkerboard, no transparency, no dark vignette, no blurred environment. Keep the house and garden crisp and untouched. Leave a small clean ivory margin around the entire subject, including the tree. No text.
```
