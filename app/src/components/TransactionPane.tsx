import React, { useEffect, useState } from "react";
import accounts from "../services/accounts.service";
import {
	Text,
	useToast,
	Tabs,
	TabList,
	Tab,
	Stack,
	HStack,
	Spacer,
	Divider,
	TabPanels,
	TabPanel,
	Button,
} from "@chakra-ui/react";
import { useLocation } from "react-router-dom";

const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

function TransactionPane(props: {
	symbol: string;
	price: number;
	refreshTrigger?: number;
	onPositionChange?: () => void;
}) {
	const [availableShares, setAvailableShares] = useState(0);
	const [isLoading, setIsLoading] = useState(false);

	const location = useLocation();

	const toast = useToast();

	const refreshPosition = () => {
		accounts.getAvailableShares(props.symbol!).then((value) => {
			setAvailableShares(value);
		});
		props.onPositionChange?.();
	};

	const submitTransaction = (
		symbol: string,
		quantity: number,
		isBuy: boolean
	) => {
		setIsLoading(true);
		accounts
			.makeTransaction(symbol, quantity, isBuy ? "buy" : "sell")
			.then(() => {
				// Show success toast on successful transaction
				toast({
					title: isBuy
						? "Long position opened"
						: "Short position opened",
					description: `${quantity} share${quantity > 1 ? "s" : ""} of ${symbol}`,
					status: "success",
				});
				refreshPosition();
				// Turn off button spinner
				setIsLoading(false);
			})
			.catch((err) => {
				// Show error toast on failed transaction
				toast({
					title: `Error ${isBuy ? "buying" : "selling"} ${symbol}`,
					description: err.message,
					status: "error",
				});
				// Turn off button spinner
				setIsLoading(false);
			});
	};

	const openLong = () => {
		submitTransaction(props.symbol!, 1, true);
	};

	const openShort = () => {
		submitTransaction(props.symbol!, 1, false);
	};

	useEffect(() => {
		refreshPosition();
	}, [location, props.refreshTrigger]);

	return (
		<>
			<Tabs>
				<TabList>
					<Tab>Long</Tab>
					<Tab>Short</Tab>
				</TabList>

				<Stack p="5">
					<HStack>
						<Text>Current Price</Text>
						<Spacer />
						<Text>{formatter.format(props.price)}</Text>
					</HStack>
					<Divider />
				</Stack>

				<TabPanels>
				<TabPanel>
						{availableShares > 0 ? (
							<Text color="gray.400" textAlign="center" py={4}>
								Long position open — use Close Position above the chart
							</Text>
						) : availableShares < 0 ? (
							<Text color="gray.400" textAlign="center" py={4}>
								Close short position first
							</Text>
						) : (
							<Button
								size="lg"
								width="100%"
								onClick={openLong}
								{...(isLoading ? { isLoading: true } : {})}
							>
								Open Long
							</Button>
						)}
					</TabPanel>
					<TabPanel>
						{availableShares < 0 ? (
							<Text color="gray.400" textAlign="center" py={4}>
								Short position open — use Close Position above the chart
							</Text>
						) : availableShares > 0 ? (
							<Text color="gray.400" textAlign="center" py={4}>
								Close long position first
							</Text>
						) : (
							<Button
								size="lg"
								width="100%"
								onClick={openShort}
								{...(isLoading ? { isLoading: true } : {})}
							>
								Open Short
							</Button>
						)}
					</TabPanel>
				</TabPanels>
			</Tabs>
		</>
	);
}

export default TransactionPane;
