import React, { useState, useEffect } from "react";
import {
	Box,
	Heading,
	Table,
	Thead,
	Tbody,
	Tr,
	Th,
	Td,
	Tag,
	TagLabel,
	Text,
	Flex,
	Spinner,
	IconButton,
	Select,
	HStack,
} from "@chakra-ui/react";
import { ArrowUpIcon, ArrowDownIcon } from "@chakra-ui/icons";
import api from "../services/api.service";
import tokens from "../services/tokens.service";

const fmt = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

const fmtPct = (v: number) =>
	(v >= 0 ? "+" : "") + v.toFixed(2) + "%";

const fmtDate = (ts: number) =>
	new Date(ts).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});

type ClosedTrade = {
	symbol: string;
	side: "long" | "short";
	entryPrice: number;
	exitPrice: number;
	quantity: number;
	entryDate: number;
	exitDate: number;
	pnl: number;
	pnlPercent: number;
};

type SortKey = "exitDate" | "pnl" | "pnlPercent" | "symbol";
type SortDir = "asc" | "desc";

export default function TradeHistory() {
	const [trades, setTrades] = useState<ClosedTrade[]>([]);
	const [loading, setLoading] = useState(true);
	const [sortKey, setSortKey] = useState<SortKey>("exitDate");
	const [sortDir, setSortDir] = useState<SortDir>("desc");
	const [filter, setFilter] = useState<"all" | "long" | "short">("all");

	const fetchTrades = () => {
		if (!tokens.isAuthenticated()) return;
		api
			.get("/user/trades")
			.then((res) => {
				setTrades(res.data.trades || []);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	};

	useEffect(() => {
		fetchTrades();
	}, []);

	const toggleSort = (key: SortKey) => {
		if (sortKey === key) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortKey(key);
			setSortDir("desc");
		}
	};

	const sorted = [...trades]
		.filter((t) => filter === "all" || t.side === filter)
		.sort((a, b) => {
			const mul = sortDir === "asc" ? 1 : -1;
			if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol) * mul;
			return (a[sortKey] - b[sortKey]) * mul;
		});

	const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
	const wins = trades.filter((t) => t.pnl > 0).length;
	const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

	if (loading) return <Spinner />;

	return (
		<Box>
			<Heading size="lg" mb={4}>
				Trade History
			</Heading>

			{/* Summary bar */}
			<Flex
				gap={6}
				mb={4}
				p={4}
				bg="gray.50"
				borderRadius="md"
				align="center"
				wrap="wrap"
			>
				<Box>
					<Text fontSize="xs" color="gray.400">
						Total Trades
					</Text>
					<Text fontWeight="bold" fontSize="xl">
						{trades.length}
					</Text>
				</Box>
				<Box>
					<Text fontSize="xs" color="gray.400">
						Win Rate
					</Text>
					<Text
						fontWeight="bold"
						fontSize="xl"
						color={winRate >= 50 ? "green.400" : "red.400"}
					>
						{winRate.toFixed(1)}%
					</Text>
				</Box>
				<Box>
					<Text fontSize="xs" color="gray.400">
						Total P/L
					</Text>
					<Text
						fontWeight="bold"
						fontSize="xl"
						color={totalPnl >= 0 ? "green.400" : "red.400"}
					>
						{fmt.format(totalPnl)}
					</Text>
				</Box>
			</Flex>

			{/* Filter */}
			<HStack mb={3}>
				<Text fontSize="sm" color="gray.400">
					Filter:
				</Text>
				<Select
					size="sm"
					w="120px"
					value={filter}
					onChange={(e) =>
						setFilter(e.target.value as "all" | "long" | "short")
					}
				>
					<option value="all">All</option>
					<option value="long">Long</option>
					<option value="short">Short</option>
				</Select>
			</HStack>

			{sorted.length === 0 ? (
				<Text color="gray.500" textAlign="center" py={10}>
					No closed trades yet. Open and close a position to see it here.
				</Text>
			) : (
				<Box overflowX="auto">
					<Table variant="simple" size="sm">
						<Thead>
							<Tr>
								<Th cursor="pointer" onClick={() => toggleSort("symbol")}>
									Symbol{" "}
									{sortKey === "symbol" &&
										(sortDir === "asc" ? (
											<ArrowUpIcon boxSize={3} />
										) : (
											<ArrowDownIcon boxSize={3} />
										))}
								</Th>
								<Th>Side</Th>
								<Th isNumeric>Qty</Th>
								<Th isNumeric>Entry</Th>
								<Th isNumeric>Exit</Th>
								<Th cursor="pointer" onClick={() => toggleSort("pnl")}>
									P/L{" "}
									{sortKey === "pnl" &&
										(sortDir === "asc" ? (
											<ArrowUpIcon boxSize={3} />
										) : (
											<ArrowDownIcon boxSize={3} />
										))}
								</Th>
								<Th cursor="pointer" onClick={() => toggleSort("pnlPercent")}>
									P/L %{" "}
									{sortKey === "pnlPercent" &&
										(sortDir === "asc" ? (
											<ArrowUpIcon boxSize={3} />
										) : (
											<ArrowDownIcon boxSize={3} />
										))}
								</Th>
								<Th cursor="pointer" onClick={() => toggleSort("exitDate")}>
									Closed{" "}
									{sortKey === "exitDate" &&
										(sortDir === "asc" ? (
											<ArrowUpIcon boxSize={3} />
										) : (
											<ArrowDownIcon boxSize={3} />
										))}
								</Th>
							</Tr>
						</Thead>
						<Tbody>
							{sorted.map((t, i) => (
								<Tr key={i} _hover={{ bg: "whiteAlpha.50" }}>
									<Td fontWeight="bold">{t.symbol}</Td>
									<Td>
										<Tag
											size="sm"
											variant="subtle"
											colorScheme={t.side === "long" ? "green" : "red"}
										>
											<TagLabel>{t.side.toUpperCase()}</TagLabel>
										</Tag>
									</Td>
									<Td isNumeric>{t.quantity}</Td>
									<Td isNumeric>{fmt.format(t.entryPrice)}</Td>
									<Td isNumeric>{fmt.format(t.exitPrice)}</Td>
									<Td
										isNumeric
										fontWeight="bold"
										color={t.pnl >= 0 ? "green.400" : "red.400"}
									>
										{t.pnl >= 0 ? "+" : ""}
										{fmt.format(t.pnl)}
									</Td>
									<Td
										isNumeric
										fontWeight="bold"
										color={t.pnlPercent >= 0 ? "green.400" : "red.400"}
									>
										{fmtPct(t.pnlPercent)}
									</Td>
									<Td fontSize="xs" color="gray.400">
										{fmtDate(t.exitDate)}
									</Td>
								</Tr>
							))}
						</Tbody>
					</Table>
				</Box>
			)}
		</Box>
	);
}
