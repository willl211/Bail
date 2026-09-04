-- Loyer charges comprises au moment de la mise de côté.
--
-- Sert de point de comparaison pour signaler une baisse à celui qui a
-- sauvegardé le bien : « moins cher qu'à votre passage » se mesure par rapport
-- à ce que cette personne-là a vu.
--
-- Ajoutée en trois temps plutôt qu'en une colonne obligatoire d'emblée : les
-- sauvegardes déjà en base n'ont pas de valeur à porter. Le loyer courant du
-- bien est la meilleure approximation disponible — elle ne déclenchera aucune
-- notification abusive, puisqu'une baisse se mesure *par rapport* à elle.
ALTER TABLE "saved_properties" ADD COLUMN "rentCentsAtSave" INTEGER;

UPDATE "saved_properties" AS s
SET "rentCentsAtSave" = p."rentCents" + p."chargesCents"
FROM "properties" AS p
WHERE p.id = s."propertyId";

ALTER TABLE "saved_properties" ALTER COLUMN "rentCentsAtSave" SET NOT NULL;
