// @ts-ignore
import WebSocket from "ws";
import { stockCache } from "./requests";

const FINNHUB_API_KEY = process.env.STOTRA_FINNHUB_API || "";

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const subscribedSymbols = new Set<string>();

function connect() {
	if (!FINNHUB_API_KEY) {
		console.log("[finnhub-ws] No API key, skipping WebSocket");
		return;
	}

	ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`);

	ws.on("open", () => {
		console.log("[finnhub-ws] Connected");
		// Re-subscribe to all symbols
		for (const sym of subscribedSymbols) {
			sendSubscribe(sym);
		}
	});

	ws.on("message", (data: WebSocket.Data) => {
		try {
			const parsed = JSON.parse(data.toString());
			if (parsed.type === "trade" && parsed.data) {
				for (const trade of parsed.data) {
					const symbol = trade.s;
					const price = trade.p;
					if (!symbol || !price) continue;

					// Update the cache with the real-time price
					const cacheKey = symbol + "-quote";
					const cached = stockCache.get(cacheKey) as any;
					if (cached && typeof cached === "object") {
						const previousClose = cached.regularMarketPreviousClose || price;
						const changePercent =
							previousClose === 0 ? 0 : ((price - previousClose) / previousClose) * 100;
						const updated = {
							...cached,
							regularMarketPrice: price,
							regularMarketChangePercent: changePercent,
						};
						stockCache.set(cacheKey, updated, 15);
					}
				}
			}
		} catch (e) {
			// ignore parse errors
		}
	});

	ws.on("error", (err: any) => {
		console.error("[finnhub-ws] Error:", err.message);
	});

	ws.on("close", () => {
		console.log("[finnhub-ws] Disconnected, reconnecting in 5s...");
		ws = null;
		reconnectTimer = setTimeout(connect, 5000);
	});
}

function sendSubscribe(symbol: string) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: "subscribe", symbol }));
	}
}

function sendUnsubscribe(symbol: string) {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: "unsubscribe", symbol }));
	}
}

/**
 * Subscribe to real-time trades for a symbol.
 * The cache will be updated automatically when trades arrive.
 */
export function subscribeToSymbol(symbol: string) {
	subscribedSymbols.add(symbol);
	sendSubscribe(symbol);
}

/**
 * Unsubscribe from real-time trades for a symbol.
 */
export function unsubscribeFromSymbol(symbol: string) {
	subscribedSymbols.delete(symbol);
	sendUnsubscribe(symbol);
}

// Auto-connect on import
connect();
