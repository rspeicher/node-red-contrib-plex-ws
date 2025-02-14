const EventEmitter = require('events');
const WebSocket = require('ws');

const NOTIFICATION_TYPE_PLAYING = 'playing';

function notification(payload) {
    return !!payload && payload['NotificationContainer'];
}

class PlexSocket extends EventEmitter {
    constructor({
        hostname,
        port = 32400,
        token,
        secure = false,
        pingInterval = 10000,
        pingTimeout = 5000,
        reconnectInterval = 10000,
        reconnectMaxRetries = Infinity,
        autoConnect = true
    }={}) {
        super();

        this.hostname = hostname;
        this.port = port;
        this.token = token;
        this.secure = secure;
        this.pingInterval = pingInterval;
        this.pingTimeout = pingTimeout;
        this.reconnectInterval = reconnectInterval;
        this.reconnectMaxRetries = reconnectMaxRetries;
        this.autoConnect = autoConnect;

        this.shouldClose = false;
        this.retries = 0;
        this.socket = null;
        this.pinger = null;
        this.awaitPong = null;

        if (this.autoConnect) {
            this.connect();
        }
    }

    buildAddress() {
        const protocol = this.https ? 'wss' : 'ws';
        return `${protocol}://${this.hostname}:${this.port}/:/websockets/notifications`;
    }

    connect() {
        if (this.retries++ >= this.reconnectMaxRetries) {
            this.emit('reconnect-max-retries', this.reconnectMaxRetries);
        }

        try {
            const protocol = { headers: { 'X-Plex-Token': this.token } };
            this.socket = new WebSocket(this.buildAddress(), protocol);
        } catch (err) {
            this.onClose(err);
            throw err;
        }

        this.socket.on('open', data => this.onOpen(data));
        this.socket.on('ping', (data) => this.onPing(data));
        this.socket.on('pong', (data) => this.onPong(data));
        this.socket.on('message', data => this.onMessage(data));
        this.socket.on('error', err => this.onError(err));
        this.socket.on('unexpected-response', (req, res) => this.onUnexpectedResponse(req, res));
        this.socket.on('close', (code, reason) => this.onClose(code, reason));
    }

    close() {
        this.shouldClose = true;
        this.socket.close();
        this.socket = null;
    }

    parseData(data) {
        try {
            return JSON.parse(data);
        } catch (err) {
            return this.emit('error', err);
        }
    }

    get isReady() {
        return this.socket && this.socket.readyState === WebSocket.OPEN && !this.shouldClose;
    }

    ping() {
        if (this.isReady) {
            this.socket.ping('Hi?');
            this.awaitPong = setTimeout(() => {
                this.emit('pong-timeout');
                this.socket.terminate();
            }, this.pingTimeout);
        }
    }

    onOpen(data) {
        this.retries = 0;
        this.emit('open', data);
        this.ping();
    }

    onClose(code, reason) {
        if (this.pinger) {
            clearTimeout(this.pinger);
            this.pinger = null;
        }

        if (this.awaitPong) {
            clearTimeout(this.awaitPong);
            this.awaitPong = null;
        }

        if (!this.shouldClose) {
            setTimeout(() => this.connect(), this.reconnectInterval);
        } else {
            this.emit('close', code, reason);
        }
    }

    onPing() {
        if (this.isReady) {
            // received ping from plex, be kind and say hi back
            // also, plex kills the connection if you don't do this
            this.socket.pong('Hi!');
        }
    }

    onPong() {
        if (this.awaitPong) {
            clearTimeout(this.awaitPong);
        }

        this.pinger = setTimeout(this.ping.bind(this), this.pingInterval);
        this.emit('pong');
    }

    onMessage(data) {
        const payload = this.parseData(data);

        if (payload) {
            this.emit('message', payload);

            const notif = notification(payload);
            !!notif && this.onNotification(notif);
        }
    }

    onNotification(notif) {
        this.emit('notification', notif);

        switch (notif.type) {
        case NOTIFICATION_TYPE_PLAYING:
            this.onPlaying(notif);
            break;
        }
    }

    onPlaying(notif) {
        const payload = notif['PlaySessionStateNotification'];

        if (payload && payload.length) {
            payload.forEach((playingNotif) => {
                this.emit('playing', playingNotif.state, playingNotif);
            });
        } else {
            this.emit('error', new Error('expected playing notification to have PlaySessionStateNotification'));
        }
    }

    onUnexpectedResponse(req, res) {
        if (res && res.statusCode == 401) {
            return this.emit('unauthorized'), req, res;
        }

        return this.emit('unexpected-response', req, res);
    }

    onError(err) {
        this.emit('error', err);
    }
}

module.exports = PlexSocket;
