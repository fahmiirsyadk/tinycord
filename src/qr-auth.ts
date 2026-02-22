import { EventEmitter } from "events";
import { createHash, generateKeyPairSync, privateDecrypt } from "crypto";
import { constants as cryptoConstants } from "crypto";
import WebSocket from "ws";

/**
 * Discord Remote Auth QR Login
 * Implements the Remote Auth protocol used by discord.com when you click "Scan QR Code".
 * Gateway: wss://remote-auth-gateway.discord.gg/?v=2
 *
 * Flow:
 *  1. Generate RSA-2048 keypair
 *  2. Connect to gateway, receive "hello" → send "init" with public key
 *  3. Gateway sends "nonce_proof" → decrypt nonce, SHA-256 raw-url-base64, reply
 *  4. Gateway sends "pending_remote_init" with fingerprint → build QR URL
 *  5. User scans QR with Discord mobile → gateway sends "pending_ticket" + "pending_login"
 *  6. Exchange ticket at REST endpoint → receive encrypted_token → decrypt → done
 */

const REMOTE_AUTH_GATEWAY = "wss://remote-auth-gateway.discord.gg/?v=2";
const REMOTE_AUTH_LOGIN_URL = "https://discord.com/api/v9/users/@me/remote-auth/login";

export type QRAuthEvent =
    | { type: "status"; message: string }
    | { type: "qr"; url: string; fingerprint: string }
    | { type: "scanned"; username: string }
    | { type: "token"; token: string }
    | { type: "error"; message: string }
    | { type: "cancelled" };

export class QRAuth extends EventEmitter {
    private ws: WebSocket | null = null;
    private privateKey: string = "";
    private privateKeyDer: Buffer | null = null;
    private fingerprint: string = "";
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private stopped = false;

    override emit(event: "event", data: QRAuthEvent): boolean {
        return super.emit(event, data);
    }

    override on(event: "event", listener: (data: QRAuthEvent) => void): this {
        return super.on(event, listener);
    }

    private send(data: object) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    private status(message: string) {
        this.emit("event", { type: "status", message });
    }

    private fail(message: string) {
        this.emit("event", { type: "error", message });
        this.stop();
    }

    stop() {
        this.stopped = true;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    start() {
        this.stopped = false;

        this.status("Generating keys...");

        // Generate RSA-2048 keypair
        const { privateKey, publicKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
            publicKeyEncoding: { type: "spki", format: "der" },
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
        });

        this.privateKey = privateKey;
        this.privateKeyDer = publicKey;

        const encodedPublicKey = (publicKey as unknown as Buffer).toString("base64");

        this.status("Connecting to Discord auth gateway...");

        this.ws = new WebSocket(REMOTE_AUTH_GATEWAY, {
            headers: {
                Origin: "https://discord.com",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
        });

        this.ws.on("open", () => {
            this.status("Connected. Waiting for handshake...");
        });

        this.ws.on("close", (code: number, reason: Buffer) => {
            if (!this.stopped) {
                this.fail(`Connection closed (${code}: ${reason?.toString() || "unknown"})`);
            }
        });

        this.ws.on("error", (err: Error) => {
            this.fail(`WebSocket error: ${err.message}`);
        });

        this.ws.on("message", (raw: Buffer) => {
            let msg: any;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                return;
            }

            switch (msg.op) {
                case "hello": {
                    const interval = msg.heartbeat_interval ?? 41250;
                    this.heartbeatTimer = setInterval(() => {
                        this.send({ op: "heartbeat" });
                    }, interval);

                    this.status("Handshaking...");
                    this.send({ op: "init", encoded_public_key: encodedPublicKey });
                    break;
                }

                case "nonce_proof": {
                    try {
                        const encNonce = Buffer.from(msg.encrypted_nonce, "base64");
                        const decrypted = privateDecrypt(
                            {
                                key: this.privateKey,
                                padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
                                oaepHash: "sha256",
                            },
                            encNonce
                        );
                        // SHA256 the decrypted nonce, then base64url-encode (no padding)
                        const proof = createHash("sha256")
                            .update(decrypted)
                            .digest("base64url");

                        this.send({ op: "nonce_proof", proof });
                    } catch (e: any) {
                        this.fail(`Nonce decryption failed: ${e.message}`);
                    }
                    break;
                }

                case "pending_remote_init": {
                    this.fingerprint = msg.fingerprint;
                    const qrUrl = `https://discord.com/ra/${msg.fingerprint}`;
                    this.status("QR code ready — scan with Discord mobile app");
                    this.emit("event", { type: "qr", url: qrUrl, fingerprint: msg.fingerprint });
                    break;
                }

                case "pending_ticket": {
                    try {
                        const payload = Buffer.from(msg.encrypted_user_payload, "base64");
                        const decrypted = privateDecrypt(
                            {
                                key: this.privateKey,
                                padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
                                oaepHash: "sha256",
                            },
                            payload
                        );
                        const parts = decrypted.toString().split(":");
                        const username = parts[3] ?? parts[0] ?? "user";
                        this.emit("event", { type: "scanned", username });
                        this.status(`Scanned by ${username} — confirm on mobile...`);
                    } catch {
                        this.status("Mobile app scanned — waiting for approval...");
                    }
                    break;
                }

                case "pending_login": {
                    this.status("Exchanging token...");
                    this.exchangeTicket(msg.ticket).catch((e) => {
                        this.fail(`Token exchange failed: ${e.message}`);
                    });
                    break;
                }

                case "cancel": {
                    this.stopped = true;
                    this.emit("event", { type: "cancelled" });
                    this.stop();
                    break;
                }

                case "heartbeat_ack":
                    break;
            }
        });
    }

    private async exchangeTicket(ticket: string) {
        const res = await fetch(REMOTE_AUTH_LOGIN_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Origin: "https://discord.com",
                Referer: `https://discord.com/ra/${this.fingerprint}`,
            },
            body: JSON.stringify({ ticket }),
        });

        if (!res.ok) {
            const body = await res.text();
            throw new Error(`HTTP ${res.status}: ${body}`);
        }

        const data = (await res.json()) as { encrypted_token?: string };
        if (!data.encrypted_token) {
            throw new Error("No encrypted_token in response");
        }

        const encToken = Buffer.from(data.encrypted_token, "base64");
        const token = privateDecrypt(
            {
                key: this.privateKey,
                padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
            },
            encToken
        );

        this.emit("event", { type: "token", token: token.toString() });
        this.stop();
    }
}
