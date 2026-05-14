import axios, { AxiosResponse } from "axios";
import dotenv from "dotenv";
dotenv.config();

const DEFAULT_BASE = "https://demo-api.ig.com/gateway/deal";

export function isIgNvdaConfigured(): boolean {
	return Boolean(
		process.env.STOTRA_IG_API_KEY &&
			process.env.STOTRA_IG_IDENTIFIER &&
			process.env.STOTRA_IG_PASSWORD &&
			(process.env.STOTRA_IG_NVDA_EPIC || "").trim(),
	);
}

function baseUrl(): string {
	return (process.env.STOTRA_IG_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

function apiKey(): string {
	const k = process.env.STOTRA_IG_API_KEY;
	if (!k) throw new Error("STOTRA_IG_API_KEY is not set");
	return k;
}

let cst: string | null = null;
let xSecurityToken: string | null = null;
let loginInFlight: Promise<void> | null = null;

function clearSession(): void {
	cst = null;
	xSecurityToken = null;
}

async function login(): Promise<void> {
	const identifier = process.env.STOTRA_IG_IDENTIFIER;
	const password = process.env.STOTRA_IG_PASSWORD;
	if (!identifier || !password) {
		throw new Error("STOTRA_IG_IDENTIFIER / STOTRA_IG_PASSWORD are not set");
	}

	const res = await axios.post(
		`${baseUrl()}/session`,
		{ identifier, password },
		{
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json; charset=UTF-8",
				VERSION: "2",
				"X-IG-API-KEY": apiKey(),
			},
			validateStatus: () => true,
		},
	);

	if (res.status !== 200) {
		throw new Error(
			`IG session failed (${res.status}): ${JSON.stringify(res.data)}`,
		);
	}

	const h = res.headers as Record<string, string | undefined>;
	const nextCst = h["cst"] ?? h["CST"];
	const nextSec =
		h["x-security-token"] ?? h["X-SECURITY-TOKEN"] ?? h["X-Security-Token"];
	if (!nextCst || !nextSec) {
		throw new Error("IG session response missing CST or X-SECURITY-TOKEN");
	}
	cst = nextCst;
	xSecurityToken = nextSec;
}

async function ensureSession(): Promise<void> {
	if (cst && xSecurityToken) return;
	if (!loginInFlight) {
		loginInFlight = login().finally(() => {
			loginInFlight = null;
		});
	}
	await loginInFlight;
}

async function igRequest<T = unknown>(opts: {
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	version: string;
	data?: unknown;
	params?: Record<string, string | number | undefined>;
}): Promise<AxiosResponse<T>> {
	await ensureSession();

	const send = () =>
		axios.request<T>({
			method: opts.method,
			url: `${baseUrl()}${opts.path}`,
			data: opts.data,
			params: opts.params,
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json; charset=UTF-8",
				VERSION: opts.version,
				"X-IG-API-KEY": apiKey(),
				CST: cst!,
				"X-SECURITY-TOKEN": xSecurityToken!,
			},
			validateStatus: () => true,
		});

	let res = await send();
	if (res.status === 401) {
		clearSession();
		await ensureSession();
		res = await send();
	}
	return res;
}

export type IgBidOffer = {
	bid: number;
	offer: number;
	mid: number;
	currencyCode: string;
	expiry: string;
	minDealSize: number;
	step: number;
	marketStatus?: string;
	netChange?: number;
	percentageChange?: number;
};

let metaCache: {
	epic: string;
	expiry: string;
	currencyCode: string;
	minDealSize: number;
	step: number;
	expiresAtMs: number;
} | null = null;

