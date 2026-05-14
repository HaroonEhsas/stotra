import Cache from "node-cache";
import axios from "axios";
export const stockCache = new Cache({ stdTTL: 60 }); // default 1 min (historical data); quotes use explicit short TTL

import dotenv from "dotenv";
import { mirrorNvdaEpic } from "./mirrorConfig";
import {
	fetchIgHistoricalCandles,
	fetchIgQuoteForFrontend,
	isIgNvdaConfigured,
} from "./igClient";
dotenv.config();

const ALPHA_VANTAGE_API_KEY = process.env.STOTRA_ALPHAVANTAGE_API || "demo";
const FINNHUB_API_KEY = process.env.STOTRA_FINNHUB_API || "";

let finnhubDisabledUntilMs = 0;

function alphaVantageIsRateLimited(data: any): boolean {
	return Boolean(
		(data && typeof data === "object" && (data.Note || data.Information)) ||
		(data && typeof data === "string" && data.toLowerCase().includes("frequency")),
	);
}

function parseAlphaVantageChangePercent(value: any): number | null {
	if (typeof value !== "string") return null;
	const cleaned = value.replace("%", "").trim();
	const parsed = parseFloat(cleaned);
	return Number.isFinite(parsed) ? parsed : null;
}

async function finnhubQuote(symbol: string): Promise<{
	c: number;
	pc: number;
} | null> {
	if (!FINNHUB_API_KEY) return null;
	if (Date.now() < finnhubDisabledUntilMs) return null;
	try {
		const res = await axios.get("https://finnhub.io/api/v1/quote", {
			params: {
				symbol,
				token: FINNHUB_API_KEY,
			},
		});
		if (!res.data || typeof res.data.c !== "number" || res.data.c <= 0) {
			return null;
		}
		return { c: res.data.c, pc: res.data.pc };
	} catch (e: any) {
		if (e?.response?.status === 401) {
			// Invalid API key: stop calling Finnhub for a while
			finnhubDisabledUntilMs = Date.now() + 60 * 60 * 1000;
		}
		return null;
	}
}

async function yahooQuote(symbol: string): Promise<{
	price: number;
	previousClose: number;
	longName?: string;
} | null> {
	try {
		const res = await axios.get("https://query1.finance.yahoo.com/v7/finance/quote", {
			params: {
				symbols: symbol,
				_: Date.now(),
			},
			headers: { "User-Agent": "Mozilla/5.0" },
		});
		const result = res.data?.quoteResponse?.result?.[0];
		if (!result || typeof result !== "object") return null;

		const price =
			(typeof result.regularMarketPrice === "number" && result.regularMarketPrice) ||
			(typeof result.postMarketPrice === "number" && result.postMarketPrice) ||
			(typeof result.preMarketPrice === "number" && result.preMarketPrice) ||
			null;
		if (!price || !Number.isFinite(price) || price <= 0) return null;

		const previousClose =
			typeof result.regularMarketPreviousClose === "number" &&
			Number.isFinite(result.regularMarketPreviousClose) &&
			result.regularMarketPreviousClose > 0
				? result.regularMarketPreviousClose
				: price;

		const longName =
			typeof result.longName === "string" && result.longName.trim()
				? result.longName.trim()
				: typeof result.shortName === "string" && result.shortName.trim()
					? result.shortName.trim()
					: undefined;

		return { price, previousClose, longName };
	} catch (e) {
		return null;
	}
}

async function finnhubProfile(symbol: string): Promise<{ name?: string } | null> {
	if (!FINNHUB_API_KEY) return null;
	if (Date.now() < finnhubDisabledUntilMs) return null;
	const res = await axios.get("https://finnhub.io/api/v1/stock/profile2", {
		params: {
			symbol,
			token: FINNHUB_API_KEY,
		},
	});
	if (!res.data || typeof res.data !== "object") return null;
	return { name: res.data.name };
}

