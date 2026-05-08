import React, { useState, useRef, useEffect } from "react";
import * as Highcharts from "highcharts/highstock";
import highchartsAccessibility from "highcharts/modules/accessibility";
import HighchartsReact from "highcharts-react-official";
import axios from "axios";
import { useLocation } from "react-router-dom";
import { Box, Spinner, useTheme } from "@chakra-ui/react";
// import { useColorMode } from "@chakra-ui/react";

const formatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
});

export default function StockChart(props: {
	symbol: string;
	entryPrice?: number | null;
	positionQty?: number;
}) {
	const location = useLocation();
	const [isLoading, setIsLoading] = useState(true);
	const [useTradingView, setUseTradingView] = useState(true);
	const tvContainerRef = useRef<HTMLDivElement | null>(null);

	const accentColor =
		useTheme()["components"]["Link"]["baseStyle"]["color"].split(".")[0];
	const chartAccentColor = "var(--chakra-colors-" + accentColor + "-500)";

	const zoomBtnClick = function (this: any) {
		let thisBtn = this as {
			click: () => void;
			text: string;
		};
		fetchStockData(thisBtn.text);
	};

	const [options, setOptions] = useState<Highcharts.Options>({
		rangeSelector: {
			allButtonsEnabled: true,
			inputStyle: {
				color: chartAccentColor,
				fontWeight: "bold",
			},
			buttons: [
				{
					type: "day",
					count: 1,
					text: "1d",
					title: "View 1 day",
					events: { click: zoomBtnClick },
				},
				{
					type: "day",
					count: 5,
					text: "5d",
					title: "View 5 days",
					events: { click: zoomBtnClick },
				},
				{
					type: "month",
					count: 1,
					text: "1m",
					title: "View 1 month",
					events: { click: zoomBtnClick },
				},
				{
					type: "month",
					count: 6,
					text: "6m",
					title: "View 6 months",
					events: { click: zoomBtnClick },
				},
				{
					type: "ytd",
					text: "YTD",
					title: "View year to date",
					events: { click: zoomBtnClick },
				},
				{
					type: "year",
					count: 1,
					text: "1y",
					title: "View 1 year",
					events: { click: zoomBtnClick },
				},
				{
					type: "all",
					text: "All",
					title: "View all",
					events: { click: zoomBtnClick },
				},
			],
		},
		colors: [chartAccentColor],
		title: {
			text: "",
		},
		yAxis: [
			{
				height: "75%",
				labels: {
					formatter: (point: any) => formatter.format(point.value as number),
					x: -5,
					align: "left",
				},
				plotLines: [],
				title: {
					text: " ",
				},
			},
		],
		plotOptions: {
			series: {
				showInNavigator: true,
				gapSize: 0,
			},
		},
		chart: {
			height: 600,
			borderRadius: 10,
			// backgroundColor: "transparent",

			style: {
				fontFamily: "'Manrope Variable', sans-serif",
				fontWeight: "600",
				color: "red",
			},
		},
		credits: {
			enabled: false,
		},
		xAxis: {
			type: "datetime",
		},
		navigator: {
			maskFill: "rgb(49, 130, 206, 0.25)",
			series: {
				color: chartAccentColor,
				fillOpacity: 0.1,
				lineWidth: 2,
			},
		},
	} as any);

	const initTradingView = () => {
		try {
			const w = window as any;
			const container = tvContainerRef.current;
			if (!container) return;
			container.innerHTML = "";

			const tvSymbol = /^[A-Za-z]{1,6}$/.test(props.symbol)
				? `NASDAQ:${props.symbol.toUpperCase()}`
				: props.symbol;

			const createWidget = () => {
				if (!w.TradingView || !w.TradingView.widget) return;
				new w.TradingView.widget({
					autosize: true,
					symbol: tvSymbol,
					interval: "15",
					timezone: "Etc/UTC",
					theme: "dark",
					style: "1",
					locale: "en",
					enable_publishing: false,
					hide_side_toolbar: false,
					allow_symbol_change: false,
					container_id: `tv_${props.symbol}`,
				});
			};

			if (w.TradingView && w.TradingView.widget) {
				createWidget();
				setIsLoading(false);
				return;
			}

			const existing = document.querySelector(
				"script[src='https://s3.tradingview.com/tv.js']",
			) as HTMLScriptElement | null;
			if (existing) {
				existing.addEventListener("load", () => {
					createWidget();
					setIsLoading(false);
				});
				setTimeout(() => {
					createWidget();
					setIsLoading(false);
				}, 1000);
				return;
			}

			const script = document.createElement("script");
			script.src = "https://s3.tradingview.com/tv.js";
			script.async = true;
			script.onload = () => {
				createWidget();
				setIsLoading(false);
			};
			script.onerror = () => {
				setUseTradingView(false);
			};
			document.head.appendChild(script);
	} catch (e) {
		setUseTradingView(false);
	}
	};

	const fetchStockData = (period: string = "1m") => {
		setIsLoading(true);
		axios
			.get(`/api/stocks/${props.symbol}/historical?period=` + period)
			.then((res) => {
				const data = res.data;
				if (Array.isArray(data) && data.length === 0) {
					setUseTradingView(true);
					initTradingView();
					return;
				}
				const isOhlc =
					Array.isArray(data) &&
					data.length > 0 &&
					Array.isArray(data[0]) &&
					(data[0].length === 5 || data[0].length === 6);
				// if (chartComponentRef !== null) {
				// chartComponentRef.current!.chart!.series[0]!.setData(res.data);
				// } else {
				const plotLines: any[] = [];
				if (
					typeof props.entryPrice === "number" &&
					Number.isFinite(props.entryPrice) &&
					props.entryPrice > 0 &&
					props.positionQty &&
					props.positionQty !== 0
				) {
					const isLong = props.positionQty > 0;
					plotLines.push({
						value: props.entryPrice,
						color: isLong ? "#38A169" : "#E53E3E",
						width: 2,
						dashStyle: "Dash",
						zIndex: 5,
						label: {
							text: `Entry ${formatter.format(props.entryPrice)}`,
							align: "left",
							style: {
								color: isLong ? "#38A169" : "#E53E3E",
								fontWeight: "600",
							},
						},
					});
				}

				setOptions({
					...options,
					yAxis: [
						{
							...(options.yAxis as any)?.[0],
							plotLines,
						},
					],
					series: [
						{
							name: "Price",
							type: (isOhlc ? "candlestick" : "spline") as any,
							id: "stock_chart",

							data: data,
							lineWidth: 2,
							tooltip: {
								valueDecimals: 2,
							},
						},
					],
				});
				// }
				setIsLoading(false);
			})
			.catch((err) => {
				console.log("Failed to fetch historical data:", err);
				setUseTradingView(true);
				initTradingView();
			});
	};

	const chartComponentRef = useRef<any>(null);

	highchartsAccessibility(Highcharts);

	// useEffect(() => {
	// 	options.chart!.style!.color = colorMode === "light" ? "black" : "white";
	// 	chartComponentRef.current?.chart?.update(options);
	// 	console.log("updates");
	// }, [colorMode]);

	useEffect(() => {
		const tvEnv = (import.meta as any)?.env?.VITE_USE_TRADINGVIEW;
		const tvEnabled = tvEnv === undefined ? true : tvEnv === "true";
		if (tvEnabled) {
			setUseTradingView(true);
			setIsLoading(true);
			initTradingView();
			return;
		}
		setUseTradingView(false);
		fetchStockData();
	}, [location]);

	return (
		<>
			{isLoading && <Spinner />}
			{useTradingView ? (
				<Box display={isLoading ? "none" : "block"} height="600px">
					<div
						id={`tv_${props.symbol}`}
						ref={(el) => (tvContainerRef.current = el)}
						style={{ height: "600px", width: "100%" }}
					/>
				</Box>
			) : (
				<Box display={isLoading ? "none" : "block"}>
					<HighchartsReact
						constructorType={"stockChart"}
						highcharts={Highcharts}
						options={options}
						ref={chartComponentRef}
					/>
				</Box>
			)}
		</>
	);
}
