import { Request, Response } from "express";
import User from "../models/user.model";
import { IClosedTrade } from "../models/closedtrade.model";
import { IPosition } from "../models/position.model";
import { ITransaction } from "../models/transaction.model";
import {
	closeOtcMarketPosition,
	computeIgDealSize,
	confirmDeal,
	createOtcMarketPosition,
	getNvdaMarketSnapshot,
	isIgNvdaConfigured,
} from "./igClient";
import {
	isMirrorUser,
	mirrorMaxNotionalUsd,
	MIRROR_SYMBOL,
	mirrorNvdaEpic,
} from "./mirrorConfig";

function epic(): string {
	return mirrorNvdaEpic();
}

async function igOpenInverseHedge(
	friendOpenedLong: boolean,
	size: number,
	snap: Awaited<ReturnType<typeof getNvdaMarketSnapshot>>,
): Promise<string> {
	const direction = friendOpenedLong ? "SELL" : "BUY";
	const { dealReference } = await createOtcMarketPosition({
		epic: epic(),
		direction,
		size,
		currencyCode: snap.currencyCode,
		expiry: snap.expiry,
	});
	const conf = await confirmDeal(dealReference);
	if (conf.dealStatus !== "ACCEPTED" || !conf.dealId) {
		throw new Error(
			`IG hedge open rejected: ${conf.dealStatus} ${conf.reason || ""}`.trim(),
		);
	}
	return conf.dealId;
}

async function igCloseInverseHedge(
	friendBuyingInSim: boolean,
	size: number,
	snap: Awaited<ReturnType<typeof getNvdaMarketSnapshot>>,
	dealId: string,
): Promise<void> {
	const direction = friendBuyingInSim ? "SELL" : "BUY";
	const { dealReference } = await closeOtcMarketPosition({
		dealId,
		direction,
		epic: epic(),
		expiry: snap.expiry,
		size,
		currencyCode: snap.currencyCode,
	});
	const conf = await confirmDeal(dealReference);
	if (conf.dealStatus !== "ACCEPTED") {
		throw new Error(
			`IG hedge close rejected: ${conf.dealStatus} ${conf.reason || ""}`.trim(),
		);
	}
}

export function mirrorGuardOrSend(req: Request, res: Response, symbol: string): boolean {
	if (!isMirrorUser(req.body.userId)) return false;
	const normalized = symbol.toUpperCase();
	if (normalized !== MIRROR_SYMBOL) {
		res.status(403).send({
			message: "This account is limited to NVDA only (IG mirror mode).",
		});
		return true;
	}
	if (!isIgNvdaConfigured()) {
		res.status(503).send({
			message:
				"IG demo mirror is not configured. Set STOTRA_IG_* and STOTRA_IG_NVDA_EPIC on the server.",
		});
		return true;
	}
	return false;
}

export async function mirrorUserBuyStock(req: Request, res: Response): Promise<void> {
	const symbol = req.params.symbol.toUpperCase();
	const userId = req.body.userId as string;
	let quantity = Number(req.body.quantity);

	const user = await User.findById(userId);
	if (!user) {
		res.status(404).send({ message: "User not found" });
		return;
	}

	const snap = await getNvdaMarketSnapshot(epic());
	const existingIndex = user.positions.findIndex(
		(p) => p.symbol.toUpperCase() === symbol,
	);

	// Open new long (max notional)
	if (existingIndex === -1) {
		const price = snap.offer;
		const cap = Math.min(user.cash ?? 0, mirrorMaxNotionalUsd());
		const qty = computeIgDealSize({
			notionalUsd: cap,
			priceUsd: price,
			minDealSize: snap.minDealSize,
			step: snap.step,
		});
		if (!Number.isFinite(qty) || qty < snap.minDealSize) {
			res.status(400).send({ message: "Position size too small for IG min step" });
			return;
		}
		if ((user.cash ?? 0) < price * qty) {
			res.status(400).send({ message: "Not enough cash" });
			return;
		}

		let dealId: string;
		try {
			dealId = await igOpenInverseHedge(true, qty, snap);
		} catch (e: any) {
			res.status(502).send({ message: e?.message || String(e) });
			return;
		}

		user.cash = (user.cash ?? 0) - price * qty;
		user.ledger.push({
			symbol,
			price,
			quantity: qty,
			type: "buy",
			date: Date.now(),
		} as ITransaction);
		user.positions.push({
			symbol,
			quantity: qty,
			purchasePrice: price,
			purchaseDate: Date.now(),
			igDealId: dealId,
		} as IPosition);

		try {
			await user.save();
		} catch (e: any) {
			res.status(500).send({ message: e?.message || String(e) });
			return;
		}
		res.status(200).send({ message: "Transaction successful" });
		return;
	}

	const pos = user.positions[existingIndex];

	// Cover short (buy): IG closes our long hedge with SELL
	if (pos.quantity < 0) {
		if (!Number.isFinite(quantity) || quantity <= 0) {
			res.status(400).send({ message: "Invalid quantity" });
			return;
		}
		const shortQty = Math.abs(pos.quantity);
		if (quantity > shortQty) {
			res.status(400).send({ message: "Close short position first" });
			return;
		}
		const price = snap.offer;
		if (!pos.igDealId) {
			res.status(500).send({ message: "Missing IG hedge id on position" });
			return;
		}

		try {
			await igCloseInverseHedge(true, quantity, snap, pos.igDealId);
		} catch (e: any) {
			res.status(502).send({ message: e?.message || String(e) });
			return;
		}

		const closedQty = Math.min(quantity, shortQty);
		const pnl = (pos.purchasePrice - price) * closedQty;
		const pnlPercent =
			pos.purchasePrice === 0 ? 0 : ((pos.purchasePrice - price) / pos.purchasePrice) * 100;
		user.closedTrades.push({
			symbol,
			side: "short",
			entryPrice: pos.purchasePrice,
			exitPrice: price,
			quantity: closedQty,
			entryDate: pos.purchaseDate,
			exitDate: Date.now(),
			pnl,
			pnlPercent,
		} as IClosedTrade);

		user.cash = (user.cash ?? 0) - price * quantity;
		user.ledger.push({
			symbol,
			price,
			quantity,
			type: "buy",
			date: Date.now(),
		} as ITransaction);

		pos.quantity = pos.quantity + quantity;
		if (pos.quantity === 0) {
			user.positions.splice(existingIndex, 1);
		}

		try {
			await user.save();
		} catch (e: any) {
			res.status(500).send({ message: e?.message || String(e) });
			return;
		}
		res.status(200).send({ message: "Transaction successful" });
		return;
	}

	// Increasing long while already long: not used by UI; reject for safety
	res.status(400).send({ message: "Already long NVDA — close before re-opening (mirror mode)" });
}