async function finnhubCandles(
	symbol: string,
	resolution: "1" | "5" | "15" | "30" | "60" | "D" | "W" | "M",
	fromSec: number,
	toSec: number,
): Promise<number[][] | null> {
	if (!FINNHUB_API_KEY) return null;
	if (Date.now() < finnhubDisabledUntilMs) return null;
	const res = await axios.get("https://finnhub.io/api/v1/stock/candle", {
		params: {
			symbol,
			resolution,
			from: fromSec,
			to: toSec,
			token: FINNHUB_API_KEY,
		},
	});
	const data = res.data;
	if (
		!data ||
		data.s !== "ok" ||
		!Array.isArray(data.t) ||
		!Array.isArray(data.o) ||
		!Array.isArray(data.h) ||
		!Array.isArray(data.l) ||
		!Array.isArray(data.c)
	) {
		return null;
	}
	const points: number[][] = [];
	for (let i = 0; i < data.t.length; i++) {
		// OHLC format for Highcharts candlestick: [time, open, high, low, close]
		points.push([
			data.t[i] * 1000,
			data.o[i],
			data.h[i],
			data.l[i],
			data.c[i],
		]);
	}
	return points;
}

function stooqSymbol(symbol: string): string {
	const s = symbol.trim().toLowerCase();
	// Stooq uses .us suffix for most US equities
	if (s.includes(".")) return s;
	return `${s}.us`;
}

async function stooqQuote(symbol: string): Promise<{
	price: number;
	previousClose: number;
} | null> {
	try {
		const s = stooqSymbol(symbol);
		// Close price, and previous close can be approximated by open/close history; here we use close and open.
		// Format: Symbol,Date,Time,Open,High,Low,Close,Volume
		const url = `https://stooq.com/q/l/?s=${encodeURIComponent(
			s,
		)}&f=sd2t2ohlcv&h&e=csv`;
		const res = await axios.get(url, { responseType: "text" });
		const lines = String(res.data || "")
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length < 2) return null;
		const parts = lines[1].split(",");
		// parts: [symbol,date,time,open,high,low,close,volume]
		if (parts.length < 7) return null;
		const open = parseFloat(parts[3]);
		const close = parseFloat(parts[6]);
		if (!Number.isFinite(close) || close <= 0) return null;
		return {
			price: close,
			previousClose: Number.isFinite(open) && open > 0 ? open : close,
		};
	} catch (e) {
		return null;
	}
}

async function stooqHistorical(
	symbol: string,
	days: number,
): Promise<number[][] | null> {
	try {
		const s = stooqSymbol(symbol);
		const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&d1=${new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, "")}&d2=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}&i=d`;
		const res = await axios.get(url, { responseType: "text" });
		const lines = String(res.data || "")
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length < 2) return null;
		// Header: Date,Open,High,Low,Close,Volume
		const points: number[][] = [];
		for (let i = 1; i < lines.length; i++) {
			const parts = lines[i].split(",");
			if (parts.length < 5) continue;
			const dateStr = parts[0];
			const o = parseFloat(parts[1]);
			const h = parseFloat(parts[2]);
			const l = parseFloat(parts[3]);
			const c = parseFloat(parts[4]);
			if (!Number.isFinite(c) || c <= 0) continue;
			// Parse date YYYY-MM-DD
			const ts = new Date(dateStr + "T00:00:00Z").getTime();
			if (!Number.isFinite(ts)) continue;
			points.push([ts, o, h, l, c]);
		}
		return points.length > 0 ? points.sort((a, b) => a[0] - b[0]) : null;
	} catch (e) {
		return null;
	}
}

async function yahooHistorical(
	symbol: string,
	range: string,
	interval: string,
): Promise<number[][] | null> {
	try {
		const res = await axios.get(
			`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
			{ headers: { "User-Agent": "Mozilla/5.0" } },
		);
		const result = res.data?.chart?.result?.[0];
		if (!result) return null;
		const timestamps = result.timestamp;
		const quote = result.indicators?.quote?.[0];
		if (!timestamps || !quote) return null;

		const points: number[][] = [];
		for (let i = 0; i < timestamps.length; i++) {
			const o = quote.open?.[i];
			const h = quote.high?.[i];
			const l = quote.low?.[i];
			const c = quote.close?.[i];
			if (
				typeof o !== "number" || typeof h !== "number" ||
				typeof l !== "number" || typeof c !== "number"
			) continue;
			points.push([timestamps[i] * 1000, o, h, l, c]);
		}
		return points.length > 0 ? points : null;
	} catch (e) {
		return null;
	}
}

