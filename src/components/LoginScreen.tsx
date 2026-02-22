import { useState, useEffect, useCallback } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { QRAuth, type QRAuthEvent } from "../qr-auth";
import { saveToken } from "../config";
import qrcode from "qrcode";

interface LoginScreenProps {
    onToken: (token: string) => void;
}

/**
 * Login screen that drives the Discord Remote Auth QR flow:
 *  1. Connects to Discord's remote-auth WebSocket gateway
 *  2. Renders a QR code for the user to scan with their Discord mobile app
 *  3. Decrypts and saves the token once approved
 */
export function LoginScreen({ onToken }: LoginScreenProps) {
    const renderer = useRenderer();
    const [status, setStatus] = useState("Starting...");
    const [qrLines, setQrLines] = useState<string[]>([]);
    const [scannedBy, setScannedBy] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useKeyboard(
        useCallback(
            (key) => {
                if (key.ctrl && key.name === "c") {
                    renderer.destroy();
                    process.exit(0);
                }
                return true;
            },
            [renderer]
        )
    );

    useEffect(() => {
        const auth = new QRAuth();

        auth.on("event", async (ev: QRAuthEvent) => {
            switch (ev.type) {
                case "status":
                    setStatus(ev.message);
                    break;

                case "qr": {
                    try {
                        const str = await qrcode.toString(ev.url, {
                            type: "utf8",
                            errorCorrectionLevel: "L",
                        });
                        setQrLines(str.split("\n"));
                    } catch {
                        setStatus("Failed to render QR code");
                    }
                    break;
                }

                case "scanned":
                    setScannedBy(ev.username);
                    setQrLines([]);
                    setStatus(`Scanned by ${ev.username} — confirm on mobile...`);
                    break;

                case "token":
                    setDone(true);
                    setQrLines([]);
                    saveToken(ev.token);
                    setStatus("✓ Logged in! Connecting to tinycord...");
                    setTimeout(() => onToken(ev.token), 600);
                    break;

                case "error":
                    setError(ev.message);
                    setStatus(`✗ ${ev.message}`);
                    break;

                case "cancelled":
                    setStatus("Cancelled by mobile. Restart to try again.");
                    break;
            }
        });

        auth.start();

        return () => {
            auth.stop();
        };
    }, [onToken]);

    return (
        <box flexGrow={1} flexDirection="column" paddingX={2} paddingY={1}>
            <ascii-font text="tinycord" font="tiny" />
            <text>{" "}</text>

            <text fg={error ? "red" : done ? "#7ee787" : "#58a6ff"}>
                {status}
            </text>

            {qrLines.length > 0 && (
                <>
                    <text>{" "}</text>
                    {qrLines.map((line, i) => (
                        <text key={i}>{line}</text>
                    ))}
                    <text>{" "}</text>
                    <text fg="gray">Scan with Discord mobile app → Profile → Scan QR Code</text>
                </>
            )}

            {scannedBy && !done && (
                <>
                    <text />
                    <text fg="#faa61a">⚡ {scannedBy} scanned — please confirm on your phone</text>
                </>
            )}

            <text>{" "}</text>
            <text fg="gray">Ctrl+C to quit</text>
        </box>
    );
}
