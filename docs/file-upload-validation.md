# Validation des fichiers déposés — 13 septembre 2026

Le contrôle s'exécute dans `StorageService.save`, avant toute écriture sur disque
ou S3. Il couvre les photos d'annonces, les diagnostics et les pièces du dossier
locataire. Aucune migration ni nouvelle clé de prestataire n'est nécessaire.
Les fichiers déjà stockés ne sont pas retraités automatiquement.

## Contrôles communs

- La signature des octets doit correspondre au type MIME annoncé et à un format
  autorisé pour ce dépôt : JPEG, PNG, WebP, et PDF pour les documents.
- Un nom de fichier ne détermine jamais le format stocké. La clé est un UUID avec
  l'extension du format vérifié. La taille enregistrée est celle des octets stockés.
- Les bornes HTTP restent 8 Mio pour une photo, 10 Mio pour une pièce locataire,
  15 Mio pour un diagnostic ; le stockage impose également une borne réelle de 15 Mio.
- Une erreur renvoie un code stable et un message français, affiché par les formulaires
  existants. Les erreurs internes des parseurs ne sont pas exposées à l'utilisateur.

## PDF

Le contrôle vérifie l'en-tête, la fin du fichier, la lecture de sa structure et des
pages avec PDF-LIB, les références d'objets et la décompression des flux de contenu
des pages. Les PDF protégés par mot de passe, les structures invalides, les pièces
jointes et certaines actions actives (JavaScript, lancement de programme, etc.) sont
refusés. Un PDF doit contenir entre 1 et 100 pages ; les flux des pages décompressés
sont limités à 32 Mio au total.

Le PDF accepté est conservé **octet pour octet** : aucune réécriture susceptible
d'altérer l'original ou une signature déjà présente. Ce contrôle structurel ne rend
pas chaque page, ne certifie pas la validité d'une signature et ne prouve pas que le
document est authentique. Un document lisible peut encore nécessiter un refus humain.
L'analyse IA des bulletins conserve sa limite distincte de 8 Mio et 10 pages.

## Images

Sharp vérifie les métadonnées puis décode réellement les pixels. Une image tronquée,
illisible, animée ou dépassant 25 millions de pixels est refusée. Les animations APNG
sont détectées aussi dans les chunks PNG, sans se limiter à leur première image.

Les photos publiques sont réencodées dans le même format, en appliquant l'orientation,
sans conserver EXIF, GPS ou données ajoutées après l'image. Les JPEG/WebP utilisent
une qualité de sortie de 95. Le fichier obtenu est limité à 15 Mio.
Pour les justificatifs privés, le décodage valide le format mais les octets originaux
sont conservés, y compris les métadonnées ; les droits privés restent appliqués.

## Charge, stockage et remplacement

Les parseurs travaillent dans des workers Node distincts du traitement principal des
requêtes. Deux validations simultanées au maximum par instance, avec un délai de
10 secondes et une limite du tas JavaScript du worker. Au-delà de la capacité, le
serveur répond 503 et invite à réessayer ; il n'accumule pas une file de buffers.
Ces limites ne sont pas un plafond mémoire global du processus, notamment pour les
allocations natives. Le contrôle n'est pas un antivirus ni une certification de sûreté
de tout contenu PDF embarqué.

Un refus de validation n'écrit ni fichier, ni nouvelle pièce, ni événement de contrôle,
ni analyse IA. Le diagnostic précédent reste disponible si le remplacement est refusé.
Un remplacement réussi supprime l'ancien fichier après la transaction ; une transaction
échouée supprime le nouveau fichier. Les suppressions existantes restent idempotentes.
Une panne de suppression du stockage est journalisée ; une file persistante de reprise
du nettoyage n'est pas ajoutée par cette étape.

## Vérification

Les tests utilisent des PDF et images générés, sans documents personnels : formats
valides, faux MIME, PDF tronqués/chiffrés/actifs, flux PDF invalides, images tronquées,
dimensions excessives, APNG, suppression des métadonnées publiques, délai et concurrence.
Les tests HTTP couvrent les trois parcours, l'absence d'écriture après refus, la taille
locataire, la préservation d'un ancien diagnostic et le nettoyage après remplacement
ou échec de transaction. Le contrôle admin et l'analyse IA restent testés ensemble.

Recette manuelle : déposer un PDF fictif valide, puis un texte renommé `.pdf` et une
image tronquée. Les deux derniers doivent être refusés sans perdre la pièce précédente
lors du remplacement d'un diagnostic. Une nouvelle photo valide doit rester visible.

Références techniques : [décodage Sharp](https://sharp.pixelplumbing.com/api-constructor/),
[sortie et métadonnées](https://sharp.pixelplumbing.com/api-output/),
[lecture PDF-LIB](https://pdf-lib.js.org/docs/api/classes/pdfdocument).
