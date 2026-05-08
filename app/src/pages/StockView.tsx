import React, { useEffect, useReducer, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
	Stat,
	Heading,
	Spacer,
	Flex,
	Box,
	Button,
	Spinner,
	HStack,
	Text,
	Tag,
	TagLabel,
	useToast,
} from "@chakra-ui/react";
import api from "../services/api.service";
import StockChart from "../components/StockChart";
import TransactionPane from "../components/TransactionPane";
import accounts from "../services/accounts.service";
import tokens from "../services/tokens.service";
import {
	AddIcon,
	ArrowDownIcon,
	ArrowUpIcon,
	MinusIcon,
	CloseIcon,
} from "@chakra-ui/icons";

const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

function StockView() {
	const { symbol } = useParams();
	const location = useLocation();

	const [onWatchlist, setOnWatchlist] = useState(false);
	const [headerPrice, setHeaderPrice] = useState<number | null>(null);
	const [positionEntry, setPositionEntry] = useState<number | null>(null);
	const [positionQty, setPositionQty] = useState<number>(0);
	const [closingPosition, setClosingPosition] = useState(false);
	const [refreshTrigger, setRefreshTrigger] = useState(0);

	const toast = useToast();

	const [stock, setStock] = useReducer(
		(state: any, newState: any) => ({ ...state, ...newState }),
		{
			symbol,
			longName: "",
			regularMarketPrice: -1,
			regularMarketChangePercent: 0,
		},
	);

	useEffect(() => {
		// Check if stock is on watchlist
		if (tokens.isAuthenticated()) {
			accounts.getWatchlist(true).then((res: any[]) => {
				setOnWatchlist(
					res.some((item) =>
						typeof item === "string"
							? item.toUpperCase() === (symbol || "").toUpperCase()
							: item?.symbol === symbol,
					),
				);
			});
		}

		const fetchInfo = () => {
			api
				.get(`/stocks/${symbol}/info`, {
					params: {
						t: Date.now(),
					},
				})
				.then((res) => {
					setStock({ ...res.data });
					const price = res.data?.regularMarketPrice;
					if (typeof price === "number" && Number.isFinite(price) && price > 0) {
						setHeaderPrice(price);
					}
				})
				.catch((err) => {
					console.log(err);
				});
		};

		const fetchPosition = () => {
			if (!tokens.isAuthenticated()) return;
			accounts.getPositionForSymbol(symbol as string).then((pos: any) => {
				setPositionEntry(pos?.purchasePrice ?? null);
				setPositionQty(pos?.quantity ?? 0);
			});
		};

		fetchPosition();
		fetchInfo();
		const interval = setInterval(() => {
			fetchInfo();
			fetchPosition();
		}, 3000);
		return () => clearInterval(interval);
	}, [location]);

	const formatPositionPnl = () => {
		const px = headerPrice ?? stock.regularMarketPrice;
		if (positionEntry === null) return null;
		if (!Number.isFinite(px) || px <= 0) return null;
		if (!Number.isFinite(positionQty) || positionQty === 0) return null;
		const qty = Math.abs(positionQty);
		const pnlValue =
			positionQty > 0
				? (px - positionEntry) * qty
				: (positionEntry - px) * qty;

		const sign = pnlValue > 0 ? "+" : pnlValue < 0 ? "-" : "";
		const color = pnlValue > 0 ? "green.500" : pnlValue < 0 ? "red.500" : "gray.500";
		return { text: `${sign}${formatter.format(Math.abs(pnlValue))}`, color };
	};

	const positionPnl = formatPositionPnl();

	const closePosition = () => {
		if (positionQty === 0) return;
		setClosingPosition(true);
		const qty = Math.abs(positionQty);
		const isBuyToClose = positionQty < 0;
		accounts
			.makeTransaction(symbol as string, qty, isBuyToClose ? "buy" : "sell")
			.then(() => {
				toast({
					title: "Position closed",
					description: `Closed ${qty} shares of ${symbol}`,
					status: "success",
				});
				setPositionEntry(null);
				setPositionQty(0);
				setClosingPosition(false);
				setRefreshTrigger((n) => n + 1);
			})
			.catch((err: any) => {
				toast({
					title: "Error closing position",
					description: err.message,
					status: "error",
				});
				setClosingPosition(false);
			});
	};

	if (stock.regularMarketPrice < 0) {
		return (
			<Flex justifyContent="center">
				<Spinner size="xl" />
			</Flex>
		);
	}

	return (
		<>
			<Flex direction={{ base: "column", md: "row" }} gap={5}>
				<Box flex={tokens.isAuthenticated() ? "0.75" : "1"}>
					<Flex justifyContent={"space-between"}>
						<Stat>
							<Heading size={{ base: "sm", md: "md" }} fontWeight="md" isTruncated maxW="70vw">
								{stock.longName || (symbol as string)}
							</Heading>
							<Spacer h="1" />
							{headerPrice !== null && (
								<Heading size={{ base: "lg", md: "xl" }}>{formatter.format(headerPrice)}</Heading>
							)}
							<HStack>
								<Heading
									size="md"
									color={
										stock.regularMarketChangePercent > 0
											? "green.500"
											: "red.500"
									}
								>
									{stock.regularMarketChangePercent > 0 ? (
										<ArrowUpIcon />
									) : (
										<ArrowDownIcon />
									)}
									{stock.regularMarketChangePercent.toFixed(2)}%
								</Heading>
								<Heading size="sm" color="gray.500">
									Today
								</Heading>
							</HStack>
						</Stat>
						{tokens.isAuthenticated() &&
							(onWatchlist ? (
								<Button
									size={{ base: "xs", md: "sm" }}
									leftIcon={<MinusIcon />}
									variant={"outline"}
									onClick={() =>
										accounts
											.editWatchlist(symbol as string, "remove")
											.then(() => setOnWatchlist(false))
									}
								>
									Remove
								</Button>
							) : (
								<Button
									size={{ base: "xs", md: "sm" }}
									leftIcon={<AddIcon />}
									variant={"outline"}
									onClick={() =>
										accounts
											.editWatchlist(symbol as string, "add")
											.then(() => setOnWatchlist(true))
									}
								>
									Watchlist
								</Button>
							))}
					</Flex>

					<Spacer height={5} />
					{positionQty !== 0 && (
						<Flex
							mb={3}
							borderWidth="1px"
							borderRadius="md"
							p={{ base: 2, md: 3 }}
							align="center"
							gap={{ base: 2, md: 4 }}
							bg="gray.50"
							wrap="wrap"
						>
							<Tag
								size={{ base: "sm", md: "md" }}
								variant="subtle"
								colorScheme={positionQty > 0 ? "green" : "red"}
							>
								<TagLabel fontWeight="bold">
									{positionQty > 0 ? "LONG" : "SHORT"} × {Math.abs(positionQty)}
								</TagLabel>
							</Tag>
							{positionEntry !== null && (
								<Text fontSize={{ base: "xs", md: "sm" }} fontWeight="600" color="gray.400">
									Entry: {formatter.format(positionEntry)}
								</Text>
							)}
							{positionPnl !== null && (
								<Text fontWeight="bold" fontSize={{ base: "sm", md: "lg" }} color={positionPnl.color}>
									P/L: {positionPnl.text}
								</Text>
							)}
							<Spacer />
							<Button
								size={{ base: "xs", md: "sm" }}
								colorScheme="red"
								variant="outline"
								leftIcon={<CloseIcon />}
								onClick={closePosition}
								isLoading={closingPosition}
							>
								Close
							</Button>
						</Flex>
					)}

					<StockChart
						symbol={symbol as string}
						entryPrice={positionEntry}
						positionQty={positionQty}
					/>
				</Box>
				{tokens.isAuthenticated() && (
					<Box flex="0.25" borderWidth="1px" borderRadius="md" p={5}>
						<TransactionPane
							symbol={symbol as string}
							price={headerPrice ?? stock.regularMarketPrice}
							refreshTrigger={refreshTrigger}
							onPositionChange={() => {
								accounts.getPositionForSymbol(symbol as string).then((pos: any) => {
									setPositionEntry(pos?.purchasePrice ?? null);
									setPositionQty(pos?.quantity ?? 0);
								});
							}}
						/>
					</Box>
				)}
			</Flex>
		</>
	);
}

export default StockView;