export const fetchStockData = async (symbol: string): Promise<any> => {
	const upper = symbol.toUpperCase();
	if (upper === "NVDA" && isIgNvdaConfigured()) {
		const igCacheKey = upper + "-quote-ig";
		try {
			if (stockCache.has(igCacheKey)) {
				return stockCache.get(igCacheKey);
			}
			const igQuote = await fetchIgQuoteForFrontend(mirrorNvdaEpic());
			stockCache.set(igCacheKey, igQuote, 5);
			return igQuote;
		} catch (e) {
			console.warn("IG NVDA quote unavailable, falling back:", e);
		}
	}

	const cacheKey = symbol + "-quote";

	try {
		if (stockCache.has(cacheKey)) {
			return stockCache.get(cacheKey);
		}

		// Finnhub (preferred)
		const finnQuote = await finnhubQuote(symbol);
		if (finnQuote) {
			let longName = symbol;
			const overviewCacheKey = symbol + "-overview";
			if (stockCache.has(overviewCacheKey)) {
				longName = stockCache.get(overviewCacheKey) as string;
			} else {
				try {
					const profile = await finnhubProfile(symbol);
					if (profile?.name) {
						longName = profile.name;
						stockCache.set(overviewCacheKey, longName, 1800);
					}
				} catch (e) {
					// ignore
				}
			}

			const price = finnQuote.c;
			const previousClose = finnQuote.pc || price;
			const changePercent =
				previousClose === 0 ? 0 : ((price - previousClose) / previousClose) * 100;
			const stockData = {
				symbol,
				longName,
				regularMarketPrice: price,
				regularMarketPreviousClose: previousClose,
				regularMarketChangePercent: changePercent,
			};
			stockCache.set(cacheKey, stockData, 15);
			return stockData;
		}

		// Yahoo Finance (no key; often closer to live including extended hours)
		const yahoo = await yahooQuote(symbol);
		if (yahoo) {
			const price = yahoo.price;
			const previousClose = yahoo.previousClose || price;
			const changePercent =
				previousClose === 0 ? 0 : ((price - previousClose) / previousClose) * 100;
			const stockData = {
				symbol,
				longName: yahoo.longName || symbol,
				regularMarketPrice: price,
				regularMarketPreviousClose: previousClose,
				regularMarketChangePercent: changePercent,
			};
			stockCache.set(cacheKey, stockData, 15);
			return stockData;
		}

		// Alpha Vantage GLOBAL_QUOTE (fallback)
		const quoteRes = await axios.get(
			`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`,
		);
		if (alphaVantageIsRateLimited(quoteRes.data)) {
			throw new Error("Alpha Vantage rate limit reached");
		}

		const quote = quoteRes.data["Global Quote"];

		let price: number | null = null;
		let previousClose: number | null = null;
		let changePercent: number | null = null;
		let latestTradingDay: string | null = null;

		if (quote && quote["05. price"]) {
			price = parseFloat(quote["05. price"]);
			previousClose = parseFloat(quote["08. previous close"]);
			changePercent =
				parseAlphaVantageChangePercent(quote["10. change percent"]) ?? null;
			latestTradingDay =
				typeof quote["07. latest trading day"] === "string"
					? quote["07. latest trading day"].trim()
					: null;
		}

		// If Alpha Vantage data is delayed (common on free tier), prefer Stooq intraday-ish quote.
		if (latestTradingDay) {
			const todayUtc = new Date().toISOString().slice(0, 10);
			if (latestTradingDay < todayUtc) {
				const stooq = await stooqQuote(symbol);
				if (stooq) {
					price = stooq.price;
					previousClose = stooq.previousClose;
					changePercent =
						previousClose === 0
							? 0
							: ((price - previousClose) / previousClose) * 100;
				}
			}
		}

		// Fallback quote: use TIME_SERIES_DAILY and compute from last 2 closes
		if (!price || !Number.isFinite(price)) {
			const dailyRes = await axios.get(
				`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`,
			);
			if (alphaVantageIsRateLimited(dailyRes.data)) {
				throw new Error("Alpha Vantage rate limit reached");
			}
			const daily = dailyRes.data["Time Series (Daily)"];
			if (daily) {
				const keys = Object.keys(daily).sort((a, b) => (a < b ? 1 : -1));
				const latest = keys[0];
				const prev = keys[1];
				if (latest && daily[latest]?.["4. close"]) {
					price = parseFloat(daily[latest]["4. close"]);
				}
				if (prev && daily[prev]?.["4. close"]) {
					previousClose = parseFloat(daily[prev]["4. close"]);
				}
			}
		}

		if (!price || !Number.isFinite(price)) {
			// Last-resort free fallback: Stooq (no key, daily-ish)
			const stooq = await stooqQuote(symbol);
			if (stooq) {
				const previousClose = stooq.previousClose;
				const changePercent =
					previousClose === 0
						? 0
						: ((stooq.price - previousClose) / previousClose) * 100;
				const stockData = {
					symbol,
					longName: symbol,
					regularMarketPrice: stooq.price,
					regularMarketPreviousClose: previousClose,
					regularMarketChangePercent: changePercent,
				};
				stockCache.set(cacheKey, stockData, 15);
				return stockData;
			}

			console.warn("No quote data available for " + symbol + ", returning fallback");
			return {
				symbol,
				longName: symbol,
				regularMarketPrice: 0,
				regularMarketPreviousClose: 0,
				regularMarketChangePercent: 0,
			};
		}

		if (!previousClose || !Number.isFinite(previousClose)) {
			previousClose = price;
		}
		if (changePercent === null || !Number.isFinite(changePercent)) {
			changePercent =
				previousClose === 0
					? 0
					: ((price - previousClose) / previousClose) * 100;
		}

		// Try to get company name from OVERVIEW endpoint (cached longer)
		let longName = symbol;
		const overviewCacheKey = symbol + "-overview";
		if (stockCache.has(overviewCacheKey)) {
			longName = stockCache.get(overviewCacheKey) as string;
		} else {
			try {
				const overviewRes = await axios.get(
					`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`,
				);
				if (overviewRes.data && overviewRes.data.Name) {
					longName = overviewRes.data.Name;
					// Cache the name for 30 minutes
					stockCache.set(overviewCacheKey, longName, 1800);
				}
			} catch (e) {
				// Name fetch failed, use symbol as fallback
			}
		}

		const stockData = {
			symbol,
			longName,
			regularMarketPrice: price,
			regularMarketPreviousClose: previousClose,
			regularMarketChangePercent: changePercent,
		};

		stockCache.set(cacheKey, stockData, 15);
		return stockData;
	} catch (err: any) {
		// If AlphaVantage is rate-limited, try Stooq before giving up
		if ((err?.message || "").includes("Alpha Vantage rate limit")) {
			const stooq = await stooqQuote(symbol);
			if (stooq) {
				const previousClose = stooq.previousClose;
				const changePercent =
					previousClose === 0
						? 0
						: ((stooq.price - previousClose) / previousClose) * 100;
				const stockData = {
					symbol,
					longName: symbol,
					regularMarketPrice: stooq.price,
					regularMarketPreviousClose: previousClose,
					regularMarketChangePercent: changePercent,
				};
				stockCache.set(cacheKey, stockData, 15);
				return stockData;
			}
		}

		console.error("Error fetching " + symbol + " stock data:", err.message || err);
		const fallbackData = {
			symbol,
			longName: symbol,
			regularMarketPrice: 0,
			regularMarketPreviousClose: 0,
			regularMarketChangePercent: 0,
		};
		return fallbackData;
	}
};

