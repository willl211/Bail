CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOUSE');
ALTER TABLE "properties" ADD COLUMN "propertyType" "PropertyType";

-- Seules les annonces identifiables du jeu de démonstration sont des appartements
-- connus. Les autres biens restent sans type jusqu'à une saisie du propriétaire.
UPDATE "properties" AS p SET "propertyType" = 'APARTMENT'
FROM "users" AS u
WHERE p."ownerId" = u.id AND u.email = 'proprietaire.demo@bail.local'
  AND (p.reference, p.title) IN (
    ('MZ-0142', 'Studio meublé, Centre-ville'),
    ('MZ-0155', '3 pièces, Sablon'),
    ('MZ-0161', '2 pièces, Nouvelle Ville'),
    ('MZ-0168', 'Studio, Outre-Seille'),
    ('MZ-0173', '2 pièces meublé, Centre-ville'),
    ('MZ-0180', '3 pièces, Queuleu'),
    ('MZ-0186', 'T1 bis meublé, Nouvelle Ville'),
    ('MZ-0191', '2 pièces, Devant-les-Ponts')
  );
