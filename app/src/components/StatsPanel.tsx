import React, { useState, useEffect } from "react";
import {
	Box,
	Flex,
	Text,
	Spinner,
	Tooltip,
	CircularProgress,
	CircularProgressLabel,
} from "@chakra-ui/react";
import api from "../services/api.service";
import tokens from "../services/tokens.service";

const fmt = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

type Stats = {
	totalTrades: number;
	winCount: number;
	lossCount: number;
	winRate: number;
	totalPnl: number;
	avgWin: number;
	avgLoss: number;
	profitFactor: number;
	bestTrade: number;
	worstTrade: number;
	winStreak: number;
	lossStreak: number;
	currentStreak: number;
	currentStreakType: string;
};

function MetricCard({
	label,
	value,
	icon,
	tooltip,
}: {
	label: string;
	value: string;
	icon?: string;
	tooltip?: string;
}) {
	const card = (
		<Box
			bg="white"
			borderWidth="1px"
			borderColor="gray.100"
			borderRadius="xl"
			p={4}
			flex="1"
			minW="120px"
			_hover={{ shadow: "sm" }}
			transition="all 0.2s"
		>
			<Text fontSize="xs" color="gray.400" fontWeight="600" mb={1}>
				{icon && <Text as="span" mr={1}>{icon}</Text>}
				{label}
			</Text>
			<Text
				fontSize="xl"
				fontWeight="bold"
				color="gray.700"
				isTruncated
			>
				{value}
			</Text>
		</Box>
	);
	if (tooltip) return <Tooltip label={tooltip}>{card}</Tooltip>;
	return card;
}

export default function StatsPanel() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [loading, setLoading] = useState(true);

	const fetchStats = () => {
		if (!tokens.isAuthenticated()) return;
		api
			.get("/user/stats")
			.then((res) => {
				setStats(res.data);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	};

	useEffect(() => {
		fetchStats();
		const interval = setInterval(fetchStats, 15000);
		return () => clearInterval(interval);
	}, []);

	if (loading) return <Spinner size="sm" />;
	if (!stats || stats.totalTrades === 0) {
		return (
			<Box bg="white" borderWidth="1px" borderColor="gray.100" borderRadius="xl" p={6} mb={4}>
				<Text color="gray.400" textAlign="center" fontSize="sm">
					No closed trades yet. Close a position to see your stats.
				</Text>
			</Box>
		);
	}

	const pf = stats.profitFactor;
	const pfDisplay =
		pf === null || pf === undefined
			? "N/A"
			: pf === Infinity
				? "∞"
				: pf.toFixed(2);

	const isWinRateGood = stats.winRate >= 50;
	const isPnlPositive = stats.totalPnl >= 0;

	return (
		<Box mb={4}>
			{/* Top row: Win Rate circle + key metrics */}
			<Flex
				gap={4}
				mb={4}
				direction={{ base: "column", md: "row" }}
				align={{ base: "center", md: "stretch" }}
			>
				{/* Win Rate Circle */}
				<Box
					bg="white"
					borderWidth="1px"
					borderColor="gray.100"
					borderRadius="xl"
					p={5}
					display="flex"
					flexDirection="column"
					alignItems="center"
					justifyContent="center"
					minW={{ base: "160px", md: "180px" }}
				>
					<CircularProgress
						value={stats.winRate}
						size="120px"
						thickness="8px"
						trackColor="gray.100"
						color={isWinRateGood ? "green.400" : "red.400"}
					>
						<CircularProgressLabel>
							<Text
								fontSize={{ base: "2xl", md: "3xl" }}
								fontWeight="bold"
								color={isWinRateGood ? "green.500" : "red.500"}
							>
								{stats.winRate.toFixed(0)}%
							</Text>
						</CircularProgressLabel>
					</CircularProgress>
					<Text fontSize="sm" fontWeight="700" color="gray.600" mt={2}>
						Win Rate
					</Text>
					<Text fontSize="xs" color="gray.400">
						{stats.winCount}W / {stats.lossCount}L
					</Text>
				</Box>

				{/* Right side metrics grid */}
				<Flex flex="1" gap={3} wrap="wrap" align="stretch">
					<MetricCard
						label="Total P/L"
						value={(isPnlPositive ? "+" : "") + fmt.format(stats.totalPnl)}
						icon={isPnlPositive ? "📈" : "📉"}
					/>
					<MetricCard
						label="Profit Factor"
						value={pfDisplay}
						icon="⚖️"
						tooltip="Gross wins / Gross losses"
					/>
					<MetricCard
						label="Avg Win"
						value={"+" + fmt.format(stats.avgWin)}
						icon="✅"
					/>
					<MetricCard
						label="Avg Loss"
						value={stats.avgLoss > 0 ? "-" + fmt.format(stats.avgLoss) : "$0.00"}
						icon="❌"
					/>
					<MetricCard
						label="Best Trade"
						value={(stats.bestTrade >= 0 ? "+" : "") + fmt.format(stats.bestTrade)}
						icon="🏆"
					/>
					<MetricCard
						label="Worst Trade"
						value={fmt.format(stats.worstTrade)}
						icon="⚠️"
					/>
					<MetricCard
						label="Current Streak"
						value={
							stats.currentStreakType === "win"
								? `${stats.currentStreak}W`
								: stats.currentStreakType === "loss"
									? `${stats.currentStreak}L`
									: "-"
						}
						icon="🔥"
						tooltip={`Best win streak: ${stats.winStreak} | Worst loss streak: ${stats.lossStreak}`}
					/>
					<MetricCard
						label="Total Trades"
						value={stats.totalTrades.toString()}
						icon="📊"
					/>
				</Flex>
			</Flex>

			{/* Win/Loss bar */}
			<Box
				bg="white"
				borderWidth="1px"
				borderColor="gray.100"
				borderRadius="xl"
				p={3}
			>
				<Flex justify="space-between" mb={2}>
					<Text fontSize="xs" fontWeight="600" color="green.500">
						Wins {stats.winCount}
					</Text>
					<Text fontSize="xs" fontWeight="600" color="gray.400">
						{stats.totalTrades} trades
					</Text>
					<Text fontSize="xs" fontWeight="600" color="red.500">
						Losses {stats.lossCount}
					</Text>
				</Flex>
				<Flex h="8px" borderRadius="full" overflow="hidden" bg="gray.100">
					<Box
						flex={stats.winCount}
						bg="green.400"
						borderRadius="full"
						transition="flex 0.5s"
					/>
					<Box
						flex={stats.lossCount}
						bg="red.400"
						borderRadius="full"
						transition="flex 0.5s"
					/>
				</Flex>
			</Box>
		</Box>
	);
}