export const fetchHistoricalStockData = async (
	symbol: string,
	period: "1d" | "5d" | "1m" | "6m" | "YTD" | "1y" | "all" = "1d",
): Promise<any> => {
	const periodTerm =
		period === "1d" || period === "5d" ? "short" : "long";
	const cacheKey = symbol + "-historical-" + period;

	try {
		if (stockCache.has(cacheKey)) {
			return stockCache.get(cacheKey);
		}

		if (symbol.toUpperCase() === "NVDA" && isIgNvdaConfigured()) {
			try {
				const igPoints = await fetchIgHistoricalCandles(
					mirrorNvdaEpic(),
					period,
				);
				if (Array.isArray(igPoints) && igPoints.length > 0) {
					stockCache.set(cacheKey, igPoints, 60);
					return igPoints;
				}
			} catch (e) {
				console.warn("IG NVDA historical unavailable, falling back:", e);
			}
		}

		let formattedData: number[][] = [];

		if (periodTerm == "short") {
			// Yahoo Finance intraday OHLC (preferred - free, no key)
			const yahooRange = period === "1d" ? "1d" : "5d";
			const yahooInterval = period === "1d" ? "15m" : "1h";
			const yahooData = await yahooHistorical(symbol, yahooRange, yahooInterval);
			if (yahooData && yahooData.length > 0) {
				formattedData = yahooData;
				stockCache.set(cacheKey, formattedData, 60);
				return formattedData;
			}

			// Finnhub intraday (fallback)
			const nowSec = Math.floor(Date.now() / 1000);
			const fromSec =
				period === "1d"
					? nowSec - 2 * 24 * 60 * 60
					: nowSec - 7 * 24 * 60 * 60;
			const finnhubResolution = period === "1d" ? "15" : "60";
			const finnhubData = await finnhubCandles(
				symbol,
				finnhubResolution,
				fromSec,
				nowSec,
			);
			if (finnhubData && finnhubData.length > 0) {
				formattedData = finnhubData;
				stockCache.set(cacheKey, formattedData);
				return formattedData;
			}

			// Prefer intraday for 1d/5d, but Alpha Vantage rate limits easily; fallback to daily.
			let alphaData: any = null;
			try {
				const res = await axios.get(
					`https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=15min&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`,
				);
				if (!alphaVantageIsRateLimited(res.data)) {
					alphaData = res.data["Time Series (15min)"];
				}
			} catch (e) {
				alphaData = null;
			}

			if (alphaData) {
				formattedData = Object.keys(alphaData)
					.map((key) => {
						const d = alphaData[key];
						return [
							new Date(key).getTime(),
							parseFloat(d["1. open"]),
							parseFloat(d["2. high"]),
							parseFloat(d["3. low"]),
							parseFloat(d["4. close"]),
						];
					})
					.sort((a, b) => a[0] - b[0]);
			} else {
				// Fallback to daily series and slice recent points (avoid recursion)
				try {
					const res = await axios.get(
						`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${ALPHA_VANTAGE_API_KEY}`,
					);
					const dailyData = res.data["Time Series (Daily)"];
					if (dailyData) {
						let points = Object.keys(dailyData)
							.map((key) => {
								const d = dailyData[key];
								return [
									new Date(key).getTime(),
									parseFloat(d["1. open"]),
									parseFloat(d["2. high"]),
									parseFloat(d["3. low"]),
									parseFloat(d["4. close"]),
								] as number[];
							})
							.sort((a, b) => a[0] - b[0]);

						const now = Date.now();
						const msPerDay = 24 * 60 * 60 * 1000;
						const cutoff = now - 31 * msPerDay;
						points = points.filter((p) => p[0] >= cutoff);
						formattedData = points as any;
					}
				} catch (e) {
					// AlphaVantage failed
				}

				// Stooq daily OHLC fallback
				if (formattedData.length === 0) {
					const stooq = await stooqHistorical(symbol, 31);
					if (stooq) {
						formattedData = stooq;
						stockCache.set(cacheKey, formattedData, 60);
						return formattedData;
					}
				}
			}
		} else {
			// Yahoo Finance daily OHLC (preferred - free, no key)
			const yahooRange =
				period === "1m" ? "1mo"
				: period === "6m" ? "6mo"
				: period === "1y" ? "1y"
				: period === "YTD" ? "ytd"
				: "max";
			const yahooData = await yahooHistorical(symbol, yahooRange, "1d");
			if (yahooData && yahooData.length > 0) {
				formattedData = yahooData;
				stockCache.set(cacheKey, formattedData, 60);
				return formattedData;
			}

			// Finnhub daily candles (fallback)
			const nowSec = Math.floor(Date.now() / 1000);
			const fromSec = nowSec - 10 * 365 * 24 * 60 * 60;
			const finnhubData = await finnhubCandles(symbol, "D", fromSec, nowSec);
			if (finnhubData && finnhubData.length > 0) {
				let points = finnhubData;
				const now = Date.now();
				const msPerDay = 24 * 60 * 60 * 1000;
				const periodDays =
					period === "1m"
						? 31
						: period === "6m"
							? 186
							: period === "1y"
								? 366
								: period === "YTD"
									? Math.ceil(
											(now -
													new Date(new Date().getFullYear(), 0, 1).getTime()) /
												msPerDay,
										)
									: null;
				if (periodDays) {
					const cutoff = now - periodDays * msPerDay;
					points = points.filter((p) => p[0] >= cutoff);
				}
				formattedData = points;
				stockCache.set(cacheKey, formattedData);
				return formattedData;
			}

			// Daily data from Alpha Vantage
			const res = await axios.get(
				`https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=full&apikey=${ALPHA_VANTAGE_API_KEY}`,
			);
			const alphaData = res.data["Time Series (Daily)"];

			if (!alphaData) {
				// Stooq daily OHLC fallback
				const periodDays =
					period === "1m" ? 31
					: period === "6m" ? 186
					: period === "1y" ? 366
					: period === "YTD" ? Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / (24*60*60*1000))
					: 365;
				const stooq = await stooqHistorical(symbol, periodDays);
				if (stooq && stooq.length > 0) {
					stockCache.set(cacheKey, stooq, 60);
					return stooq;
				}
				console.warn("No historical data for " + symbol);
				return [];
			}

			let points = Object.keys(alphaData)
				.map((key) => {
					const d = alphaData[key];
					return [
						new Date(key).getTime(),
						parseFloat(d["1. open"]),
						parseFloat(d["2. high"]),
						parseFloat(d["3. low"]),
						parseFloat(d["4. close"]),
					] as number[];
				})
				.sort((a, b) => a[0] - b[0]);

			// Slice to requested period to avoid huge payloads
			const now = Date.now();
			const msPerDay = 24 * 60 * 60 * 1000;
			const periodDays =
				period === "1m"
					? 31
					: period === "6m"
						? 186
						: period === "1y"
							? 366
							: period === "YTD"
								? Math.ceil((now - new Date(new Date().getFullYear(), 0, 1).getTime()) / msPerDay)
								: null;
			if (periodDays) {
				const cutoff = now - periodDays * msPerDay;
				points = points.filter((p) => p[0] >= cutoff);
			}
			formattedData = points as any;
		}

		stockCache.set(cacheKey, formattedData);
		return formattedData;
	} catch (error) {
		console.error("Error fetching " + symbol + " historical data:", error);
		return [];
	}
};

