import { Request, Response } from "express";
import User from "../models/user.model";

import {
	fetchStockData,
	fetchHistoricalStockData,
	searchStocks,
} from "../utils/requests";
import { subscribeToSymbol } from "../utils/finnhub-ws";
import { isMirrorUser } from "../utils/mirrorConfig";
import {
	mirrorGuardOrSend,
	mirrorUserBuyStock,
	mirrorUserSellStock,
} from "../utils/mirrorStocksHelper";
import { ITransaction } from "../models/transaction.model";
import { IPosition } from "../models/position.model";
import { IClosedTrade } from "../models/closedtrade.model";

const getInfo = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Data']
	*/
	const symbol = req.params.symbol;
	subscribeToSymbol(symbol);
	const quote = await fetchStockData(symbol);
	res.status(200).send(quote);
};

const getHistorical = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Data']
	*/
	const symbol = req.params.symbol;
	const period = req.query.period?.toString() as
		| "1d"
		| "5d"
		| "1m"
		| "6m"
		| "YTD"
		| "1y"
		| "all"
		| undefined;

	try {
		const historicalData = await fetchHistoricalStockData(symbol, period);

		res.status(200).send(historicalData);
	} catch (error) {
		console.error("Error fetching " + symbol + " stock data:", error);
		res.status(500).send("Error fetching " + symbol + " stock data:" + error);
	}
};

const buyStock = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Transaction']
	*/
	const symbol = req.params.symbol;
	const quantity = req.body.quantity;

	if (mirrorGuardOrSend(req, res, symbol)) return;
	if (isMirrorUser(req.body.userId)) {
		await mirrorUserBuyStock(req, res);
		return;
	}

	try {
		const data = await fetchStockData(symbol);
		const price = data.regularMarketPrice;

		let user = await User.findById(req.body.userId);
		user = user!;

		if (!Number.isFinite(quantity) || quantity <= 0) {
			res.status(400).send({ message: "Invalid quantity" });
			return;
		}

		const normalizedSymbol = symbol.toUpperCase();
		const existingIndex = user.positions.findIndex(
			(p) => p.symbol.toUpperCase() === normalizedSymbol,
		);

		// If there is an existing short position, buying covers it.
		if (existingIndex !== -1 && user.positions[existingIndex].quantity < 0) {
			const shortQty = Math.abs(user.positions[existingIndex].quantity);
			if (quantity > shortQty) {
				res.status(400).send({ message: "Close short position first" });
				return;
			}
		}

		if (user.cash! < price * quantity) {
			res.status(400).send({ message: "Not enough cash" });
			return;
		}

		user.cash! -= price * quantity;

		const transaction: ITransaction = {
			symbol: normalizedSymbol,
			price,
			quantity,
			type: "buy",
			date: Date.now(),
		} as ITransaction;
		user.ledger.push(transaction);

		if (existingIndex === -1) {
			// Open new long position
			const position = {
				symbol: normalizedSymbol,
				quantity: quantity,
				purchasePrice: price,
				purchaseDate: Date.now(),
			} as IPosition;
			user.positions.push(position);
		} else {
			const pos = user.positions[existingIndex];
			if (pos.quantity >= 0) {
				// Increase long position and update weighted average entry price
				const currentQty = pos.quantity;
				const newQty = currentQty + quantity;
				pos.purchasePrice =
					(pos.purchasePrice * currentQty + price * quantity) / newQty;
				pos.quantity = newQty;
			} else {
				// Cover short position
				const closedQty = Math.min(quantity, Math.abs(pos.quantity));
				const pnl = (pos.purchasePrice - price) * closedQty; // short: profit when entry > exit
				const pnlPercent =
					pos.purchasePrice === 0
							? 0
							: ((pos.purchasePrice - price) / pos.purchasePrice) * 100;
				user.closedTrades.push({
					symbol: normalizedSymbol,
					side: "short",
					entryPrice: pos.purchasePrice,
					exitPrice: price,
					quantity: closedQty,
					entryDate: pos.purchaseDate,
					exitDate: Date.now(),
					pnl,
					pnlPercent,
				} as IClosedTrade);
				pos.quantity = pos.quantity + quantity; // pos.quantity is negative
				if (pos.quantity === 0) {
					user.positions.splice(existingIndex, 1);
				}
			}
		}

		user
			.save()
			.then((user) => {
				if (user) {
					res.status(200).send({ message: "Transaction successful" });
				}
			})
			.catch((err) => {
				if (err) {
					res.status(500).send({ message: err });
				}
			});
	} catch (error) {
		console.error("Error fetching " + symbol + " stock data:", error);
		res.status(500).send("Error fetching " + symbol + " stock data:" + error);
	}
};

