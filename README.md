# surveillance-applis

Surveillant de disponibilité des applis MonprojetPro (item T-092 du board foxeo-one, étage 1).

Toutes les 5 minutes, GitHub Actions appelle chaque adresse de `applis.json`. Si une appli
ne répond plus **deux fois de suite** (environ 10 minutes), une notification part sur le
téléphone via [ntfy](https://ntfy.sh). Une seconde notification part quand elle revient.

## Règle

Une lenteur n'est jamais une panne. Comptent comme panne : aucune réponse en 15 s,
injoignable, ou erreur serveur (5xx). Une redirection (3xx) ou un refus d'accès (4xx)
prouvent que l'appli est vivante.

## Ajouter une appli

Ajouter une ligne `{ "id", "nom", "url" }` dans `applis.json`. Rien d'autre à toucher.

## Pièces

| Fichier | Rôle |
|---|---|
| `applis.json` | La liste des applis surveillées |
| `surveiller.mjs` | Le script (aucune dépendance) |
| `surveiller.test.mjs` | Les tests (`node --test`), relancés à chaque passage |
| `etat/etat.json` | La mémoire d'un passage à l'autre (commitée seulement quand elle change) |
| `.github/workflows/surveillance.yml` | La planification toutes les 5 min |

Secret requis : `NTFY_TOPIC` (le nom du canal ntfy, long et aléatoire — quiconque le connaît
peut lire les alertes). Sans lui, le passage échoue et GitHub prévient par mail.

## Limites connues

- La planification de GitHub n'est pas à la minute près : un passage peut être retardé,
  voire sauté aux heures chargées. L'alerte peut donc arriver après 10 à 20 minutes.
- GitHub coupe la planification d'un dépôt public sans activité depuis 60 jours : le script
  écrit un « battement » dans l'état une fois par mois pour l'éviter.

Test manuel : onglet Actions → « Surveillance des applis » → Run workflow → cocher
« Envoyer une notification de test ».