// Common stock symbols for search suggestions
const POPULAR_STOCKS: { symbol: string; longname: string; quoteType: string }[] = [
	{ symbol: "AAPL", longname: "Apple Inc.", quoteType: "EQUITY" },
	{ symbol: "MSFT", longname: "Microsoft Corporation", quoteType: "EQUITY" },
	{ symbol: "GOOGL", longname: "Alphabet Inc.", quoteType: "EQUITY" },
	{ symbol: "AMZN", longname: "Amazon.com Inc.", quoteType: "EQUITY" },
	{ symbol: "NVDA", longname: "NVIDIA Corporation", quoteType: "EQUITY" },
	{ symbol: "META", longname: "Meta Platforms Inc.", quoteType: "EQUITY" },
	{ symbol: "TSLA", longname: "Tesla Inc.", quoteType: "EQUITY" },
	{ symbol: "AMD", longname: "Advanced Micro Devices Inc.", quoteType: "EQUITY" },
	{ symbol: "NFLX", longname: "Netflix Inc.", quoteType: "EQUITY" },
	{ symbol: "JPM", longname: "JPMorgan Chase & Co.", quoteType: "EQUITY" },
	{ symbol: "V", longname: "Visa Inc.", quoteType: "EQUITY" },
	{ symbol: "WMT", longname: "Walmart Inc.", quoteType: "EQUITY" },
	{ symbol: "DIS", longname: "The Walt Disney Company", quoteType: "EQUITY" },
	{ symbol: "BA", longname: "The Boeing Company", quoteType: "EQUITY" },
	{ symbol: "INTC", longname: "Intel Corporation", quoteType: "EQUITY" },
	{ symbol: "KO", longname: "The Coca-Cola Company", quoteType: "EQUITY" },
	{ symbol: "PEP", longname: "PepsiCo Inc.", quoteType: "EQUITY" },
	{ symbol: "NKE", longname: "NIKE Inc.", quoteType: "EQUITY" },
	{ symbol: "PYPL", longname: "PayPal Holdings Inc.", quoteType: "EQUITY" },
	{ symbol: "SQ", longname: "Block Inc.", quoteType: "EQUITY" },
	{ symbol: "SPOT", longname: "Spotify Technology S.A.", quoteType: "EQUITY" },
	{ symbol: "UBER", longname: "Uber Technologies Inc.", quoteType: "EQUITY" },
	{ symbol: "COIN", longname: "Coinbase Global Inc.", quoteType: "EQUITY" },
	{ symbol: "BTC-USD", longname: "Bitcoin USD", quoteType: "CRYPTOCURRENCY" },
	{ symbol: "ETH-USD", longname: "Ethereum USD", quoteType: "CRYPTOCURRENCY" },
];

export const searchStocks = async (query: string): Promise<any> => {
	if (!query) return [];

	const upperQuery = query.toUpperCase();

	// Filter popular stocks by symbol or name match
	const matches = POPULAR_STOCKS.filter(
		(stock) =>
			stock.symbol.includes(upperQuery) ||
			stock.longname.toUpperCase().includes(upperQuery),
	).map((stock) => ({
		symbol: stock.symbol,
		longname: stock.longname,
		quoteType: stock.quoteType,
	}));

	return matches;
};
