import dotenv from "dotenv";
dotenv.config();

/** MongoDB user ids (comma-separated) that mirror trades to your IG demo account. */
export function getMirrorUserIds(): Set<string> {
	const raw = process.env.STOTRA_MIRROR_USER_IDS || "";
	return new Set(
		raw
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);
}

export function isMirrorUser(userId: string | undefined): boolean {
	if (!userId) return false;
	return getMirrorUserIds().has(String(userId));
}

/** Max notional (USD) per opened position in the simulator + IG hedge. */
export function mirrorMaxNotionalUsd(): number {
	const override = process.env.STOTRA_MIRROR_MAX_POSITION_USD;
	if (override && Number.isFinite(Number(override))) {
		return Number(override);
	}
	const dep = Number(process.env.STOTRA_MIRROR_DEPOSIT_USD || 1000);
	const lev = Number(process.env.STOTRA_MIRROR_LEVERAGE || 5);
	return dep * lev;
}

export const MIRROR_SYMBOL = "NVDA";

export function mirrorNvdaEpic(): string {
	return (process.env.STOTRA_IG_NVDA_EPIC || "").trim();
}
