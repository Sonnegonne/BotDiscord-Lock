# Discord Lock Bot
Bot Discord avec dashboard web pour verrouiller/déverrouiller des channels selon un planning ou immédiatement.

## Fonctionnalités

- **Dashboard web** sur `http://localhost:3000/lock`
- Connexion au bot via token
- Vue de tous les channels textuels du serveur (groupés par catégorie)
- **Lock / Unlock immédiat** avec un ou plusieurs channels
- **Planification hebdomadaire** : choisir le jour, l'heure de lock et d'unlock
- Message personnalisable envoyé dans le channel lors du lock
- Activation/désactivation des planifications sans les supprimer
- Notifications toast dans l'interface

## Installation

```bash
npm install
```

## Configuration

1. Va sur https://discord.com/developers/applications
2. Crée une nouvelle application → "Bot"
3. **Activer les intents** : `Server Members Intent` et `Message Content Intent`
4. Copie le token du bot
5. Invite le bot sur ton serveur avec les permissions :
   - `Manage Roles` (pour modifier les permissions)
   - `Send Messages`
   - `View Channels`

**URL d'invitation** (remplace `TON_CLIENT_ID`) :
```
https://discord.com/api/oauth2/authorize?client_id=TON_CLIENT_ID&permissions=268495872&scope=bot
```

## Démarrage

```bash
node index.js
```

Puis ouvre `http://localhost:3000/lock` dans ton navigateur.

1. Colle ton token bot dans le champ de connexion
2. Les channels de ton serveur apparaissent automatiquement
3. Configure tes planifications ou utilise les boutons de lock immédiat

## Notes importantes

- Le bot doit avoir un rôle **au-dessus** du rôle ciblé dans la hiérarchie des rôles Discord
- Les planifications sont en mémoire (perdues au redémarrage) — pour une persistance, ajoute une base de données
- Fuseau horaire : **Europe/Paris** (modifiable dans `src/scheduler.js`)