const sellStock = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Transaction']
	*/
	const symbol = req.params.symbol;
	var quantity = req.body.quantity;

	if (mirrorGuardOrSend(req, res, symbol)) return;
	if (isMirrorUser(req.body.userId)) {
		await mirrorUserSellStock(req, res);
		return;
	}

	try {
		const data = await fetchStockData(symbol);
		const price = data.regularMarketPrice;

		let user = await User.findById(req.body.userId);
		user = user!;

		if (!Number.isFinite(quantity) || quantity <= 0) {
			res.status(400).send({ message: "Invalid quantity" });
			return;
		}

		const normalizedSymbol = symbol.toUpperCase();
		const existingIndex = user.positions.findIndex(
			(p) => p.symbol.toUpperCase() === normalizedSymbol,
		);

		// If there is an existing long position, selling closes/reduces it.
		if (existingIndex !== -1 && user.positions[existingIndex].quantity > 0) {
			if (quantity > user.positions[existingIndex].quantity) {
				res.status(400).send({ message: "Close long position first" });
				return;
			}
		}

		// In this simulator, selling always credits cash (opening short gives proceeds).
		user.cash! += price * quantity;

		const transaction: ITransaction = {
			symbol: normalizedSymbol,
			price,
			quantity,
			type: "sell",
			date: Date.now(),
		} as ITransaction;
		user.ledger.push(transaction);

		if (existingIndex === -1) {
			// Open new short position
			const position = {
				symbol: normalizedSymbol,
				quantity: -quantity,
				purchasePrice: price,
				purchaseDate: Date.now(),
			} as IPosition;
			user.positions.push(position);
		} else {
			const pos = user.positions[existingIndex];
			if (pos.quantity <= 0) {
				// Increase short position and update weighted average entry price
				const currentQty = Math.abs(pos.quantity);
				const newQty = currentQty + quantity;
				pos.purchasePrice =
					(pos.purchasePrice * currentQty + price * quantity) / newQty;
				pos.quantity = -(newQty);
			} else {
				// Reduce/close long position
				const closedQty = Math.min(quantity, pos.quantity);
				const pnl = (price - pos.purchasePrice) * closedQty; // long: profit when exit > entry
				const pnlPercent =
					pos.purchasePrice === 0
						? 0
						: ((price - pos.purchasePrice) / pos.purchasePrice) * 100;
				user.closedTrades.push({
					symbol: normalizedSymbol,
					side: "long",
					entryPrice: pos.purchasePrice,
					exitPrice: price,
					quantity: closedQty,
					entryDate: pos.purchaseDate,
					exitDate: Date.now(),
					pnl,
					pnlPercent,
				} as IClosedTrade);
				pos.quantity = pos.quantity - quantity;
				if (pos.quantity === 0) {
					user.positions.splice(existingIndex, 1);
				}
			}
		}

		user
			.save()
			.then((user) => {
				if (user) {
					res.send({ message: "Transaction successful" });
				}
			})
			.catch((err) => {
				if (err) {
					res.status(500).send({ message: err });
				}
			});
	} catch (error) {
		console.error("Error fetching " + symbol + " stock data:", error);
		res.status(500).send("Error fetching " + symbol + " stock data:" + error);
	}
};

const search = async (req: Request, res: Response) => {
	/* 
	#swagger.tags = ['Stock Data']
	*/
	const { query } = req.params;

	if (!query) res.status(400).send({ message: "No query provided" });

	searchStocks(query)
		.then((quotes) => {
			let stocksAndCurrencies = quotes.filter(
				(quote: { quoteType: string }) => {
					return (
						quote.quoteType &&
						quote.quoteType !== "FUTURE" &&
						quote.quoteType !== "Option"
					);
				},
			);
			res.status(200).send(stocksAndCurrencies);
		})
		.catch((err) => {
			console.log(err);
			res.status(500).send({ message: err });
		});
};

export default { getInfo, getHistorical, buyStock, sellStock, search };
