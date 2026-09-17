# DachGuard

Bot Discord + dashboard web pour ouvrir et fermer les salons du serveur de classe,
à la main ou selon l'horaire. Pensé pour un serveur qui accueille **plusieurs classes**
(3TIN et 4TIN) avec leurs rôles et leurs salons respectifs.

En ligne : `https://studio-dach.site/lock/` (Basic Auth) — en local : `http://localhost:3000/lock`.

## Ce que ça fait

- **Classes** — une classe = un nom, des rôles et des salons. Tout le reste s'appuie dessus :
  un clic ferme ou rouvre 3TIN sans toucher à 4TIN. Détection automatique des rôles et salons
  à partir de leurs noms (`3TIN`, `4TTI`, `(3ème)`…).
- **Verrouillage à la carte** — plusieurs salons × plusieurs rôles en une fois, en lecture seule
  ou en masquant complètement le salon (tickets), avec minuteur facultatif (« ferme 50 min »).
- **Planning hebdomadaire** — plusieurs jours par créneau, créneaux qui passent minuit
  (22h → 7h), vue calendrier de la semaine.
- **Rien ne se perd au redémarrage** — token, classes, créneaux, verrous en cours et
  permissions d'origine sont sur le disque. Au réveil, le bot recalcule ce qui devrait être
  fermé et rattrape ce qu'il a manqué.
- **Retour à l'état initial** — avant chaque verrou, les permissions du rôle sur le salon sont
  photographiées ; la réouverture les restitue exactement (et non « autorisé pour tout le monde »).
- **Commandes Discord** — `/lock`, `/unlock`, `/statut`, réservées à ceux qui peuvent gérer les salons.
- **Diagnostic** — « Vérifier les fuites » liste les rôles qui garderaient la parole malgré le
  verrou (autorisation explicite sur le salon, ou rôle administrateur).
- **Journal** — qui a fermé quoi, quand, et à quel titre (manuel, planning, minuteur, commande).

## Installation

```bash
npm install
node index.js          # PORT=3000 BASE_PATH=/lock par défaut
```

Au premier lancement, collez le token du bot dans **Réglages → Connexion**. Il est enregistré
dans `data/state.json` (fichier en 0600, ignoré par git) et réutilisé aux démarrages suivants.
Variante : la variable d'environnement `DISCORD_TOKEN` a priorité.

### Côté Discord

Permissions nécessaires : `Gérer les rôles`, `Gérer les salons`, `Voir les salons`, `Envoyer des messages`.
Le rôle du bot doit être **au-dessus** des rôles qu'il doit verrouiller (le dashboard signale
ceux qui sont hors de portée). Pour les commandes slash, invitez-le avec le scope
`applications.commands` :

```
https://discord.com/api/oauth2/authorize?client_id=TON_CLIENT_ID&permissions=268453904&scope=bot%20applications.commands
```

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/store.js` | état persistant (`data/state.json`), écriture atomique, journal |
| `src/permissions.js` | traduction « verrouiller » → overwrites Discord, et l'inverse |
| `src/bot.js` | connexion, verrouillage/déverrouillage, diagnostic, commandes slash |
| `src/groups.js` | les classes et leur détection automatique |
| `src/scheduler.js` | créneaux hebdomadaires + réconciliation |
| `src/server.js` | API HTTP et service du dashboard |
| `public/` | dashboard (sans framework) |

### Comment le planning s'applique

Pas de `cron` : toutes les 30 secondes, le bot compare **l'état voulu** (les créneaux actifs
qui couvrent l'instant présent, fuseau `Europe/Brussels`) à **l'état réel** et corrige la
différence. Un redémarrage à 23h pendant un créneau 22h → 7h re-verrouille immédiatement ;
un créneau supprimé pendant qu'il était actif rouvre tout seul.

## Tests

```bash
node test/demo.js        # dashboard rempli, sans Discord (port 3999)
node test/render-check.js # passe toutes les vues sur un état réel, sans navigateur
```

## Déploiement (VPS studio-dach.site)

```bash
ssh songon@217.154.117.102
cd ~/DachGuard/BotDiscord-Lock && git pull && npm install --omit=dev
pm2 restart dachguard && pm2 logs dachguard --lines 30
```