export async function mirrorUserSellStock(req: Request, res: Response): Promise<void> {
	const symbol = req.params.symbol.toUpperCase();
	const userId = req.body.userId as string;
	let quantity = Number(req.body.quantity);

	const user = await User.findById(userId);
	if (!user) {
		res.status(404).send({ message: "User not found" });
		return;
	}

	const snap = await getNvdaMarketSnapshot(epic());
	const existingIndex = user.positions.findIndex(
		(p) => p.symbol.toUpperCase() === symbol,
	);

	// Open new short (max notional)
	if (existingIndex === -1) {
		const price = snap.bid;
		const cap = mirrorMaxNotionalUsd();
		const qty = computeIgDealSize({
			notionalUsd: cap,
			priceUsd: price,
			minDealSize: snap.minDealSize,
			step: snap.step,
		});
		if (!Number.isFinite(qty) || qty < snap.minDealSize) {
			res.status(400).send({ message: "Position size too small for IG min step" });
			return;
		}

		let dealId: string;
		try {
			dealId = await igOpenInverseHedge(false, qty, snap);
		} catch (e: any) {
			res.status(502).send({ message: e?.message || String(e) });
			return;
		}

		user.cash = (user.cash ?? 0) + price * qty;
		user.ledger.push({
			symbol,
			price,
			quantity: qty,
			type: "sell",
			date: Date.now(),
		} as ITransaction);
		user.positions.push({
			symbol,
			quantity: -qty,
			purchasePrice: price,
			purchaseDate: Date.now(),
			igDealId: dealId,
		} as IPosition);

		try {
			await user.save();
		} catch (e: any) {
			res.status(500).send({ message: e?.message || String(e) });
			return;
		}
		res.status(200).send({ message: "Transaction successful" });
		return;
	}

	const pos = user.positions[existingIndex];

	// Close long (sell): IG closes our short hedge with BUY
	if (pos.quantity > 0) {
		if (!Number.isFinite(quantity) || quantity <= 0) {
			res.status(400).send({ message: "Invalid quantity" });
			return;
		}
		if (quantity > pos.quantity) {
			res.status(400).send({ message: "Close long position first" });
			return;
		}
		const price = snap.bid;
		if (!pos.igDealId) {
			res.status(500).send({ message: "Missing IG hedge id on position" });
			return;
		}

		try {
			await igCloseInverseHedge(false, quantity, snap, pos.igDealId);
		} catch (e: any) {
			res.status(502).send({ message: e?.message || String(e) });
			return;
		}

		const closedQty = Math.min(quantity, pos.quantity);
		const pnl = (price - pos.purchasePrice) * closedQty;
		const pnlPercent =
			pos.purchasePrice === 0 ? 0 : ((price - pos.purchasePrice) / pos.purchasePrice) * 100;
		user.closedTrades.push({
			symbol,
			side: "long",
			entryPrice: pos.purchasePrice,
			exitPrice: price,
			quantity: closedQty,
			entryDate: pos.purchaseDate,
			exitDate: Date.now(),
			pnl,
			pnlPercent,
		} as IClosedTrade);

		user.cash = (user.cash ?? 0) + price * quantity;
		user.ledger.push({
			symbol,
			price,
			quantity,
			type: "sell",
			date: Date.now(),
		} as ITransaction);

		pos.quantity = pos.quantity - quantity;
		if (pos.quantity === 0) {
			user.positions.splice(existingIndex, 1);
		}

		try {
			await user.save();
		} catch (e: any) {
			res.status(500).send({ message: e?.message || String(e) });
			return;
		}
		res.status(200).send({ message: "Transaction successful" });
		return;
	}

	res.status(400).send({ message: "Already short NVDA — close before re-opening (mirror mode)" });
}
