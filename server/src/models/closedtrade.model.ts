import { Schema, Document, model } from "mongoose";

export interface IClosedTrade extends Document {
	symbol: string;
	side: "long" | "short";
	entryPrice: number;
	exitPrice: number;
	quantity: number;
	entryDate: number;
	exitDate: number;
	pnl: number;
	pnlPercent: number;
}

export const ClosedTradeSchema = new Schema<IClosedTrade>({
	symbol: {
		type: String,
		required: true,
		uppercase: true,
		trim: true,
	},
	side: {
		type: String,
		required: true,
		enum: ["long", "short"],
	},
	entryPrice: {
		type: Number,
		required: true,
		min: 0,
	},
	exitPrice: {
		type: Number,
		required: true,
		min: 0,
	},
	quantity: {
		type: Number,
		required: true,
		min: 1,
	},
	entryDate: {
		type: Number,
		required: true,
	},
	exitDate: {
		type: Number,
		default: Date.now,
	},
	pnl: {
		type: Number,
		required: true,
	},
	pnlPercent: {
		type: Number,
		required: true,
	},
});

const ClosedTrade = model<IClosedTrade>("ClosedTrade", ClosedTradeSchema);

export default ClosedTrade;
