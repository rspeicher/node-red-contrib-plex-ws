var utils = require('../lib/utils.js');

module.exports = function(RED) {
  class PlayingNode {
    constructor(config) {
      RED.nodes.createNode(this, config);

      this.filters = config.filters || [];
      this.filters.sort((a, b) => a.idx > b.idx ? 1 : a.idx < b.idx ? -1 : 0);

      this.server = RED.nodes.getNode(config.server);
      utils.bindStateHandlers(this, this.server);

      if (!this.plex) {
        utils.updateNodeStatusFailed(this, 'plex not configured');
        return;
      }

      this.begin();
    }

    get plex() {
      return !!this.server ? this.server.plex : null;
    }

    matchesFilters(session) {
        let match = true;

        this.filters.forEach((filter) => {
            let sessionValue = session;
            let filterValue = filter.value;
            let comparison;

            const keyParts = filter.key.split('.');
            keyParts.forEach((key) => {
                sessionValue = sessionValue[key];
            });

            switch (filter.valueType) {
                case 'str':
                    sessionValue = String(sessionValue);
                    filterValue = String(filterValue);
                    break;

                case 'num':
                    sessionValue = Number(sessionValue);
                    filterValue = Number(filterValue);
                    break;

                case 'bool':
                    sessionValue = Boolean(sessionValue);
                    filterValue = Boolean(filterValue);
                    break;
            }

            switch (filter.operator) {
                case 'eq':  comparison = filterValue == sessionValue; break;
                case 'neq': comparison = filterValue != sessionValue; break;
                case 'lt':  comparison = filterValue < sessionValue; break;
                case 'lte': comparison = filterValue <= sessionValue; break;
                case 'gt':  comparison = filterValue > sessionValue; break;
                case 'gte': comparison = filterValue >= sessionValue; break;
            }

            console.log(`evaluate ${filterValue} ${filter.operator} ${sessionValue}`);

            match = match && comparison;
        });

        return match;
    }

    begin() {
      this.plex.on('playing', (state, notification) => {
        const sessions = this.server.sessions;
        const sessionKey = notification['sessionKey'];

        sessions.fetch(sessionKey).then((session) => {
            const msg = {
                payload: state,
                plex: notification,
                session: session
            };

            if (session && session['prevState'] !== state) {
                if (this.matchesFilters(session)) {
                    this.send(msg);
                }

                session['prevState'] = state;
            }

            if (state === 'stopped') {
                sessions.delete(sessionKey);
            }
        }).catch((reason) => {
            this.warn(`failed to fetch session details from Plex: ${reason}`);
        });
      });
    }
  }

  RED.nodes.registerType('plex-ws-playing', PlayingNode);
};