export async function getNvdaMarketSnapshot(epic: string): Promise<IgBidOffer> {
	const m = await igRequest({
		method: "GET",
		path: `/markets/${encodeURIComponent(epic)}`,
		version: "3",
	});
	if (m.status !== 200) {
		throw new Error(`IG markets failed (${m.status}): ${JSON.stringify(m.data)}`);
	}

	const inst = (m.data as any)?.instrument;
	const dealing = (m.data as any)?.dealingRules;
	const minDealSize = Number(dealing?.minDealSize?.size ?? 1) || 1;
	const step = Number(dealing?.minStepDistance?.size ?? minDealSize) || minDealSize;
	const expiry =
		(typeof inst?.expiry === "string" && inst.expiry.trim()) || "DFB";
	const currencyCode =
		inst?.currencies?.[0]?.code ||
		(m.data as any)?.instrument?.currencies?.[0]?.code ||
		"USD";

	const now = Date.now();
	metaCache = {
		epic,
		expiry,
		currencyCode,
		minDealSize,
		step,
		expiresAtMs: now + 60 * 60 * 1000,
	};

	const snap = (m.data as any)?.snapshot;
	const bid = Number(snap?.bid);
	const offer = Number(snap?.offer);
	if (!Number.isFinite(bid) || !Number.isFinite(offer) || bid <= 0 || offer <= 0) {
		throw new Error("IG snapshot missing bid/offer (market may be closed)");
	}
	const mid = (bid + offer) / 2;
	const netChange = Number(snap?.netChange);
	const percentageChange = Number(snap?.percentageChange);
	return {
		bid,
		offer,
		mid,
		currencyCode,
		expiry,
		minDealSize,
		step,
		marketStatus: snap?.marketStatus,
		netChange: Number.isFinite(netChange) ? netChange : undefined,
		percentageChange: Number.isFinite(percentageChange) ? percentageChange : undefined,
	};
}

export async function fetchIgQuoteForFrontend(epic: string): Promise<{
	symbol: string;
	longName: string;
	regularMarketPrice: number;
	regularMarketPreviousClose: number;
	regularMarketChangePercent: number;
	bid: number;
	offer: number;
}> {
	const q = await getNvdaMarketSnapshot(epic);
	const netChange = q.netChange;
	const pctChange = q.percentageChange;
	const prevClose =
		typeof netChange === "number" && Number.isFinite(netChange)
			? q.mid - netChange
			: q.mid;
	const changePercent =
		typeof pctChange === "number" && Number.isFinite(pctChange) && pctChange !== 0
			? pctChange
			: prevClose === 0
				? 0
				: ((q.mid - prevClose) / prevClose) * 100;
	return {
		symbol: "NVDA",
		longName: "NVIDIA Corporation (IG demo)",
		regularMarketPrice: q.mid,
		regularMarketPreviousClose: Number.isFinite(prevClose) ? prevClose : q.mid,
		regularMarketChangePercent: changePercent,
		bid: q.bid,
		offer: q.offer,
	};
}

export async function fetchIgHistoricalCandles(
	epic: string,
	period: "1d" | "5d" | "1m" | "6m" | "YTD" | "1y" | "all",
): Promise<number[][]> {
	let resolution = "HOUR";
	let maxPoints = 120;
	if (period === "1d") {
		resolution = "MINUTE";
		maxPoints = 200;
	} else if (period === "5d") {
		resolution = "HOUR";
		maxPoints = 120;
	} else if (period === "1m") {
		resolution = "DAY";
		maxPoints = 40;
	} else if (period === "6m") {
		resolution = "DAY";
		maxPoints = 130;
	} else if (period === "1y") {
		resolution = "DAY";
		maxPoints = 260;
	} else if (period === "YTD") {
		resolution = "DAY";
		maxPoints = 260;
	} else {
		resolution = "WEEK";
		maxPoints = 520;
	}

	const res = await igRequest({
		method: "GET",
		path: `/prices/${encodeURIComponent(epic)}`,
		version: "3",
		params: {
			resolution,
			max: maxPoints,
		},
	});

	if (res.status !== 200) {
		throw new Error(
			`IG prices failed (${res.status}): ${JSON.stringify(res.data)}`,
		);
	}

	const prices = (res.data as any)?.prices;
	if (!Array.isArray(prices)) return [];

	const out: number[][] = [];
	for (const p of prices) {
		const t =
			typeof p.snapshotTimeUTC === "string"
				? Date.parse(p.snapshotTimeUTC)
				: typeof p.snapshotTime === "string"
					? Date.parse(p.snapshotTime)
					: NaN;
		const o = Number(p.openPrice?.bid ?? p.openPrice);
		const h = Number(p.highPrice?.bid ?? p.highPrice);
		const l = Number(p.lowPrice?.bid ?? p.lowPrice);
		const c = Number(p.closePrice?.bid ?? p.closePrice);
		if (!Number.isFinite(t) || !Number.isFinite(c)) continue;
		out.push([t, o, h, l, c]);
	}
	return out.sort((a, b) => a[0] - b[0]);
}

