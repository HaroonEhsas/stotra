import React, { useEffect, useState } from "react";
import {
	Flex,
	Text,
	Box,
	HStack,
} from "@chakra-ui/react";
import api from "../services/api.service";

const SYMBOLS = [
	"AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META",
	"AMD", "SPY", "QQQ",
];

type MiniQuote = {
	symbol: string;
	price: number;
	changePercent: number;
};

function TickerItem({ quote }: { quote: MiniQuote }) {
	const isUp = quote.changePercent >= 0;
	const safePrice = typeof quote.price === "number" && Number.isFinite(quote.price) ? quote.price : 0;
	const safeChange = typeof quote.changePercent === "number" && Number.isFinite(quote.changePercent) ? quote.changePercent : 0;
	if (safePrice === 0) return null;
	return (
		<HStack spacing={2} px={4} whiteSpace="nowrap" flexShrink={0}>
			<Text fontWeight="bold" fontSize="sm">
				{quote.symbol}
			</Text>
			<Text fontSize="sm" color="gray.600">
				{safePrice.toFixed(2)}
			</Text>
			<Text
				fontSize="xs"
				fontWeight="600"
				color={isUp ? "green.500" : "red.500"}
			>
				{isUp ? "▲" : "▼"} {Math.abs(safeChange).toFixed(2)}%
			</Text>
		</HStack>
	);
}

export default function TickerTape() {
	const [quotes, setQuotes] = useState<MiniQuote[]>([]);

	useEffect(() => {
		const fetchQuotes = () => {
			Promise.all(
				SYMBOLS.map((s) =>
					api.get(`/stocks/${s}/info`)
						.then((res) => ({
							symbol: s,
							price: res.data.regularMarketPrice ?? 0,
							changePercent: res.data.regularMarketChangePercent ?? 0,
						}))
						.catch(() => ({
							symbol: s,
							price: 0,
							changePercent: 0,
						}))
				)
			).then(setQuotes);
		};
		fetchQuotes();
		const interval = setInterval(fetchQuotes, 120000);
		return () => clearInterval(interval);
	}, []);

	if (quotes.length === 0) return null;

	// Duplicate items for seamless loop
	const items = [...quotes, ...quotes];

	return (
		<Box
			overflow="hidden"
			borderWidth="1px"
			borderRadius="md"
			bg="gray.50"
			mb={4}
			py={2}
		>
			<Flex
				css={{
					animation: "tickerScroll 40s linear infinite",
					"&:hover": { animationPlayState: "paused" },
				}}
				align="center"
				w="max-content"
			>
				{items.map((q, i) => (
					<TickerItem key={`${q.symbol}-${i}`} quote={q} />
				))}
			</Flex>
			<style>{`
				@keyframes tickerScroll {
					0% { transform: translateX(0); }
					100% { transform: translateX(-50%); }
				}
			`}</style>
		</Box>
	);
}