function normalizeDealSize(raw: number, min: number, step: number): number {
	if (!Number.isFinite(raw) || raw < min) return 0;
	const steps = Math.floor((raw - min) / step + 1e-9);
	const size = min + steps * step;
	const rounded = Math.round(size * 1e6) / 1e6;
	return rounded < min ? 0 : rounded;
}

export function computeIgDealSize(params: {
	notionalUsd: number;
	priceUsd: number;
	minDealSize: number;
	step: number;
}): number {
	if (params.priceUsd <= 0) return 0;
	const raw = params.notionalUsd / params.priceUsd;
	return normalizeDealSize(raw, params.minDealSize, params.step);
}

export async function createOtcMarketPosition(args: {
	epic: string;
	direction: "BUY" | "SELL";
	size: number;
	currencyCode: string;
	expiry: string;
}): Promise<{ dealReference: string }> {
	const body = {
		epic: args.epic,
		direction: args.direction,
		size: args.size,
		expiry: args.expiry,
		orderType: "MARKET",
		timeInForce: "EXECUTE_AND_ELIMINATE",
		currencyCode: args.currencyCode,
		forceOpen: true,
		guaranteedStop: false,
	};

	let res = await igRequest<{ dealReference?: string }>({
		method: "POST",
		path: "/positions/otc",
		version: "2",
		data: body,
	});

	if (res.status !== 200) {
		// Some accounts prefer FILL_OR_KILL — try once.
		const body2 = { ...body, timeInForce: "FILL_OR_KILL" };
		res = await igRequest({
			method: "POST",
			path: "/positions/otc",
			version: "2",
			data: body2,
		});
	}

	if (res.status !== 200 || !res.data?.dealReference) {
		throw new Error(
			`IG open position failed (${res.status}): ${JSON.stringify(res.data)}`,
		);
	}
	return { dealReference: res.data.dealReference };
}

export async function confirmDeal(dealReference: string): Promise<{
	dealId?: string;
	dealStatus?: string;
	reason?: string;
}> {
	const started = Date.now();
	while (Date.now() - started < 8000) {
		const res = await igRequest<any>({
			method: "GET",
			path: `/confirms/${encodeURIComponent(dealReference)}`,
			version: "1",
		});
		if (res.status !== 200) {
			await new Promise((r) => setTimeout(r, 350));
			continue;
		}
		const dealStatus = res.data?.dealStatus;
		if (dealStatus === "ACCEPTED") {
			return {
				dealId: res.data?.dealId,
				dealStatus,
			};
		}
		if (dealStatus === "REJECTED") {
			return {
				dealStatus,
				reason: res.data?.reason || res.data?.errorCode,
			};
		}
		await new Promise((r) => setTimeout(r, 350));
	}
	return { dealStatus: "TIMEOUT" };
}

export async function closeOtcMarketPosition(args: {
	dealId: string;
	direction: "BUY" | "SELL";
	epic: string;
	expiry: string;
	size: number;
	currencyCode: string;
}): Promise<{ dealReference: string }> {
	const body = {
		dealId: args.dealId,
		direction: args.direction,
		epic: args.epic,
		expiry: args.expiry,
		orderType: "MARKET",
		timeInForce: "EXECUTE_AND_ELIMINATE",
		size: args.size,
		currencyCode: args.currencyCode,
	};

	let res = await igRequest<{ dealReference?: string }>({
		method: "DELETE",
		path: "/positions/otc",
		version: "1",
		data: body,
	});

	if (res.status !== 200) {
		const body2 = { ...body, timeInForce: "FILL_OR_KILL" };
		res = await igRequest({
			method: "DELETE",
			path: "/positions/otc",
			version: "1",
			data: body2,
		});
	}

	if (res.status !== 200 || !res.data?.dealReference) {
		throw new Error(
			`IG close position failed (${res.status}): ${JSON.stringify(res.data)}`,
		);
	}
	return { dealReference: res.data.dealReference };
}
